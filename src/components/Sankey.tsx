import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { sankey as d3sankey, sankeyLinkHorizontal } from 'd3-sankey';

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
  compensationSecu: number; emprunt: number;
  emprunt_infobulle: string; compensation_infobulle: string;
  deltas: Record<string, { min: number; max: number }>;
  mesuresActives: MesureActive[];
}
interface ModalInfo {
  title: string; body: string; source?: string; montant?: number;
  deltas?: Array<{ label: string; val: number; statut?: string; effets?: string[]; source?: string }>;
}

// ── Couleurs ───────────────────────────────────────────────────────────────
const C = {
  rec_plf:   '#2563EB',
  rec_plfss: '#0EA5E9',
  dep_plf:   '#7C3AED',
  dep_plfss: '#A855F7',
  oat:       '#EA580C',
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
  const H  = Math.min(580, Math.round(isPortrait ? width * 1.4 : width * 0.50));
  const ML = isPortrait ? 100 : 160;   // marge gauche labels
  const MR = isPortrait ? 100 : 160;   // marge droite labels
  const MT = 32;                        // marge top (en-têtes)
  const MB = 12;

  useEffect(() => {
    if (!svgRef.current || width === 0) return;
    const { recettes_plf, recettes_plfss, depenses_plf, depenses_plfss,
            compensationSecu, emprunt, deltas, mesuresActives } = props;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${H}`).attr('width', width).attr('height', H);

    // ── Totaux ───────────────────────────────────────────────────────────
    // Séparer l'OAT des recettes fiscales
    const oatPoste      = recettes_plf.find(p => p.id === 'oat');
    const recettesFiscPlf = recettes_plf.filter(p => p.id !== 'oat');
    const empruntVal    = oatPoste?.valeurEffective ?? emprunt;
    const totalPlfBrut  = recettesFiscPlf.reduce((s, p) => s + p.valeurEffective, 0);
    const totalPlfssVal = recettes_plfss.reduce((s, p) => s + p.valeurEffective, 0);
    const plfNet        = totalPlfBrut - compensationSecu;
    const plfssNet      = totalPlfssVal + compensationSecu;
    const oatEtat       = Math.round(empruntVal * 0.72);
    const oatSecu       = empruntVal - oatEtat;
    const budgetEtat    = plfNet + oatEtat;
    const budgetSecu    = plfssNet + oatSecu;
    const totalDepPlf   = depenses_plf.reduce((s, p) => s + p.valeurEffective, 0);
    const totalDepPlfss = depenses_plfss.reduce((s, p) => s + p.valeurEffective, 0);
    const soldeEtat     = budgetEtat - totalDepPlf;
    const soldeSecu     = budgetSecu - totalDepPlfss;
    const tvaVal        = recettesFiscPlf.find(p => p.id === 'tva')?.valeurEffective ?? 216;
    const ratioComp     = compensationSecu / Math.max(tvaVal, 1);

    // ── Nœuds ────────────────────────────────────────────────────────────
    type ND = {
      key: string; label: string; val: number; color: string; col: number;
      infobulle?: string; source?: string; posteId?: string;
      fixedY?: number; // pour fixer l'ordre vertical col centrale
    };

    const nodesA: ND[] = [
      ...recettesFiscPlf.map(p => ({
        key: `r_${p.id}`, label: p.label, val: p.valeurEffective,
        color: C.rec_plf, col: 0,
        infobulle: p.infobulle, source: p.source, posteId: p.id,
      })),
      ...recettes_plfss.map(p => ({
        key: `r_${p.id}`, label: p.label, val: p.valeurEffective,
        color: C.rec_plfss, col: 0,
        infobulle: p.infobulle, source: p.source, posteId: p.id,
      })),
    ];

    // Colonne centrale : OAT en haut, Budget État, Budget Sécu — ordre fixe
    const nodesB: ND[] = [
      { key: 'c_etat', label: 'Budget État',   val: budgetEtat, color: C.rec_plf,   col: 1 },
      { key: 'c_secu', label: 'Budget Sécu',   val: budgetSecu, color: C.rec_plfss, col: 1 },
      { key: 'c_oat',  label: 'Emprunt (OAT)', val: empruntVal, color: C.oat,       col: 1, infobulle: oatPoste?.infobulle ?? props.emprunt_infobulle, source: oatPoste?.source ?? 'AFT 2025' },
    ];

    const nodesD: ND[] = [
      ...depenses_plf.map(p => ({
        key: `d_${p.id}`, label: p.label, val: p.valeurEffective,
        color: C.dep_plf, col: 2,
        infobulle: p.infobulle, source: p.source, posteId: p.id,
      })),
      ...depenses_plfss.map(p => ({
        key: `d_${p.id}`, label: p.label, val: p.valeurEffective,
        color: C.dep_plfss, col: 2,
        infobulle: p.infobulle, source: p.source, posteId: p.id,
      })),
    ];
    // Déficit État : toujours présent, positionné entre dépenses PLF et PLFSS
    if (Math.abs(soldeEtat) > 0.5) nodesD.splice(depenses_plf.length, 0, {
      key: 'd_solde_etat', col: 2, val: Math.abs(soldeEtat),
      label: soldeEtat >= 0 ? 'Surplus État' : 'Déficit État',
      color: soldeEtat >= 0 ? C.surplus : C.deficit,
      infobulle: `Déficit de ${Math.abs(soldeEtat).toFixed(0)} mds du budget de l'État — différence entre recettes fiscales consolidées et dépenses PLF. La France est en déficit structurel depuis 1974.`,
    });
    if (Math.abs(soldeSecu) > 0.5) nodesD.push({
      key: 'd_solde_secu', col: 2, val: Math.abs(soldeSecu),
      label: soldeSecu >= 0 ? 'Surplus Sécu' : 'Déficit Sécu',
      color: soldeSecu >= 0 ? C.surplus : C.deficit,
      infobulle: `${soldeSecu >= 0 ? 'Excédent' : 'Déficit'} de ${Math.abs(soldeSecu).toFixed(0)} mds de la Sécurité sociale.`,
    });

    // Ordre explicite pour chaque colonne — utilisé par nodeSort
    const sortOrder: Record<string, number> = {};
    // Col 0 : recettes PLF dans l'ordre du JSON, puis OAT, puis PLFSS
    recettes_plf.forEach((p, i)   => { sortOrder[`r_${p.id}`] = i; });
    sortOrder['c_oat'] = recettesFiscPlf.length;
    recettes_plfss.forEach((p, i) => { sortOrder[`r_${p.id}`] = recettes_plf.length + 1 + i; });
    // Col 1 : Budget État puis Budget Sécu
    sortOrder['c_etat'] = 0;
    sortOrder['c_secu'] = 1;
    // Col 2 : dépenses PLF puis PLFSS puis soldes
    depenses_plf.forEach((p, i)   => { sortOrder[`d_${p.id}`] = i; });
    depenses_plfss.forEach((p, i) => { sortOrder[`d_${p.id}`] = depenses_plf.length + i; });
    // Déficit État entre les dépenses PLF et PLFSS
    sortOrder['d_solde_etat'] = depenses_plf.length;
    depenses_plfss.forEach((p, i) => { sortOrder[`d_${p.id}`] = depenses_plf.length + 1 + i; });
    sortOrder['d_solde_secu'] = depenses_plf.length + 1 + depenses_plfss.length;

    const allNodes = [...nodesA, ...nodesB, ...nodesD];
    const idx = new Map(allNodes.map((n, i) => [n.key, i]));

    // ── Liens ────────────────────────────────────────────────────────────
    type LD = { source: string; target: string; value: number; color: string };
    const raw: LD[] = [];

    // TVA en premier (fiscal + compensation), puis les autres recettes fiscales PLF (sans OAT)
    const tvaPoste = recettesFiscPlf.find(p => p.id === 'tva');
    const autresPlf = recettesFiscPlf.filter(p => p.id !== 'tva');
    const orderedPlf = tvaPoste ? [tvaPoste, ...autresPlf] : recettesFiscPlf;

    orderedPlf.forEach(p => {
      const comp = p.id === 'tva' ? Math.round(p.valeurEffective * ratioComp) : 0;
      const fisc = p.valeurEffective - comp;
      if (fisc > 0.5) raw.push({ source: `r_${p.id}`, target: 'c_etat', value: fisc, color: C.rec_plf });
      if (comp > 0.5) raw.push({ source: `r_${p.id}`, target: 'c_secu', value: comp, color: C.rec_plf });
    });
    recettes_plfss.forEach(p => raw.push({ source: `r_${p.id}`, target: 'c_secu', value: p.valeurEffective, color: C.rec_plfss }));
    raw.push({ source: 'c_oat', target: 'c_etat', value: oatEtat, color: C.oat });
    raw.push({ source: 'c_oat', target: 'c_secu', value: oatSecu, color: C.oat });
    depenses_plf.forEach(p =>  raw.push({ source: 'c_etat', target: `d_${p.id}`, value: p.valeurEffective, color: C.dep_plf }));
    depenses_plfss.forEach(p => raw.push({ source: 'c_secu', target: `d_${p.id}`, value: p.valeurEffective, color: C.dep_plfss }));
    if (Math.abs(soldeEtat) > 0.5) raw.push({ source: 'c_etat', target: 'd_solde_etat', value: Math.abs(soldeEtat), color: soldeEtat >= 0 ? C.surplus : C.deficit });
    if (Math.abs(soldeSecu) > 0.5) raw.push({ source: 'c_secu', target: 'd_solde_secu', value: Math.abs(soldeSecu), color: soldeSecu >= 0 ? C.surplus : C.deficit });

    const sankeyLinks = raw
      .filter(l => idx.has(l.source) && idx.has(l.target) && l.value > 0.1)
      .map(l => ({ source: idx.get(l.source)!, target: idx.get(l.target)!, value: l.value, color: l.color }));

    // ── Layout Sankey ────────────────────────────────────────────────────
    const gen = d3sankey<ND, typeof sankeyLinks[0]>()
      .nodeId((_: any, i: number) => i)
      .nodeSort((a: any, b: any) => {
        const oa = sortOrder[(a as ND).key] ?? 999;
        const ob = sortOrder[(b as ND).key] ?? 999;
        return oa - ob;
      })
      .nodeWidth(14)
      .nodePadding(isPortrait ? 8 : 14)
      // nodeSort null = D3 ne réordonne pas nos nœuds
      .extent([[ML, MT], [width - MR, H - MB]]);

    let graph: any;
    try { graph = gen({ nodes: allNodes.map(n => ({ ...n })), links: sankeyLinks }); }
    catch { return; }

    // ── Forcer l'ordre des flux entrants sur Budget État ─────────────────
    const etatNode = graph.nodes.find((n: any) => n.key === 'c_etat');
    if (etatNode) {
      const sourceOrder = ['r_tva', 'r_ir', 'r_is', 'r_ticpe', 'r_autres_plf', 'c_oat'];
      const inLinks = graph.links.filter((l: any) => {
        const t = typeof l.target === 'object' ? l.target : graph.nodes[l.target];
        return t?.key === 'c_etat';
      });
      inLinks.sort((a: any, b: any) => {
        const ka = (typeof a.source === 'object' ? a.source : graph.nodes[a.source])?.key ?? '';
        const kb = (typeof b.source === 'object' ? b.source : graph.nodes[b.source])?.key ?? '';
        return (sourceOrder.indexOf(ka) === -1 ? 99 : sourceOrder.indexOf(ka))
             - (sourceOrder.indexOf(kb) === -1 ? 99 : sourceOrder.indexOf(kb));
      });
      let curY = etatNode.y0;
      inLinks.forEach((l: any) => {
        const lw = l.width ?? 1;
        l.y1 = curY + lw / 2;
        curY += lw;
      });
    }

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
        setModal({
          title: `${sN?.label ?? ''} → ${tN?.label ?? ''}`,
          body: `Flux de ${d.value.toFixed(0)} milliards d'euros de "${sN?.label}" vers "${tN?.label}".`,
          source: 'PLF / PLFSS 2025', montant: d.value,
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
      const isCentre = col === 1 && nd.key !== 'c_oat';

      // ── Rectangle ───────────────────────────────────────────────────
      svg.append('rect')
        .attr('x', x0).attr('y', y0).attr('width', x1 - x0).attr('height', nh)
        .attr('fill', nd.color).attr('rx', 2).attr('opacity', 0.92)
        .style('cursor', 'pointer')
        .on('click', () => {
          const pid = nd.posteId ?? nd.key.replace(/^[rdc]_/, '');
          const acts = mesuresActives.filter(m => m.poste === pid);
          setModal({
            title: nd.label,
            body: nd.infobulle ?? `Montant : ${(nd.val ?? 0).toFixed(0)} milliards d'euros.`,
            source: nd.source, montant: nd.val,
            deltas: acts.map(m => ({ label: m.label, val: (m.impact_min + m.impact_max) / 2, statut: m.statut, effets: m.effets_indirects, source: m.source_label })),
          });
        });

      // ── Labels ──────────────────────────────────────────────────────
      const valStr = `${(nd.val ?? 0).toFixed(0)} mds`;

      if (isCentre) {
        // Nœuds centraux : texte DANS le nœud si assez grand, sinon à droite
        if (nh >= 28) {
          // Texte centré dans le nœud, gras, blanc
          svg.append('text')
            .attr('x', (x0 + x1) / 2).attr('y', yMid - 7)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
            .attr('fill', C.white).attr('font-size', FS).attr('font-weight', 700).attr('font-family', FF)
            .text(nd.label);
          svg.append('text')
            .attr('x', (x0 + x1) / 2).attr('y', yMid + 7)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
            .attr('fill', C.white).attr('font-size', FSV).attr('font-family', FF)
            .text(valStr);
        } else {
          // Nœud trop petit : label à gauche, aligné comme les autres colonnes
          svg.append('text')
            .attr('x', x0 - 6).attr('y', yMid - 6)
            .attr('text-anchor', 'end').attr('dominant-baseline', 'central')
            .attr('fill', C.text).attr('font-size', FS).attr('font-weight', 600).attr('font-family', FF)
            .text(nd.label);
          svg.append('text')
            .attr('x', x0 - 6).attr('y', yMid + 6)
            .attr('text-anchor', 'end').attr('dominant-baseline', 'central')
            .attr('fill', C.muted).attr('font-size', FSV).attr('font-family', FF)
            .text(valStr);
        }
      } else {
        // Colonnes gauche et droite : 2 lignes — label + valeur
        const labelX = isLeft ? x0 - 8 : (nd.key === 'c_oat' ? x0 - 8 : x1 + 8);
        const anchor = (isLeft || nd.key === 'c_oat') ? 'end' : 'start';

        // Toujours 2 lignes : label en blanc bold, valeur en dessous en gris clair
        // Si le nœud est trop petit (< 12px), on centre verticalement sur yMid
        const lineGap = 13;
        const ly1 = nh >= 12 ? yMid - lineGap / 2 : yMid - 5;
        const ly2 = nh >= 12 ? yMid + lineGap / 2 + 1 : yMid + 7;

        svg.append('text')
          .attr('x', labelX).attr('y', ly1)
          .attr('text-anchor', anchor).attr('dominant-baseline', 'central')
          .attr('fill', '#F1F5F9')           // blanc cassé — bon contraste sur fond sombre
          .attr('font-size', FS).attr('font-weight', 600).attr('font-family', FF)
          .text(nd.label);
        svg.append('text')
          .attr('x', labelX).attr('y', ly2)
          .attr('text-anchor', anchor).attr('dominant-baseline', 'central')
          .attr('fill', '#94A3B8')           // gris clair — lisible sans concurrencer le label
          .attr('font-size', FSV).attr('font-weight', 400).attr('font-family', FF)
          .text(valStr);
      }

      // ── Delta mesure active ──────────────────────────────────────────
      const pid   = nd.posteId ?? nd.key.replace(/^[rdc]_/, '');
      const delta = deltas[pid];
      if (delta && !isCentre) {
        const dv   = (delta.min + delta.max) / 2;
        const dc   = dv >= 0 ? C.dp : C.dn;
        const dTxt = `${dv >= 0 ? '▲ +' : '▼ '}${dv.toFixed(0)}`;
        const refs  = mesuresActives.filter(m => m.poste === pid).map(m => m.label.split(' ')[0]).join(', ');
        const bx    = isLeft ? x1 + 2 : x0 - 2;
        const ba    = isLeft ? 'start' : 'end';
        svg.append('text')
          .attr('x', bx).attr('y', y0 + 9)
          .attr('text-anchor', ba).attr('fill', dc)
          .attr('font-size', isPortrait ? 8 : 10).attr('font-weight', 700).attr('font-family', FF)
          .text(dTxt);
        if (refs && nh > 18) {
          svg.append('text')
            .attr('x', bx).attr('y', y0 + 21)
            .attr('text-anchor', ba).attr('fill', dc).attr('opacity', 0.72)
            .attr('font-size', isPortrait ? 7 : 9).attr('font-family', FF)
            .text(refs.slice(0, 16));
        }
      }
    });

    // ── En-têtes colonnes ────────────────────────────────────────────────
    // Recettes : au-dessus du premier nœud col 0
    const aNodes = graph.nodes.filter((n: any) => (n as ND).col === 0);
    const dNodes = graph.nodes.filter((n: any) => (n as ND).col === 2);
    const bNodesGraph = graph.nodes.filter((n: any) => (n as ND).col === 1);

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


  }, [width, H, ML, MR, MT, MB, props]);

  return (
    <div ref={containerRef} style={{ width: '100%', position: 'relative', background: 'var(--bg-card)', borderRadius: '12px', padding: '4px 0' }}>
      <svg ref={svgRef} style={{ display: 'block', width: '100%' }} />

      {modal && (
        <div className="sk-overlay" onClick={() => setModal(null)}>
          <div className="sk-modal" onClick={e => e.stopPropagation()}>
            <div className="sk-header">
              <div>
                <h3 className="sk-title">{modal.title}</h3>
                {modal.montant !== undefined && <span className="sk-montant">{modal.montant.toFixed(0)} milliards €</span>}
              </div>
              <button className="sk-close" onClick={() => setModal(null)}>✕</button>
            </div>
            <p className="sk-body">{modal.body}</p>
            {modal.deltas && modal.deltas.length > 0 && (
              <div className="sk-deltas">
                <div className="sk-deltas-title">Impact de lois / propositions actives</div>
                {modal.deltas.map((d, i) => (
                  <div key={i} className={`sk-delta-item ${d.val >= 0 ? 'sk-pos' : 'sk-neg'}`}>
                    <div className="sk-delta-header">
                      <span className="sk-delta-label">{d.label}</span>
                      <span className="sk-delta-val">{fmt(d.val)}</span>
                      {d.statut && <span className="sk-badge" style={{ color: STATUT_COLOR[d.statut] ?? C.muted }}>{d.statut.replace(/_/g, ' ')}</span>}
                    </div>
                    {d.effets && d.effets.length > 0 && (
                      <ul className="sk-effets">{d.effets.map((e, j) => <li key={j}>{e}</li>)}</ul>
                    )}
                    {d.source && <p className="sk-delta-source">Source : {d.source}</p>}
                  </div>
                ))}
              </div>
            )}
            {modal.source && <p className="sk-source">Source : {modal.source}</p>}
          </div>
        </div>
      )}

      <style>{`
        .sk-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.72); z-index: 300; display: flex; align-items: center; justify-content: center; padding: 1rem; }
        .sk-modal { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 1.25rem 1.5rem; max-width: 460px; width: 100%; display: flex; flex-direction: column; gap: 0.875rem; max-height: 85vh; overflow-y: auto; }
        .sk-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
        .sk-title  { font-size: 0.95rem; font-weight: 600; color: #e2e8f0; margin: 0 0 0.2rem; }
        .sk-montant { font-size: 0.78rem; color: #64748b; }
        .sk-close  { background: none; border: none; color: #64748b; cursor: pointer; font-size: 1rem; padding: 0; flex-shrink: 0; }
        .sk-close:hover { color: #e2e8f0; }
        .sk-body   { font-size: 0.8rem; color: #94a3b8; line-height: 1.6; margin: 0; }
        .sk-deltas { display: flex; flex-direction: column; gap: 0.5rem; }
        .sk-deltas-title { font-size: 0.68rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; padding-bottom: 0.3rem; border-bottom: 1px solid #1e293b; }
        .sk-delta-item { padding: 0.6rem 0.75rem; border-radius: 6px; display: flex; flex-direction: column; gap: 0.3rem; }
        .sk-pos { background: rgba(5,150,105,0.1); border: 1px solid rgba(5,150,105,0.25); }
        .sk-neg { background: rgba(234,88,12,0.1);  border: 1px solid rgba(234,88,12,0.25); }
        .sk-delta-header { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
        .sk-delta-label  { font-size: 0.8rem; font-weight: 500; color: #cbd5e1; flex: 1; }
        .sk-delta-val    { font-size: 0.9rem; font-weight: 700; white-space: nowrap; }
        .sk-pos .sk-delta-val { color: #10b981; }
        .sk-neg .sk-delta-val { color: #f97316; }
        .sk-badge { font-size: 0.65rem; padding: 1px 5px; border-radius: 9999px; background: rgba(255,255,255,0.05); }
        .sk-effets { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.15rem; }
        .sk-effets li { font-size: 0.73rem; color: #94a3b8; padding-left: 0.9rem; position: relative; line-height: 1.4; }
        .sk-effets li::before { content: '→'; position: absolute; left: 0; color: #475569; }
        .sk-delta-source { font-size: 0.65rem; color: #475569; font-style: italic; margin: 0; }
        .sk-source { font-size: 0.68rem; color: #334155; font-style: italic; margin: 0; padding-top: 0.5rem; border-top: 1px solid #1e293b; }
      `}</style>
    </div>
  );
}
