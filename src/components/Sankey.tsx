import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { sankey as d3sankey, sankeyLinkHorizontal, sankeyLeft } from 'd3-sankey';

// ── Types ──────────────────────────────────────────────────────────────────
export interface SankeyPoste {
  id: string; label: string; valeurEffective: number;
  infobulle?: string; source?: string;
}
interface MesureActive {
  id: string; label: string; poste: string;
  impact_min: number; impact_max: number;
  statut?: string; source_label?: string; effets_indirects?: string[];
}
interface SankeyProps {
  recettes_plf: SankeyPoste[]; recettes_plfss: SankeyPoste[];
  depenses_plf: SankeyPoste[]; depenses_plfss: SankeyPoste[];
  // ── CORRECTION : compensationSecu n'est plus utilisé pour plfNet ──────
  // Il sert uniquement à colorer le flux TVA→Sécu dans le Sankey
  compensationSecu: number;
  emprunt: number;
  emprunt_infobulle: string; compensation_infobulle: string;
  // Taux de split TVA (depuis budget_2025.json) — optionnels, fallback sur valeurs réelles PLF 2025
  taux_tva_etat?: number;        // défaut: 0.454 (98/216)
  taux_tva_secu?: number;        // défaut: 0.171 (37/216)
  taux_tva_collectivites?: number; // défaut: 0.347 (75/216)
  taux_tva_audiovisuel?: number;   // défaut: 0.028 (6/216)
  deltas: Record<string, { min: number; max: number }>;
  mesuresActives: MesureActive[];
}
interface ModalDelta {
  label: string; val: number; statut?: string;
  effets?: string[]; source?: string;
}
interface ModalInfo {
  title: string;
  infobulle: string;          // texte principal formaté
  montant?: number;           // valeur en Mrd€
  montant_pct?: string;       // % du total (ex: "7,2 % des recettes")
  source?: string;
  source_url?: string;
  type?: 'recette_plf' | 'recette_plfss' | 'depense_plf' | 'depense_plfss' | 'flux' | 'pool';
  note?: string;              // note méthodologique si présente
  deltas?: ModalDelta[];
}

// ── Couleurs ───────────────────────────────────────────────────────────────
const C = {
  rec_plf:   '#2563EB',
  rec_plfss: '#0EA5E9',
  dep_plf:   '#7C3AED',
  dep_plfss: '#A855F7',
  oat:       '#EA580C',   // emprunt OAT — orange (passif, pas une recette)
  tva_coll:  '#0D9488',   // TVA→collectivités — teal
  tva_audio: '#6366F1',   // TVA→audiovisuel — indigo
  surplus:   '#059669',
  deficit:   '#EA580C',
  text:      '#CBD5E1',
  white:     '#F1F5F9',
  muted:     '#64748B',
  dp:        '#10B981',
  dn:        '#F97316',
};
const STATUT_COLOR: Record<string, string> = {
  observe: '#059669', hypothese_partielle: '#D97706',
  hypothese_non_verifiee: '#D97706', incertain: '#EA580C',
};
const STATUT_LABEL: Record<string, string> = {
  observe: 'Observé', hypothese_partielle: 'Hypothèse partielle',
  hypothese_non_verifiee: 'Non vérifiée', incertain: 'Incertain',
};
const TYPE_LABEL: Record<string, { label: string; color: string }> = {
  recette_plf:   { label: 'Recette BGÉ',   color: '#2563EB' },
  recette_plfss: { label: 'Recette Sécu',  color: '#0EA5E9' },
  depense_plf:   { label: 'Dépense BGÉ',   color: '#7C3AED' },
  depense_plfss: { label: 'Dépense Sécu',  color: '#A855F7' },
  flux:          { label: 'Flux',          color: '#64748B' },
  pool:          { label: 'Pool consolidé', color: '#64748B' },
};
function fmt(n: number) { return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(0)} mds €`; }

// ── Composant ──────────────────────────────────────────────────────────────
export default function Sankey(props: SankeyProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef       = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(900);
  const [modal, setModal] = useState<ModalInfo | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(containerRef.current);
    const w = containerRef.current.getBoundingClientRect().width;
    if (w > 0) setWidth(w);
    return () => ro.disconnect();
  }, []);

  const isPortrait = width < 600;
  const H  = Math.min(620, Math.round(isPortrait ? width * 1.5 : width * 0.55));
  const ML = isPortrait ? 100 : 170;
  const MR = isPortrait ? 100 : 170;
  const MT = 32;
  const MB = 12;

  useEffect(() => {
    if (!svgRef.current || width === 0) return;
    const {
      recettes_plf, recettes_plfss, depenses_plf, depenses_plfss,
      emprunt, deltas, mesuresActives,
      taux_tva_etat          = 0.454,
      taux_tva_secu          = 0.171,
      taux_tva_collectivites = 0.347,
      taux_tva_audiovisuel   = 0.028,
    } = props;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${H}`).attr('width', width).attr('height', H);

    // ── Séparer OAT des recettes fiscales PLF ────────────────────────────
    const oatPoste        = recettes_plf.find(p => p.id === 'oat');
    const recFiscPlf      = recettes_plf.filter(p => p.id !== 'oat');
    const tvaPoste        = recFiscPlf.find(p => p.id === 'tva');
    const autresPlf       = recFiscPlf.filter(p => p.id !== 'tva');
    const empruntVal      = oatPoste?.valeurEffective ?? emprunt;

    // ── CORRECTION : calcul correct du Budget État ────────────────────────
    // TVA brute → split en 4 flux directs depuis nœud TVA
    // Budget État reçoit uniquement la part TVA→État (taux_tva_etat)
    const tvaVal          = tvaPoste?.valeurEffective ?? 216;
    const tvaVersEtat     = Math.round(tvaVal * taux_tva_etat);
    const tvaVersSecu     = Math.round(tvaVal * taux_tva_secu);
    const tvaVersColl     = Math.round(tvaVal * taux_tva_collectivites);
    const tvaVersAudio    = Math.round(tvaVal * taux_tva_audiovisuel);

    const recHorsTvaOat   = autresPlf.reduce((s, p) => s + p.valeurEffective, 0);
    const totalPlfssVal   = recettes_plfss.reduce((s, p) => s + p.valeurEffective, 0);

    const oatEtat         = Math.round(empruntVal * 0.72);
    const oatSecu         = empruntVal - oatEtat;

    // Budget État = recettes hors TVA hors OAT + TVA part État + OAT part État
    const budgetEtat      = recHorsTvaOat + tvaVersEtat + oatEtat;
    // Budget Sécu = cotisations + CSG + autres + TVA part Sécu + OAT part Sécu
    const budgetSecu      = totalPlfssVal + tvaVersSecu + oatSecu;

    const totalDepPlf     = depenses_plf.reduce((s, p) => s + p.valeurEffective, 0);
    const totalDepPlfss   = depenses_plfss.reduce((s, p) => s + p.valeurEffective, 0);
    const soldeEtat       = budgetEtat - totalDepPlf;
    const soldeSecu       = budgetSecu - totalDepPlfss;

    // ── Nœuds ────────────────────────────────────────────────────────────
    type ND = {
      key: string; label: string; val: number; color: string; col: number;
      infobulle?: string; source?: string; posteId?: string;
    };

    // Col 0 — recettes (PLF fiscales hors TVA, puis TVA, puis OAT, puis PLFSS)
    const nodesA: ND[] = [
      // Recettes PLF hors OAT hors TVA
      ...autresPlf.map(p => ({
        key: `r_${p.id}`, label: p.label, val: p.valeurEffective,
        color: C.rec_plf, col: 0,
        infobulle: p.infobulle, source: p.source, posteId: p.id,
      })),
      // TVA (nœud source du split)
      ...(tvaPoste ? [{
        key: 'r_tva', label: tvaPoste.label, val: tvaPoste.valeurEffective,
        color: C.rec_plf, col: 0,
        infobulle: tvaPoste.infobulle, source: tvaPoste.source, posteId: 'tva',
      }] : []),
      // OAT (emprunt — orange)
      ...(oatPoste ? [{
        key: 'r_oat', label: oatPoste.label, val: oatPoste.valeurEffective,
        color: C.oat, col: 0,
        infobulle: oatPoste.infobulle ?? props.emprunt_infobulle,
        source: oatPoste.source ?? 'AFT 2025', posteId: 'oat',
      }] : []),
      // Recettes PLFSS
      ...recettes_plfss.map(p => ({
        key: `r_${p.id}`, label: p.label, val: p.valeurEffective,
        color: C.rec_plfss, col: 0,
        infobulle: p.infobulle, source: p.source, posteId: p.id,
      })),
    ];

    // Col 1 — Budget État, Collectivités TVA, Budget Sécu
    // c_coll : même col:1 que c_etat → D3 lui applique le même padding naturellement
    const nodesB: ND[] = [
      { key: 'c_etat', label: 'Budget État',         val: budgetEtat,  color: C.rec_plf,   col: 1 },
      { key: 'c_coll', label: 'Collectivités (TVA)', val: tvaVersColl, color: C.tva_coll,  col: 1,
        infobulle: 'Fraction de TVA directement affectée aux collectivités territoriales (75 Mrd). Compensation de la suppression de la CVAE, dotation globale de fonctionnement des régions. Cette TVA ne transite pas par le Budget de l\'État : elle est affectée à la source par la loi de finances.' },
      { key: 'c_secu', label: 'Budget Sécu',         val: budgetSecu,  color: C.rec_plfss, col: 1 },
    ];

    // Col 2 — dépenses
    const nodesD: ND[] = [
      ...depenses_plf.map(p => ({
        key: `d_${p.id}`, label: p.label, val: p.valeurEffective,
        color: C.dep_plf, col: 2,
        infobulle: p.infobulle, source: p.source, posteId: p.id,
      })),
    ];

    // TVA→Collectivités : nœud en col 1 (c_coll), pas en col 2
    // TVA→Audiovisuel : intégré dans tvaVersEtat (taux_tva_audiovisuel = 0), pas de nœud séparé

    // Déficit État : affiché dans les indicateurs bas, pas dans le Sankey

    // Dépenses PLFSS
    nodesD.push(...depenses_plfss.map(p => ({
      key: `d_${p.id}`, label: p.label, val: p.valeurEffective,
      color: C.dep_plfss, col: 2,
      infobulle: p.infobulle, source: p.source, posteId: p.id,
    })));

    // Déficit Sécu : affiché dans les indicateurs bas, pas dans le Sankey

    // ── Ordre de tri ─────────────────────────────────────────────────────
    const sortOrder: Record<string, number> = {};
    // TVA après les autres recettes PLF (sous "Autres recettes" en col0)
    autresPlf.forEach((p, i) => { sortOrder[`r_${p.id}`] = i; });
    sortOrder['r_tva'] = autresPlf.length;
    sortOrder['r_oat']  = autresPlf.length + 1;
    recettes_plfss.forEach((p, i) => { sortOrder[`r_${p.id}`] = autresPlf.length + 2 + i; });
    sortOrder['c_etat'] = 0;
    sortOrder['c_coll'] = 1;  // Collectivités TVA entre Budget État et Budget Sécu
    sortOrder['c_secu'] = 2;
    depenses_plf.forEach((p, i)   => { sortOrder[`d_${p.id}`] = i; });
    depenses_plfss.forEach((p, i) => { sortOrder[`d_${p.id}`] = depenses_plf.length + i; });


    const allNodes = [...nodesA, ...nodesB, ...nodesD];
    const idx = new Map(allNodes.map((n, i) => [n.key, i]));

    // ── Liens ────────────────────────────────────────────────────────────
    type LD = { source: string; target: string; value: number; color: string };
    const raw: LD[] = [];

    // Recettes PLF hors TVA hors OAT → Budget État
    autresPlf.forEach(p => {
      raw.push({ source: `r_${p.id}`, target: 'c_etat', value: p.valeurEffective, color: C.rec_plf });
    });

    // TVA après les autres → nœud TVA sous les autres recettes
    if (tvaPoste) {
      if (tvaVersEtat > 0.5) raw.push({ source: 'r_tva', target: 'c_etat', value: tvaVersEtat, color: C.rec_plf  });
      if (tvaVersSecu > 0.5) raw.push({ source: 'r_tva', target: 'c_secu', value: tvaVersSecu, color: C.rec_plf  });
      if (tvaVersColl > 0.5) raw.push({ source: 'r_tva', target: 'c_coll', value: tvaVersColl, color: C.tva_coll });
    }

    // OAT → État (72%) + Sécu (28%)
    raw.push({ source: 'r_oat', target: 'c_etat', value: oatEtat, color: C.oat });
    raw.push({ source: 'r_oat', target: 'c_secu', value: oatSecu, color: C.oat });

    // Recettes PLFSS → Budget Sécu
    recettes_plfss.forEach(p => {
      raw.push({ source: `r_${p.id}`, target: 'c_secu', value: p.valeurEffective, color: C.rec_plfss });
    });

    // Budget État → dépenses PLF
    depenses_plf.forEach(p => {
      raw.push({ source: 'c_etat', target: `d_${p.id}`, value: p.valeurEffective, color: C.dep_plf });
    });


    // Budget Sécu → dépenses PLFSS
    depenses_plfss.forEach(p => {
      raw.push({ source: 'c_secu', target: `d_${p.id}`, value: p.valeurEffective, color: C.dep_plfss });
    });


    const sankeyLinks = raw
      .filter(l => idx.has(l.source) && idx.has(l.target) && l.value > 0.1)
      .map(l => ({ source: idx.get(l.source)!, target: idx.get(l.target)!, value: l.value, color: l.color }));

    // ── Layout Sankey ────────────────────────────────────────────────────
    // nodeAlign custom : force c_coll à depth 1 (même colonne que c_etat)
    // sankeyLeft place les nœuds à leur depth calculé par le graphe
    // Pour c_coll (sink sans liens sortants), on override la depth à 1
    const customAlign = (node: any, n: number) => {
      if ((node as ND).key === 'c_coll') return 1;
      return sankeyLeft(node, n);
    };

    const gen = d3sankey<ND, typeof sankeyLinks[0]>()
      .nodeId((_: any, i: number) => i)
      .nodeAlign(customAlign)
      .nodeSort((a: any, b: any) => (sortOrder[(a as ND).key] ?? 999) - (sortOrder[(b as ND).key] ?? 999))
      .nodeWidth(14)
      .nodePadding(isPortrait ? 8 : 12)
      .extent([[ML, MT], [width - MR, H - MB]]);

    let graph: any;
    try { graph = gen({ nodes: allNodes.map(n => ({ ...n })), links: sankeyLinks }); }
    catch { return; }

    // ── Padding minimum 25px sur les nœuds centraux (col 1) ─────────────
    const MIN_CENTRE_H = 25;
    graph.nodes.forEach((n: any) => {
      if ((n as ND).col === 1) {
        const h = (n.y1 ?? 0) - (n.y0 ?? 0);
        if (h < MIN_CENTRE_H) {
          const extra = (MIN_CENTRE_H - h) / 2;
          n.y0 = (n.y0 ?? 0) - extra;
          n.y1 = (n.y1 ?? 0) + extra;
        }
      }
    });



    // ── Dégradés ────────────────────────────────────────────────────────
    const defs = svg.append('defs');
    graph.links.forEach((lk: any, i: number) => {
      const lc = lk.color ?? C.rec_plf;
      const g = defs.append('linearGradient')
        .attr('id', `g${i}`).attr('gradientUnits', 'userSpaceOnUse')
        .attr('x1', lk.source.x1 ?? 0).attr('x2', lk.target.x0 ?? 0);
      g.append('stop').attr('offset', '0%').attr('stop-color', lc).attr('stop-opacity', 0.55);
      g.append('stop').attr('offset', '100%').attr('stop-color', lc).attr('stop-opacity', 0.3);
    });

    // ── Liens dessinés ───────────────────────────────────────────────────
    svg.append('g').selectAll('path')
      .data(graph.links)
      .join('path')
      .attr('d', sankeyLinkHorizontal())
      .attr('fill', 'none')
      .attr('stroke', (_: any, i: number) => `url(#g${i})`)
      .attr('stroke-width', (d: any) => Math.max(1, d.width ?? 1))
      .attr('opacity', 0.7)
      .style('cursor', 'pointer')
      .on('mouseover', function() { d3.select(this).attr('opacity', 1); })
      .on('mouseout',  function() { d3.select(this).attr('opacity', 0.7); })
      .on('click', (_: any, d: any) => {
        const sN = allNodes[typeof d.source === 'object' ? d.source.index : d.source] as ND;
        const tN = allNodes[typeof d.target === 'object' ? d.target.index : d.target] as ND;
        const pid = tN?.posteId ?? sN?.posteId ?? '';
        const acts = mesuresActives.filter(m => m.poste === pid);
        // Infobulle pédagogique selon le flux
        const fluxInfobulles: Record<string, string> = {
          'r_tva→c_etat': `Part de TVA affectée au Budget de l'État (${tvaVersEtat} Mrd€). Calculée en appliquant le taux légal de répartition (${(taux_tva_etat*100).toFixed(1)}%) à la TVA brute collectée (${tvaVal} Mrd€). Inclut la contribution à l'audiovisuel public.`,
          'r_tva→c_secu': `Part de TVA affectée à la Sécurité sociale (${tvaVersSecu} Mrd€, taux ${(taux_tva_secu*100).toFixed(1)}%). Compense partiellement les allègements de cotisations patronales (Fillon, etc.) — mécanisme dit de "compensation" prévu par la loi Veil de 1994.`,
          'r_tva→c_coll': `Part de TVA affectée directement aux collectivités territoriales (${tvaVersColl} Mrd€, taux ${(taux_tva_collectivites*100).toFixed(1)}%). Substitut à la CVAE supprimée en 2023. Ne transite pas par le Budget de l'État.`,
          'r_oat→c_etat': `Part de l'emprunt OAT finançant le Budget de l'État (${oatEtat} Mrd€, soit 72% du total). Les OAT (Obligations Assimilables du Trésor) sont émises par l'AFT (Agence France Trésor). Leur remboursement est garanti par l'État mais crée une dette future.`,
          'r_oat→c_secu': `Part de l'emprunt finançant la Sécurité sociale (${oatSecu} Mrd€, soit 28% du total). Géré via l'ACOSS (URSSAF Caisse Nationale). La CADES (Caisse d'Amortissement de la Dette Sociale) assure le remboursement progressif de la dette sociale accumulée.`,
        };
        const fluxKey = `${sN?.key}→${tN?.key}`;
        const infobulle = fluxInfobulles[fluxKey]
          ?? `Ce flux de ${d.value.toFixed(0)} Mrd€ représente le transfert de "${sN?.label ?? ''}" vers "${tN?.label ?? ''}". Il reflète la logique de consolidation du budget public : les recettes sont collectées puis allouées aux enveloppes de dépenses selon les clés légales.`;
        setModal({
          title: `${sN?.label ?? ''} → ${tN?.label ?? ''}`,
          infobulle,
          montant: d.value,
          montant_pct: `${((d.value / (sN?.val ?? d.value)) * 100).toFixed(1)} % de ${sN?.label ?? 'la source'}`,
          source: 'PLF 2025 — Voies & Moyens Tome 1 · PLFSS 2025 Annexe 3',
          type: 'flux',
          deltas: acts.map(m => ({ label: m.label, val: (m.impact_min + m.impact_max) / 2, statut: m.statut, effets: m.effets_indirects, source: m.source_label })),
        });
      });

    // ── Nœuds + labels ───────────────────────────────────────────────────
    const FS  = isPortrait ? 9  : 11;
    const FSV = isPortrait ? 8  : 10;
    const FF  = 'Inter, system-ui, sans-serif';

    graph.nodes.forEach((node: any) => {
      const nd   = node as ND;
      const x0   = node.x0 ?? 0, x1 = node.x1 ?? 0;
      const y0   = node.y0 ?? 0, y1 = node.y1 ?? 0;
      const nh   = Math.max(2, y1 - y0);
      const yMid = (y0 + y1) / 2;
      const col  = nd.col;
      const isLeft   = col === 0;
      const isRight  = col === 2;
      const isCentre = col === 1;

      // Rectangle
      svg.append('rect')
        .attr('x', x0).attr('y', y0).attr('width', x1 - x0).attr('height', nh)
        .attr('fill', nd.color).attr('rx', 2).attr('opacity', 0.92)
        .style('cursor', 'pointer')
        .on('click', () => {
          const pid = nd.posteId ?? nd.key.replace(/^[rdc]_/, '');
          const acts = mesuresActives.filter(m => m.poste === pid);
          const totalRef = nd.col === 0
            ? (nd.color === C.rec_plf ? recettes_plf.reduce((s,p)=>s+p.valeurEffective,0) : recettes_plfss.reduce((s,p)=>s+p.valeurEffective,0))
            : nd.col === 2
              ? (nd.color === C.dep_plf ? depenses_plf.reduce((s,p)=>s+p.valeurEffective,0) : depenses_plfss.reduce((s,p)=>s+p.valeurEffective,0))
              : 0;
          const pct = totalRef > 0 ? ((nd.val / totalRef) * 100).toFixed(1) : null;
          const typeKey: ModalInfo['type'] = nd.col === 0
            ? (nd.color === C.rec_plf ? 'recette_plf' : 'recette_plfss')
            : nd.col === 2
              ? (nd.color === C.dep_plf ? 'depense_plf' : 'depense_plfss')
              : 'pool';
          setModal({
            title: nd.label,
            infobulle: nd.infobulle ?? `Ce poste représente ${(nd.val ?? 0).toFixed(0)} milliards d'euros.`,
            montant: nd.val,
            montant_pct: pct ? `${pct} % du total` : undefined,
            source: nd.source,
            type: typeKey,
            deltas: acts.map(m => ({ label: m.label, val: (m.impact_min + m.impact_max) / 2, statut: m.statut, effets: m.effets_indirects, source: m.source_label })),
          });
        });

      const valStr = `${(nd.val ?? 0).toFixed(0)} mds`;

      if (isCentre) {
        // Tous les nœuds centraux (Budget État, Collectivités TVA, Budget Sécu)
        // ont le même format : 2 lignes centrées dans le nœud — blanc gras / gris clair
        // L'espacement vertical s'adapte à la hauteur disponible
        const lineOffset = Math.min(7, Math.max(4, nh * 0.25));
        svg.append('text')
          .attr('x', (x0 + x1) / 2).attr('y', yMid - lineOffset)
          .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
          .attr('fill', C.white).attr('font-size', FS).attr('font-weight', 700).attr('font-family', FF)
          .text(nd.label.length > 18 ? nd.label.slice(0, 16) + '…' : nd.label);
        svg.append('text')
          .attr('x', (x0 + x1) / 2).attr('y', yMid + lineOffset)
          .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
          .attr('fill', C.white).attr('font-size', FSV).attr('font-family', FF)
          .text(valStr);
      } else {
        const labelX = isLeft ? x0 - 8 : x1 + 8;
        const anchor = isLeft ? 'end' : 'start';
        const lineGap = 13;
        const ly1 = nh >= 12 ? yMid - lineGap / 2 : yMid - 5;
        const ly2 = nh >= 12 ? yMid + lineGap / 2 + 1 : yMid + 7;
        svg.append('text')
          .attr('x', labelX).attr('y', ly1)
          .attr('text-anchor', anchor).attr('dominant-baseline', 'central')
          .attr('fill', '#F1F5F9')
          .attr('font-size', FS).attr('font-weight', 600).attr('font-family', FF)
          .text(nd.label.length > 24 ? nd.label.slice(0, 22) + '…' : nd.label);
        svg.append('text')
          .attr('x', labelX).attr('y', ly2)
          .attr('text-anchor', anchor).attr('dominant-baseline', 'central')
          .attr('fill', '#94A3B8')
          .attr('font-size', FSV).attr('font-weight', 400).attr('font-family', FF)
          .text(valStr);
      }

      // Delta mesure active
      const pid   = nd.posteId ?? nd.key.replace(/^[rdc]_/, '');
      const delta = deltas[pid];
      if (delta && !isCentre) {
        const dv  = (delta.min + delta.max) / 2;
        const dc  = dv >= 0 ? C.dp : C.dn;
        const bx  = isLeft ? x1 + 2 : x0 - 2;
        const ba  = isLeft ? 'start' : 'end';
        svg.append('text')
          .attr('x', bx).attr('y', y0 + 9)
          .attr('text-anchor', ba).attr('fill', dc)
          .attr('font-size', isPortrait ? 8 : 10).attr('font-weight', 700).attr('font-family', FF)
          .text(`${dv >= 0 ? '▲ +' : '▼ '}${dv.toFixed(0)}`);
      }
    });

    // En-têtes colonnes
    const aNodes = graph.nodes.filter((n: any) => (n as ND).col === 0);
    const dNodes = graph.nodes.filter((n: any) => (n as ND).col === 2);
    if (aNodes.length) {
      svg.append('text')
        .attr('x', aNodes[0].x0).attr('y', MT - 10)
        .attr('text-anchor', 'start').attr('fill', C.rec_plf)
        .attr('font-size', isPortrait ? 9 : 11).attr('font-weight', 700).attr('font-family', FF)
        .text('Recettes');
    }
    if (dNodes.length) {
      svg.append('text')
        .attr('x', dNodes[0].x1).attr('y', MT - 10)
        .attr('text-anchor', 'end').attr('fill', C.dep_plf)
        .attr('font-size', isPortrait ? 9 : 11).attr('font-weight', 700).attr('font-family', FF)
        .text('Dépenses');
    }

    // Légende OAT
    svg.append('text')
      .attr('x', width / 2).attr('y', H - 2)
      .attr('text-anchor', 'middle').attr('fill', C.oat)
      .attr('font-size', 9).attr('font-family', FF)
      .text('🟠 Emprunt OAT = passif (dette future) — pas une recette fiscale');

  }, [width, H, ML, MR, MT, MB, props]);

  return (
    <div ref={containerRef} style={{ width: '100%', position: 'relative', background: 'var(--bg-card)', borderRadius: '12px', padding: '4px 0' }}>
      <svg ref={svgRef} style={{ display: 'block', width: '100%' }} />

      {modal && (
        <div className="sk-overlay" onClick={() => setModal(null)}>
          <div className="sk-modal" onClick={e => e.stopPropagation()}>

            {/* ── En-tête ── */}
            <div className="sk-header">
              <div className="sk-header-left">
                {modal.type && TYPE_LABEL[modal.type] && (
                  <span className="sk-type-badge" style={{ color: TYPE_LABEL[modal.type].color, borderColor: TYPE_LABEL[modal.type].color + '44', background: TYPE_LABEL[modal.type].color + '15' }}>
                    {TYPE_LABEL[modal.type].label}
                  </span>
                )}
                <h3 className="sk-title">{modal.title}</h3>
              </div>
              <button className="sk-close" onClick={() => setModal(null)}>✕</button>
            </div>

            {/* ── Bloc valeur ── */}
            {modal.montant !== undefined && (
              <div className="sk-valeur-bloc">
                <div className="sk-valeur-left">
                  <span className="sk-valeur-label">Montant</span>
                  <span className="sk-valeur">{modal.montant.toFixed(0)} Mrd €</span>
                </div>
                {modal.montant_pct && (
                  <span className="sk-valeur-pct">{modal.montant_pct}</span>
                )}
              </div>
            )}

            {/* ── Infobulle principale ── */}
            <div className="sk-infobulle">
              {modal.infobulle.split('

').map((para, i) => (
                <p key={i} className="sk-infobulle-para">{para}</p>
              ))}
            </div>

            {/* ── Mesures actives sur ce poste ── */}
            {modal.deltas && modal.deltas.length > 0 && (
              <div className="sk-deltas">
                <div className="sk-deltas-title">Mesures actives sur ce poste</div>
                {modal.deltas.map((d, i) => (
                  <div key={i} className={`sk-delta-item ${d.val >= 0 ? 'sk-pos' : 'sk-neg'}`}>
                    <div className="sk-delta-header">
                      <span className="sk-delta-label">{d.label}</span>
                      <span className="sk-delta-val">{fmt(d.val)}</span>
                      {d.statut && (
                        <span className="sk-badge" style={{ color: STATUT_COLOR[d.statut] ?? C.muted, borderColor: (STATUT_COLOR[d.statut] ?? C.muted) + '44', background: (STATUT_COLOR[d.statut] ?? C.muted) + '15' }}>
                          {STATUT_LABEL[d.statut] ?? d.statut.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                    {d.effets && d.effets.length > 0 && (
                      <ul className="sk-effets">{d.effets.map((e, j) => <li key={j}>{e}</li>)}</ul>
                    )}
                    {d.source && <p className="sk-delta-source">Source : {d.source}</p>}
                  </div>
                ))}
              </div>
            )}

            {/* ── Note méthodologique ── */}
            {modal.note && (
              <div className="sk-note">
                <span className="sk-note-title">Note méthodologique</span>
                <p className="sk-note-body">{modal.note}</p>
              </div>
            )}

            {/* ── Footer source ── */}
            {modal.source && (
              <div className="sk-footer">
                <span className="sk-footer-label">Source</span>
                <span className="sk-footer-val">{modal.source}</span>
              </div>
            )}

          </div>
        </div>
      )}

      <style>{`
        /* ── Overlay & modal ── */
        .sk-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.72); z-index: 300; display: flex; align-items: center; justify-content: center; padding: 1rem; }
        .sk-modal { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 0; max-width: 480px; width: 100%; display: flex; flex-direction: column; gap: 0; max-height: 88vh; overflow-y: auto; }

        /* ── En-tête ── */
        .sk-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; padding: 1.1rem 1.25rem 0.9rem; border-bottom: 1px solid #1e293b; }
        .sk-header-left { display: flex; flex-direction: column; gap: 0.3rem; flex: 1; min-width: 0; }
        .sk-type-badge { display: inline-flex; align-items: center; padding: 1px 7px; border-radius: 9999px; font-size: 0.62rem; font-weight: 700; letter-spacing: 0.04em; border: 1px solid; width: fit-content; text-transform: uppercase; }
        .sk-title { font-size: 0.95rem; font-weight: 600; color: #e2e8f0; margin: 0; line-height: 1.3; }
        .sk-close { background: none; border: none; color: #64748b; cursor: pointer; font-size: 1rem; padding: 0; flex-shrink: 0; margin-top: 2px; }
        .sk-close:hover { color: #e2e8f0; }

        /* ── Bloc valeur ── */
        .sk-valeur-bloc { display: flex; justify-content: space-between; align-items: center; padding: 0.65rem 1.25rem; background: #0d1117; border-bottom: 1px solid #1e293b; }
        .sk-valeur-left { display: flex; flex-direction: column; gap: 0.05rem; }
        .sk-valeur-label { font-size: 0.6rem; color: #475569; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
        .sk-valeur { font-size: 1.5rem; font-weight: 700; color: #f1f5f9; line-height: 1.1; }
        .sk-valeur-pct { font-size: 0.72rem; color: #64748b; text-align: right; }

        /* ── Infobulle principale ── */
        .sk-infobulle { margin: 0.9rem 1.25rem 0; background: #0d1117; border-radius: 8px; padding: 0.75rem 0.875rem; border-left: 3px solid #2563EB; display: flex; flex-direction: column; gap: 0.45rem; }
        .sk-infobulle-para { font-size: 0.79rem; color: #94a3b8; line-height: 1.65; margin: 0; }

        /* ── Mesures actives ── */
        .sk-deltas { margin: 0.75rem 1.25rem 0; display: flex; flex-direction: column; gap: 0.4rem; }
        .sk-deltas-title { font-size: 0.62rem; color: #475569; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; padding-bottom: 0.35rem; border-bottom: 1px solid #1e293b; }
        .sk-delta-item { padding: 0.55rem 0.75rem; border-radius: 6px; display: flex; flex-direction: column; gap: 0.3rem; }
        .sk-pos { background: rgba(5,150,105,0.08); border: 1px solid rgba(5,150,105,0.22); }
        .sk-neg { background: rgba(234,88,12,0.08); border: 1px solid rgba(234,88,12,0.22); }
        .sk-delta-header { display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; }
        .sk-delta-label { font-size: 0.79rem; font-weight: 500; color: #cbd5e1; flex: 1; line-height: 1.35; }
        .sk-delta-val { font-size: 0.88rem; font-weight: 700; white-space: nowrap; }
        .sk-pos .sk-delta-val { color: #10b981; }
        .sk-neg .sk-delta-val { color: #f97316; }
        .sk-badge { font-size: 0.62rem; padding: 1px 6px; border-radius: 9999px; border: 1px solid; font-weight: 500; white-space: nowrap; }
        .sk-effets { list-style: none; margin: 0.1rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.2rem; }
        .sk-effets li { font-size: 0.72rem; color: #64748b; padding-left: 1rem; position: relative; line-height: 1.45; }
        .sk-effets li::before { content: '→'; position: absolute; left: 0; color: #334155; }
        .sk-delta-source { font-size: 0.63rem; color: #334155; font-style: italic; margin: 0.1rem 0 0; }

        /* ── Note méthodologique ── */
        .sk-note { margin: 0.75rem 1.25rem 0; background: rgba(210,153,34,0.07); border: 1px solid rgba(210,153,34,0.2); border-radius: 8px; padding: 0.65rem 0.875rem; display: flex; flex-direction: column; gap: 0.3rem; }
        .sk-note-title { font-size: 0.62rem; color: #d29922; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
        .sk-note-body { font-size: 0.76rem; color: #94a3b8; line-height: 1.6; margin: 0; }

        /* ── Footer source ── */
        .sk-footer { display: flex; gap: 0.5rem; align-items: baseline; padding: 0.65rem 1.25rem; margin-top: 0.75rem; border-top: 1px solid #1e293b; }
        .sk-footer-label { font-size: 0.6rem; color: #334155; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; white-space: nowrap; }
        .sk-footer-val { font-size: 0.7rem; color: #475569; font-style: italic; }
      `}</style>
    </div>
  );
}
