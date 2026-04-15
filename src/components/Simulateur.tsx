import { useState, useMemo, useRef, useEffect } from 'react';
import SankeyChart from './Sankey';

// ── Types ──────────────────────────────────────────────────────────────────
interface Poste {
  id: string; label: string; valeur: number; min: number; max: number;
  fixe?: boolean; source: string; infobulle: string;
  taux_compensation_secu?: number; taux_allegement?: number;
  taux_tva_etat?: number;
  taux_tva_secu?: number;
  taux_tva_collectivites?: number;
  taux_tva_audiovisuel?: number;
}
interface Mesure {
  id: string; label: string; source_label: string; source_url: string;
  type: 'recette' | 'depense'; budget: 'plf' | 'plfss'; poste: string;
  impact_min: number; impact_max: number; statut: string; confiance: string;
  infobulle: string; effets_indirects: string[];
  analogies_historiques: { pays: string; annee: number; mesure: string; impact_observe: string; score: number }[];
  questions: string[];
}
interface ProgrammeMeta {
  id: string;
  label: string;
  label_court: string;
  couleur: string;
  couleur_secondaire?: string;
  annee_programme: number;
  source_url: string;
  source_label: string;
  note_editoriale?: string;
  macro_hypotheses?: { note: string; source: string };
}
interface Programme {
  meta: ProgrammeMeta;
  mesures_catalogue_ids: string[];
  mesures_specifiques: Mesure[];
}
interface ProgrammeEntry {
  id: string;
  label: string;
  label_court: string;
  couleur: string;
  file: string;
}
interface BudgetMeta {
  annee: number; pib: number;
  dette_initiale_pct: number; dette_montant_mds?: number;
  id: string; label: string; label_long?: string;
  type: 'previsionnel' | 'execute';
  date_vote?: string; contexte?: string; contexte_court?: string;
  alerte?: string; alerte_type?: 'warning' | 'info' | 'success';
}
interface BudgetData {
  meta: BudgetMeta;
  recettes_plf: Poste[]; recettes_plfss: Poste[];
  consolidation: {
    compensation_tva_secu?: number;
    emprunt_etat: number;
    infobulle_compensation: string;
    infobulle_emprunt: string;
    tva_vers_etat?: number;
    tva_vers_secu?: number;
    tva_vers_collectivites?: number;
    tva_vers_audiovisuel?: number;
  };
  depenses_plf: Poste[]; depenses_plfss: Poste[];
  // Champs legacy — présents dans budget_2025.json, ignorés dans la nouvelle logique
  mesures?: Mesure[];
  multiplicateurs?: Record<string, { bas: number; haut: number }>;
}
interface Props {
  data: BudgetData;
  catalogue: Mesure[];
  multiplicateurs: Record<string, { bas: number; haut: number }>;
  programmeList?: ProgrammeEntry[];
  programmes?: Record<string, Programme>;
  budgetList?: { id: string; label: string; file: string }[];
  onBudgetChange?: (id: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const STATUT: Record<string, { label: string; cls: string }> = {
  observe:                { label: 'Observé',      cls: 'badge-observe'   },
  hypothese_partielle:    { label: 'Hypothèse',    cls: 'badge-hypothese' },
  hypothese_non_verifiee: { label: 'Non vérifiée', cls: 'badge-hypothese' },
  incertain:              { label: 'Incertain',    cls: 'badge-incertain' },
};
const fmt    = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(0)} mds`;
const fmtPct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}`;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// ── Feature flag — mode à la carte (future fonctionnalité) ─────────────────
// Passer à true pour ré-activer les checkboxes individuelles
const MODE_A_LA_CARTE = false;

// ── Tooltip ────────────────────────────────────────────────────────────────
function Tooltip({ content, source, onClose }: { content: string; source?: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div ref={ref} className="tooltip-box">
      <p className="tooltip-text">{content}</p>
      {source && <p className="tooltip-source">Source : {source}</p>}
    </div>
  );
}

// ── PosteRow ───────────────────────────────────────────────────────────────
function PosteRow({ poste, valeur, delta, trackColor }: {
  poste: Poste; valeur: number;
  delta: { min: number; max: number } | undefined;
  trackColor: 'blue' | 'teal' | 'red';
}) {
  const [open, setOpen] = useState(false);
  const pct = ((valeur - poste.min) / Math.max(poste.max - poste.min, 1)) * 100;
  const dv = delta ? (delta.min + delta.max) / 2 : 0;
  return (
    <div className="poste">
      <div className="poste-header">
        <button className={`poste-label-btn${open ? ' active' : ''}`} onClick={() => setOpen(v => !v)}>
          <span className="poste-label-text">{poste.label}</span>
          <span className="poste-info-icon">ⓘ</span>
        </button>
        <span className="poste-val">
          {valeur.toFixed(0)} mds
          {delta && <span className={`poste-delta ${dv >= 0 ? 'delta-pos' : 'delta-neg'}`}>{fmt(dv)}</span>}
          {poste.fixe && <span className="poste-fixe-badge">fixe</span>}
        </span>
      </div>
      <div className="track"><div className={`track-fill track-${trackColor}`} style={{ width: `${pct}%` }} /></div>
      {open && <Tooltip content={poste.infobulle} source={poste.source} onClose={() => setOpen(false)} />}
    </div>
  );
}

// ── FicheMesure ────────────────────────────────────────────────────────────
function FicheMesure({ mesure, programmeMeta, onClose }: {
  mesure: Mesure;
  programmeMeta?: ProgrammeMeta;
  onClose: () => void;
}) {
  const st = STATUT[mesure.statut] ?? { label: mesure.statut, cls: 'badge-hypothese' };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">{mesure.label}</h3>
            <p className="modal-source">
              {mesure.source_url
                ? <a href={mesure.source_url} target="_blank" rel="noopener">{mesure.source_label}</a>
                : mesure.source_label}
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
            {programmeMeta && (
              <span className="badge-programme" style={{ background: programmeMeta.couleur + '22', color: programmeMeta.couleur, border: `1px solid ${programmeMeta.couleur}55` }}>
                {programmeMeta.label_court}
              </span>
            )}
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="modal-infobulle">{mesure.infobulle}</div>
        <div className="modal-impact">
          <span className="modal-impact-label">Impact direct estimé</span>
          <span className="modal-impact-val">{fmt(mesure.impact_min)} à {fmt(mesure.impact_max)} mds €</span>
          <span className={`badge ${st.cls}`}>{st.label}</span>
        </div>
        {mesure.effets_indirects.length > 0 && (
          <div className="modal-section">
            <h4 className="modal-section-title">Effets indirects</h4>
            <ul className="modal-list">{mesure.effets_indirects.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}
        {mesure.analogies_historiques.length > 0 && (
          <div className="modal-section">
            <h4 className="modal-section-title">Analogies historiques</h4>
            {mesure.analogies_historiques.map((a, i) => (
              <div key={i} className="analogie">
                <span className="analogie-pays">{a.pays} {a.annee}</span>
                <span className="analogie-mesure">{a.mesure}</span>
                <span className="analogie-impact">→ {a.impact_observe}</span>
                <span className="analogie-score">Similarité : {Math.round(a.score * 100)} %</span>
              </div>
            ))}
          </div>
        )}
        {mesure.questions.length > 0 && (
          <div className="modal-section">
            <h4 className="modal-section-title">Questions soulevées</h4>
            <ul className="modal-list modal-questions">{mesure.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
          </div>
        )}
        <div className="modal-footer">
          <span>Confiance : <strong>{mesure.confiance}</strong></span>
          <span>Budget : <strong>{mesure.budget.toUpperCase()}</strong></span>
        </div>
      </div>
    </div>
  );
}

// ── MesureRow ──────────────────────────────────────────────────────────────
// MODE_A_LA_CARTE=false → lecture seule avec badge programme coloré
// MODE_A_LA_CARTE=true  → checkbox individuelle (future fonctionnalité)
function MesureRow({ mesure, checked, onToggle, onOpenFiche, programmeMeta }: {
  mesure: Mesure; checked: boolean; onToggle: () => void; onOpenFiche: () => void;
  programmeMeta?: ProgrammeMeta;
}) {
  const st = STATUT[mesure.statut] ?? { label: mesure.statut, cls: 'badge-hypothese' };
  return (
    <div className={`mesure-row${checked ? ' checked' : ''}`}>
      {MODE_A_LA_CARTE ? (
        <label className="mesure-check-wrap">
          <input type="checkbox" checked={checked} onChange={onToggle} className="mesure-check" />
          <span className="mesure-label">{mesure.label}</span>
        </label>
      ) : (
        <div className="mesure-label-wrap">
          {programmeMeta && (
            <span
              className="mesure-badge-programme"
              style={{ background: programmeMeta.couleur + '22', color: programmeMeta.couleur, borderColor: programmeMeta.couleur + '55' }}
            >
              {programmeMeta.label_court}
            </span>
          )}
          <span className="mesure-label">{mesure.label}</span>
        </div>
      )}
      <div className="mesure-right">
        <span className="mesure-impact">{fmt(mesure.impact_min)} à {fmt(mesure.impact_max)}</span>
        <span className={`badge ${st.cls}`}>{st.label}</span>
        <button className="btn-info" onClick={onOpenFiche}>ⓘ</button>
      </div>
    </div>
  );
}

// ── ProgrammeSelector ──────────────────────────────────────────────────────
function ProgrammeSelector({ programmeList, activeId, onChange }: {
  programmeList: ProgrammeEntry[];
  activeId: string | null;
  onChange: (id: string | null) => void;
}) {
  return (
    <div className="programme-selector">
      <span className="programme-selector-label">Programme politique</span>
      <div className="programme-btns">
        <button
          className={`programme-btn${activeId === null ? ' active active-none' : ''}`}
          onClick={() => onChange(null)}
        >
          Aucun
        </button>
        {programmeList.map(p => (
          <button
            key={p.id}
            className={`programme-btn${activeId === p.id ? ' active' : ''}`}
            style={activeId === p.id ? { background: p.couleur, borderColor: p.couleur, color: '#fff' } : { borderColor: p.couleur + '66', color: p.couleur }}
            onClick={() => onChange(activeId === p.id ? null : p.id)}
          >
            {p.label_court}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Simulateur ─────────────────────────────────────────────────────────────
export default function Simulateur({ data, catalogue, multiplicateurs, programmeList = [], programmes = {}, budgetList = [], onBudgetChange }: Props) {
  const [programmeActif, setProgrammeActif] = useState<string | null>(null);
  const [ficheOuverte, setFiche]            = useState<Mesure | null>(null);
  const [ficheProgramme, setFicheProgramme] = useState<ProgrammeMeta | undefined>(undefined);
  const [panelInfo, setPanelInfo]           = useState<{title: string; content: string; source?: string} | null>(null);

  // ── Mesures actives : issues du programme sélectionné ─────────────────
  // En mode à la carte (futur), ce Set sera rempli manuellement par l'user
  const cochees = useMemo<Set<string>>(() => {
    if (!programmeActif) return new Set();
    const prog = programmes[programmeActif];
    if (!prog) return new Set();
    const ids = [
      ...prog.mesures_catalogue_ids,
      ...prog.mesures_specifiques.map(m => m.id),
    ];
    return new Set(ids);
  }, [programmeActif, programmes]);

  // ── Catalogue consolidé : mesures générales + spécifiques du programme ─
  const catalogueActif = useMemo<Mesure[]>(() => {
    if (!programmeActif) return catalogue;
    const prog = programmes[programmeActif];
    if (!prog) return catalogue;
    const specifiquesIds = new Set(prog.mesures_specifiques.map(m => m.id));
    const base = catalogue.filter(m => !specifiquesIds.has(m.id));
    return [...base, ...prog.mesures_specifiques];
  }, [programmeActif, programmes, catalogue]);

  const getMesure = (id: string) => catalogueActif.find(m => m.id === id);

  const deltas = useMemo(() => {
    const acc: Record<string, { min: number; max: number }> = {};
    for (const id of cochees) {
      const m = getMesure(id);
      if (!m) continue;
      if (!acc[m.poste]) acc[m.poste] = { min: 0, max: 0 };
      acc[m.poste].min += m.impact_min;
      acc[m.poste].max += m.impact_max;
    }
    return acc;
  }, [cochees, catalogueActif]);

  const veff = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of [...data.recettes_plf, ...data.recettes_plfss, ...data.depenses_plf, ...data.depenses_plfss]) {
      const d = deltas[p.id];
      map[p.id] = d ? clamp(p.valeur + (d.min + d.max) / 2, p.min, p.max) : p.valeur;
    }
    return map;
  }, [deltas]);

  const ve = (p: Poste) => veff[p.id] ?? p.valeur;

  const totalPlf   = useMemo(() => data.recettes_plf.reduce((s, p) => s + ve(p), 0),   [veff]);
  const totalPlfss = useMemo(() => data.recettes_plfss.reduce((s, p) => s + ve(p), 0), [veff]);

  const tvaPoste = data.recettes_plf.find(p => p.id === 'tva');
  const taux_tva_etat          = tvaPoste?.taux_tva_etat          ?? 0.4815;
  const taux_tva_secu          = tvaPoste?.taux_tva_secu          ?? 0.171;
  const taux_tva_collectivites = tvaPoste?.taux_tva_collectivites ?? 0.347;
  const taux_tva_audiovisuel   = tvaPoste?.taux_tva_audiovisuel   ?? 0.0;

  const compensationSecu = useMemo(() => {
    const tva = veff['tva'] ?? 216;
    return Math.round(tva * taux_tva_secu);
  }, [veff, taux_tva_secu]);

  const plfNet = useMemo(() => {
    const tvaVal      = veff['tva'] ?? 216;
    const tvaVersEtat = Math.round(tvaVal * taux_tva_etat);
    const recHorsTvaOat = data.recettes_plf
      .filter(p => p.id !== 'tva' && p.id !== 'oat')
      .reduce((s, p) => s + ve(p), 0);
    return recHorsTvaOat + tvaVersEtat;
  }, [veff, taux_tva_etat]);

  const plfssNet = useMemo(() => totalPlfss + compensationSecu, [totalPlfss, compensationSecu]);
  const emprunt  = data.consolidation.emprunt_etat;

  const totalDepPlf   = useMemo(() => data.depenses_plf.reduce((s, p) => s + ve(p), 0),   [veff]);
  const totalDepPlfss = useMemo(() => data.depenses_plfss.reduce((s, p) => s + ve(p), 0), [veff]);

  // ── Impact croissance — trois horizons ───────────────────────────────────
  // CT (1-2 ans) : multiplicateurs keynésiens
  //   recette → prélèvement → impact négatif sur demande
  //   dépense → injection  → impact positif sur demande
  // MT (3-7 ans) : effets comportementaux atténués (×0.4), convergence vers 0
  // LT (8-20 ans) : lu depuis impact_croissance_lt du catalogue si renseigné
  const impactCroissance = useMemo(() => {
    let ctBas = 0, ctHaut = 0;
    let mtBas = 0, mtHaut = 0;
    let ltBas: number | null = 0, ltHaut: number | null = 0;
    let ltManquant = false;

    for (const id of cochees) {
      const m = getMesure(id) as any;
      if (!m) continue;
      const mult = multiplicateurs[m.poste];
      if (!mult) continue;
      const d   = (m.impact_min + m.impact_max) / 2;
      const pib = data.meta.pib;
      // Recette = prélèvement (signe −), Dépense = injection (signe +)
      const signe = m.type === 'recette' ? -1 : 1;

      ctBas  += signe * d * mult.bas  / pib * 100;
      ctHaut += signe * d * mult.haut / pib * 100;
      mtBas  += signe * d * mult.bas  / pib * 100 * 0.4;
      mtHaut += signe * d * mult.haut / pib * 100 * 0.4;

      if (m.impact_croissance_lt?.min != null && m.impact_croissance_lt?.max != null) {
        ltBas  = (ltBas  ?? 0) + (m.impact_croissance_lt.min as number);
        ltHaut = (ltHaut ?? 0) + (m.impact_croissance_lt.max as number);
      } else {
        ltManquant = true;
      }
    }

    if (ltManquant) { ltBas = null; ltHaut = null; }

    return {
      ct: { bas: Math.min(ctBas,  ctHaut),  haut: Math.max(ctBas,  ctHaut)  },
      mt: { bas: Math.min(mtBas,  mtHaut),  haut: Math.max(mtBas,  mtHaut)  },
      lt: ltBas !== null && ltHaut !== null
            ? { bas: Math.min(ltBas, ltHaut), haut: Math.max(ltBas, ltHaut) }
            : null,
    };
  }, [cochees, catalogueActif, multiplicateurs]);

  const indics = (data.meta as any).indicateurs ?? {};

  const deficitBGE = useMemo(() => {
    const recHorsTvaOat = data.recettes_plf
      .filter(p => p.id !== 'tva' && p.id !== 'oat')
      .reduce((s, p) => s + ve(p), 0);
    const tvaVal      = veff['tva'] ?? 216;
    const tvaVersEtat = Math.round(tvaVal * taux_tva_etat);
    return recHorsTvaOat + tvaVersEtat - totalDepPlf;
  }, [veff, totalDepPlf, taux_tva_etat]);

  const deficitSecu = useMemo(() => plfssNet - totalDepPlfss, [plfssNet, totalDepPlfss]);

  const detteAjoutee = useMemo(() => {
    const refBGE   = (indics.deficit_bge  as any)?.valeur_reference_mds as number ?? -125;
    const refSecu  = (indics.deficit_secu as any)?.valeur_reference_mds as number ?? -23;
    const refTotal = refBGE + refSecu;
    let deltaRecPLF = 0, deltaDepPLF = 0, deltaRecPLFSS = 0, deltaDepPLFSS = 0;
    for (const id of cochees) {
      const m = getMesure(id);
      if (!m) continue;
      const mid = (m.impact_min + m.impact_max) / 2;
      if (m.type === 'recette' && m.budget === 'plf')   deltaRecPLF   += mid;
      if (m.type === 'depense' && m.budget === 'plf')   deltaDepPLF   += mid;
      if (m.type === 'recette' && m.budget === 'plfss') deltaRecPLFSS += mid;
      if (m.type === 'depense' && m.budget === 'plfss') deltaDepPLFSS += mid;
    }
    return refTotal + (deltaRecPLF - deltaDepPLF) + (deltaRecPLFSS - deltaDepPLFSS);
  }, [cochees, catalogueActif, indics]);
  const detteAjouteePct = (detteAjoutee / data.meta.pib) * 100;

  const detteTotaleMds      = ((data.meta as any).dette_montant_mds as number)
    ?? Math.round(data.meta.dette_initiale_pct / 100 * data.meta.pib);
  const detteTotaleAvecAjout = detteTotaleMds + Math.abs(detteAjoutee);
  const detteTotalePct       = detteTotaleAvecAjout / data.meta.pib * 100;
  const detteEnAnnesPIB      = detteTotaleMds / data.meta.pib;

  const sankeyRecettesPLF   = data.recettes_plf.map(p => ({ ...p, valeurEffective: ve(p) }));
  const sankeyRecettesPLFSS = data.recettes_plfss.map(p => ({ ...p, valeurEffective: ve(p) }));
  const sankeyDepensesPLF   = data.depenses_plf.map(p => ({ ...p, valeurEffective: ve(p) }));
  const sankeyDepensesPLFSS = data.depenses_plfss.map(p => ({ ...p, valeurEffective: ve(p) }));
  const mesuresActives = [...cochees].flatMap(id => {
    const m = getMesure(id);
    if (!m) return [];
    return [{ id: m.id, label: m.label, poste: m.poste, impact_min: m.impact_min, impact_max: m.impact_max, statut: m.statut, source_label: m.source_label, effets_indirects: m.effets_indirects }];
  });

  const progMeta = programmeActif ? programmes[programmeActif]?.meta : undefined;

  // Mesures à afficher (uniquement celles du programme actif, ou aucune)
  const mesuresAffichees = useMemo<Mesure[]>(() => {
    if (!programmeActif) return [];
    return [...cochees].flatMap(id => {
      const m = getMesure(id);
      return m ? [m] : [];
    });
  }, [cochees, catalogueActif, programmeActif]);

  return (
    <>
      {/* ── Sélecteur de budget ── */}
      {budgetList.length > 1 && (
        <div className="budget-selector">
          {budgetList.map(b => (
            <button
              key={b.id}
              className={`budget-btn${data.meta.id === b.id ? ' active' : ''}`}
              onClick={() => onBudgetChange?.(b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Bandeau contextuel ── */}
      {data.meta.alerte && (
        <div className={`budget-banner budget-banner--${data.meta.alerte_type ?? 'info'}`}>
          <div className="budget-banner-text">
            <span className="budget-banner-label">{data.meta.label_long ?? data.meta.label}</span>
            <span className="budget-banner-msg">{data.meta.alerte}</span>
          </div>
          {data.meta.contexte_court && (
            <span className="budget-banner-sub">{data.meta.contexte_court}</span>
          )}
        </div>
      )}

      <div className="sankey-full">
        <SankeyChart
          recettes_plf={sankeyRecettesPLF}
          recettes_plfss={sankeyRecettesPLFSS}
          depenses_plf={sankeyDepensesPLF}
          depenses_plfss={sankeyDepensesPLFSS}
          compensationSecu={compensationSecu}
          emprunt={data.consolidation.emprunt_etat}
          taux_tva_etat={taux_tva_etat}
          taux_tva_secu={taux_tva_secu}
          taux_tva_collectivites={taux_tva_collectivites}
          taux_tva_audiovisuel={taux_tva_audiovisuel}
          compensation_infobulle={data.consolidation.infobulle_compensation}
          emprunt_infobulle={data.consolidation.infobulle_emprunt}
          deltas={deltas}
          mesuresActives={mesuresActives}
        />
      </div>

      {/* ── Indicateurs ── */}
      <div className="indicators">
        <div className="indicator indicator--double"
             onClick={() => indics.deficit_bge && setPanelInfo({ title: indics.deficit_bge.label ?? 'Déficit BGÉ', content: (indics.deficit_bge.infobulle ?? '') + '\n\n' + (indics.deficit_bge.note_methodologique ?? ''), source: indics.deficit_bge.source })}
             style={{ cursor: indics.deficit_bge ? 'pointer' : 'default' }}>
          <div className="ind-label">Déficits annuels{indics.deficit_bge && <span className="ind-info-icon">ⓘ</span>}</div>
          <div className="ind-double-row">
            <span className="ind-double-label">BGÉ</span>
            <span className={`ind-double-val ${deficitBGE >= 0 ? 'val-pos' : 'val-neg'}`}>{fmt(deficitBGE)} €</span>
          </div>
          <div className="ind-double-row"
               onClick={e => { e.stopPropagation(); indics.deficit_secu && setPanelInfo({ title: indics.deficit_secu.label ?? 'Déficit Sécu', content: indics.deficit_secu.infobulle ?? '', source: indics.deficit_secu.source }); }}>
            <span className="ind-double-label">Sécu</span>
            <span className={`ind-double-val ${deficitSecu >= 0 ? 'val-pos' : 'val-neg'}`}>{fmt(deficitSecu)} €</span>
          </div>
        </div>

        <div className="indicator"
             onClick={() => indics.dette_annuelle && setPanelInfo({ title: indics.dette_annuelle.label ?? 'Dette ajoutée', content: indics.dette_annuelle.infobulle ?? '', source: indics.dette_annuelle.source })}
             style={{ cursor: indics.dette_annuelle ? 'pointer' : 'default' }}>
          <div className="ind-label">Dette ajoutée {data.meta.annee ?? ''}{indics.dette_annuelle && <span className="ind-info-icon">ⓘ</span>}</div>
          <div className={`ind-value ${detteAjoutee < 0 ? 'val-neg' : 'val-pos'}`}>{fmt(detteAjoutee)} €</div>
          <div className="ind-sub">{Math.abs(detteAjouteePct).toFixed(1)} % du PIB</div>
        </div>

        <div className="indicator"
             onClick={() => indics.dette_totale && setPanelInfo({ title: indics.dette_totale.label ?? 'Dette totale', content: indics.dette_totale.infobulle ?? '', source: indics.dette_totale.source })}
             style={{ cursor: indics.dette_totale ? 'pointer' : 'default' }}>
          <div className="ind-label">Dette totale{indics.dette_totale && <span className="ind-info-icon">ⓘ</span>}</div>
          <div className={`ind-value ${detteTotalePct > 100 ? 'val-neg' : 'val-neutral'}`}>{detteTotaleMds.toLocaleString('fr-FR')} Mrd€</div>
          <div className="ind-sub">{detteEnAnnesPIB.toFixed(2)} ann. PIB · {detteTotalePct.toFixed(1)} %</div>
        </div>

        <div className="indicator indicator--croissance"
             onClick={() => indics.croissance && setPanelInfo({ title: indics.croissance.label ?? 'Impact macro estimé', content: indics.croissance.infobulle ?? 'Estimation basée sur les multiplicateurs keynésiens OFCE/IPP. CT = effet demande immédiat. MT = convergence comportementale. LT = effets structurels (santé, capital humain) — non chiffrés si données manquantes.', source: indics.croissance?.source ?? 'Multiplicateurs OFCE / IPP' })}
             style={{ cursor: 'pointer' }}>
          <div className="ind-label">Impact macro estimé <span className="ind-info-icon">ⓘ</span></div>
          <div className="croissance-horizons">
            <div className="croissance-row">
              <span className="croissance-horizon-label">CT <span className="croissance-horizon-sub">1–2 ans</span></span>
              <span className={`croissance-val ${impactCroissance.ct.haut >= 0 && impactCroissance.ct.bas >= 0 ? 'val-pos' : impactCroissance.ct.haut <= 0 && impactCroissance.ct.bas <= 0 ? 'val-neg' : 'val-neutral'}`}>
                {fmtPct(impactCroissance.ct.bas)} à {fmtPct(impactCroissance.ct.haut)} %
              </span>
            </div>
            <div className="croissance-row">
              <span className="croissance-horizon-label">MT <span className="croissance-horizon-sub">3–7 ans</span></span>
              <span className={`croissance-val ${impactCroissance.mt.haut >= 0 && impactCroissance.mt.bas >= 0 ? 'val-pos' : impactCroissance.mt.haut <= 0 && impactCroissance.mt.bas <= 0 ? 'val-neg' : 'val-neutral'}`}>
                {fmtPct(impactCroissance.mt.bas)} à {fmtPct(impactCroissance.mt.haut)} %
              </span>
            </div>
            <div className="croissance-row">
              <span className="croissance-horizon-label">LT <span className="croissance-horizon-sub">8–20 ans</span></span>
              {impactCroissance.lt
                ? <span className={`croissance-val ${impactCroissance.lt.haut >= 0 && impactCroissance.lt.bas >= 0 ? 'val-pos' : impactCroissance.lt.haut <= 0 && impactCroissance.lt.bas <= 0 ? 'val-neg' : 'val-neutral'}`}>
                    {fmtPct(impactCroissance.lt.bas)} à {fmtPct(impactCroissance.lt.haut)} %
                  </span>
                : <span className="croissance-nc">non chiffré</span>
              }
            </div>
          </div>
        </div>

        <div className="indicator">
          <div className="ind-label">Mesures actives</div>
          <div className="ind-value val-neutral">{cochees.size}</div>
          <div className="ind-sub">
            {cochees.size === 0
              ? `Budget ${data.meta.label ?? ''} de base`
              : progMeta ? `Programme ${progMeta.label_court}` : 'Scénario modifié'}
          </div>
        </div>
      </div>

      {/* ── Sélecteur de programme ── */}
      {programmeList.length > 0 && (
        <ProgrammeSelector
          programmeList={programmeList}
          activeId={programmeActif}
          onChange={id => { setProgrammeActif(id); }}
        />
      )}

      {/* ── Bandeau programme actif ── */}
      {progMeta && (
        <div className="programme-banner" style={{ borderColor: progMeta.couleur + '55', background: progMeta.couleur + '11' }}>
          <div className="programme-banner-left">
            <span className="programme-banner-label" style={{ color: progMeta.couleur }}>{progMeta.label}</span>
            <span className="programme-banner-sub">{progMeta.source_label}</span>
          </div>
          <a href={progMeta.source_url} target="_blank" rel="noopener" className="programme-banner-link" style={{ color: progMeta.couleur }}>
            Programme source ↗
          </a>
        </div>
      )}

      {/* ── Panneau méthodologique ── */}
      {panelInfo && (
        <div className="panel-overlay" onClick={() => setPanelInfo(null)}>
          <div className="panel-drawer" onClick={e => e.stopPropagation()}>
            <div className="panel-header">
              <h3 className="panel-title">{panelInfo.title}</h3>
              <button className="panel-close" onClick={() => setPanelInfo(null)}>✕</button>
            </div>
            <div className="panel-body">
              {panelInfo.content.split('\n\n').map((para, i) => (
                <p key={i} className="panel-para">{para}</p>
              ))}
            </div>
            {panelInfo.source && <div className="panel-footer">Source : {panelInfo.source}</div>}
          </div>
        </div>
      )}

      {/* ── Mesures du programme ── */}
      {mesuresAffichees.length > 0 && (
        <div className="mesures-zone">
          <div className="mesures-col">
            <h3 className="mesures-title">
              <span className="mesures-dot" style={{ background: progMeta?.couleur ?? 'var(--accent-blue)' }} />
              {progMeta?.label_court ?? 'Programme'} — Recettes
            </h3>
            {mesuresAffichees.filter(m => m.type === 'recette').map(m => (
              <MesureRow key={m.id} mesure={m} checked programmeMeta={progMeta} onToggle={() => {}} onOpenFiche={() => { setFiche(m); setFicheProgramme(progMeta); }} />
            ))}
            {mesuresAffichees.filter(m => m.type === 'recette').length === 0 && (
              <p className="mesures-empty">Aucune mesure recette dans ce programme.</p>
            )}
          </div>
          <div className="mesures-col">
            <h3 className="mesures-title">
              <span className="mesures-dot" style={{ background: progMeta?.couleur ?? 'var(--accent-red)' }} />
              {progMeta?.label_court ?? 'Programme'} — Dépenses
            </h3>
            {mesuresAffichees.filter(m => m.type === 'depense').map(m => (
              <MesureRow key={m.id} mesure={m} checked programmeMeta={progMeta} onToggle={() => {}} onOpenFiche={() => { setFiche(m); setFicheProgramme(progMeta); }} />
            ))}
            {mesuresAffichees.filter(m => m.type === 'depense').length === 0 && (
              <p className="mesures-empty">Aucune mesure dépense dans ce programme.</p>
            )}
          </div>
        </div>
      )}

      {mesuresAffichees.length === 0 && programmeList.length > 0 && (
        <div className="mesures-placeholder">
          <p>Sélectionnez un programme politique pour visualiser son impact sur le budget.</p>
        </div>
      )}

      {ficheOuverte && <FicheMesure mesure={ficheOuverte} programmeMeta={ficheProgramme} onClose={() => { setFiche(null); setFicheProgramme(undefined); }} />}

      <style>{`
        .sankey-full { width: 100%; margin: 1rem 0; }

        .col { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 0.75rem; display: flex; flex-direction: column; gap: 0.65rem; }
        .col-header { display: flex; align-items: center; gap: 0.4rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border-subtle); }
        .col-title { font-size: 0.8rem; font-weight: 600; }
        .col-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
        .dot-blue   { background: var(--accent-blue); }
        .dot-amber  { background: var(--accent-orange); }
        .dot-purple { background: var(--accent-purple); }
        .dot-red    { background: var(--accent-red); }

        .col-bloc { display: flex; flex-direction: column; gap: 0.45rem; }
        .bloc-title { font-size: 0.65rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 5px; border-radius: 4px; margin-bottom: 1px; display: flex; align-items: center; gap: 3px; }
        .bloc-plf    { background: rgba(56,139,253,0.12); color: #58a6ff; border: 1px solid rgba(56,139,253,0.25); }
        .bloc-plfss  { background: rgba(29,158,117,0.12); color: #3fb950; border: 1px solid rgba(29,158,117,0.25); }
        .bloc-emprunt{ background: rgba(210,153,34,0.12); color: #d29922; border: 1px solid rgba(210,153,34,0.25); }

        .poste { position: relative; }
        .poste-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px; gap: 4px; }
        .poste-label-btn { display: flex; align-items: center; gap: 3px; background: none; border: none; cursor: pointer; padding: 0; text-align: left; flex: 1; }
        .poste-label-text { font-size: 0.73rem; color: var(--text-secondary); }
        .poste-label-btn:hover .poste-label-text,
        .poste-label-btn.active .poste-label-text { color: var(--accent-blue); }
        .poste-info-icon { font-size: 0.65rem; color: var(--text-muted); }
        .poste-label-btn:hover .poste-info-icon { color: var(--accent-blue); }
        .poste-val { font-size: 0.73rem; font-weight: 500; white-space: nowrap; display: flex; align-items: center; gap: 3px; }
        .poste-delta { font-size: 0.65rem; font-weight: 600; }
        .delta-pos { color: var(--accent-green); }
        .delta-neg { color: var(--accent-red); }
        .poste-fixe-badge { font-size: 0.58rem; padding: 1px 4px; border-radius: 9999px; background: var(--bg-hover); color: var(--text-muted); border: 1px solid var(--border); }

        .track { height: 3px; background: var(--border); border-radius: 2px; overflow: hidden; }
        .track-fill { height: 100%; border-radius: 2px; transition: width 0.4s ease; }
        .track-blue { background: var(--accent-blue); }
        .track-teal { background: #1D9E75; }
        .track-red  { background: var(--accent-red); }

        .tooltip-box { position: absolute; z-index: 50; top: 100%; left: 0; right: 0; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 0.6rem 0.75rem; margin-top: 4px; box-shadow: 0 4px 16px rgba(0,0,0,0.45); }
        .tooltip-text { font-size: 0.73rem; color: var(--text-secondary); line-height: 1.55; margin-bottom: 0.25rem; }
        .tooltip-source { font-size: 0.65rem; color: var(--text-muted); font-style: italic; }

        .indicators { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr 1fr; gap: 0.65rem; margin: 0.75rem 0; }
        @media (max-width: 900px) { .indicators { grid-template-columns: repeat(3,1fr); } }
        @media (max-width: 600px) { .indicators { grid-template-columns: repeat(2,1fr); } }
        .indicator { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 0.875rem; text-align: center; }
        .indicator--double { grid-row: span 1; display: flex; flex-direction: column; gap: 0.2rem; }
        .ind-label { font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.3rem; }
        .ind-value { font-size: 1.3rem; font-weight: 600; }
        .val-pos { color: var(--accent-green); } .val-neg { color: var(--accent-red); } .val-neutral { color: var(--text-primary); }
        .ind-sub { font-size: 0.63rem; color: var(--text-muted); margin-top: 0.2rem; }
        .ind-double-row { display: flex; justify-content: space-between; align-items: center; padding: 0.15rem 0; border-top: 1px solid var(--border-subtle); }
        .ind-double-label { font-size: 0.65rem; color: var(--text-muted); font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; }
        .ind-double-val { font-size: 0.85rem; font-weight: 700; }
        .ind-info-icon { font-size: 0.6rem; color: var(--text-muted); margin-left: 3px; }
        .indicator[style*="pointer"] { transition: border-color 0.15s; }
        .indicator[style*="pointer"]:hover { border-color: var(--accent-blue); }

        /* ── Sélecteur programme ── */
        .programme-selector { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
        .programme-selector-label { font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; white-space: nowrap; }
        .programme-btns { display: flex; gap: 0.4rem; flex-wrap: wrap; }
        .programme-btn { border-radius: 6px; border: 1px solid var(--border); background: var(--bg-secondary); cursor: pointer; font-size: 0.75rem; font-weight: 600; padding: 0.3rem 0.875rem; transition: all 0.15s; }
        .programme-btn:hover { opacity: 0.85; }
        .programme-btn.active-none { background: var(--bg-hover); border-color: var(--border); color: var(--text-secondary); }

        /* ── Bandeau programme actif ── */
        .programme-banner { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.55rem 0.875rem; border-radius: 8px; border: 1px solid; margin-bottom: 0.5rem; flex-wrap: wrap; }
        .programme-banner-left { display: flex; flex-direction: column; gap: 0.1rem; }
        .programme-banner-label { font-size: 0.78rem; font-weight: 700; }
        .programme-banner-sub { font-size: 0.65rem; color: var(--text-muted); }
        .programme-banner-link { font-size: 0.68rem; font-weight: 500; text-decoration: none; white-space: nowrap; }
        .programme-banner-link:hover { text-decoration: underline; }

        /* ── Mesures ── */
        .mesures-zone { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-top: 0.5rem; }
        @media (max-width: 700px) { .mesures-zone { grid-template-columns: 1fr; } }
        .mesures-col { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 0.875rem; }
        .mesures-title { display: flex; align-items: center; gap: 0.4rem; font-size: 0.75rem; font-weight: 600; margin-bottom: 0.6rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--border-subtle); }
        .mesures-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
        .mesures-empty { font-size: 0.72rem; color: var(--text-muted); font-style: italic; padding: 0.25rem 0; }
        .mesures-placeholder { text-align: center; padding: 1.5rem; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius-lg); margin-top: 0.5rem; }
        .mesures-placeholder p { font-size: 0.8rem; color: var(--text-muted); }

        .mesure-row { display: flex; align-items: flex-start; justify-content: space-between; padding: 0.35rem 0; gap: 0.5rem; border-bottom: 1px solid var(--border-subtle); }
        .mesure-row:last-child { border-bottom: none; }
        .mesure-row.checked { background: rgba(56,139,253,0.04); border-radius: var(--radius); padding: 0.35rem 0.3rem; }
        .mesure-label-wrap { display: flex; align-items: flex-start; gap: 0.4rem; flex: 1; min-width: 0; }
        .mesure-check-wrap { display: flex; align-items: flex-start; gap: 0.4rem; cursor: pointer; flex: 1; min-width: 0; }
        .mesure-check { accent-color: var(--accent-blue); width: 13px; height: 13px; flex-shrink: 0; margin-top: 2px; cursor: pointer; }
        .mesure-label { font-size: 0.76rem; color: var(--text-secondary); line-height: 1.35; }
        .mesure-right { display: flex; align-items: center; gap: 0.3rem; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
        .mesure-impact { font-size: 0.68rem; color: var(--text-muted); white-space: nowrap; }

        .badge { display: inline-flex; align-items: center; padding: 1px 5px; border-radius: 9999px; font-size: 0.63rem; font-weight: 500; white-space: nowrap; }
        .badge-observe   { background: #1a3a2a; color: #3fb950; }
        .badge-hypothese { background: #2a2a1a; color: #d29922; }
        .badge-incertain { background: #2a1a1a; color: #f85149; }
        .badge-programme { display: inline-flex; align-items: center; padding: 1px 6px; border-radius: 9999px; font-size: 0.62rem; font-weight: 700; white-space: nowrap; border: 1px solid; flex-shrink: 0; margin-top: 1px; }
        .mesure-badge-programme { display: inline-flex; align-items: center; padding: 1px 5px; border-radius: 9999px; font-size: 0.6rem; font-weight: 700; white-space: nowrap; border: 1px solid; flex-shrink: 0; margin-top: 2px; }
        .btn-info { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.82rem; padding: 0 2px; transition: color 0.2s; line-height: 1; }
        .btn-info:hover { color: var(--accent-blue); }

        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 1rem; }
        .modal-card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.5rem; max-width: 500px; width: 100%; display: flex; flex-direction: column; gap: 1rem; max-height: 90vh; overflow-y: auto; }
        .modal-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
        .modal-title { font-size: 1rem; font-weight: 600; margin-bottom: 0.2rem; }
        .modal-source { font-size: 0.72rem; color: var(--text-muted); }
        .modal-source a { color: var(--accent-blue); text-decoration: none; }
        .modal-close { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 1rem; }
        .modal-infobulle { font-size: 0.78rem; color: var(--text-secondary); line-height: 1.6; background: var(--bg-card); padding: 0.75rem; border-radius: var(--radius); border-left: 2px solid var(--accent-blue); }
        .modal-impact { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; padding: 0.6rem 0.75rem; background: var(--bg-card); border-radius: var(--radius); }
        .modal-impact-label { font-size: 0.7rem; color: var(--text-muted); }
        .modal-impact-val { font-size: 0.88rem; font-weight: 600; flex: 1; }
        .modal-section-title { font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem; }
        .modal-list { list-style: none; display: flex; flex-direction: column; gap: 0.2rem; }
        .modal-list li { font-size: 0.76rem; color: var(--text-secondary); padding-left: 1rem; position: relative; }
        .modal-list li::before { content: '→'; position: absolute; left: 0; color: var(--text-muted); }
        .modal-questions li::before { content: '?'; color: var(--accent-orange); }
        .analogie { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; padding: 0.3rem 0; border-bottom: 1px solid var(--border-subtle); font-size: 0.73rem; }
        .analogie:last-child { border-bottom: none; }
        .analogie-pays { font-weight: 600; } .analogie-mesure { color: var(--text-secondary); }
        .analogie-impact { color: var(--accent-green); } .analogie-score { margin-left: auto; color: var(--text-muted); font-size: 0.65rem; }
        .modal-footer { display: flex; gap: 1rem; font-size: 0.72rem; color: var(--text-muted); border-top: 1px solid var(--border-subtle); padding-top: 0.6rem; }
        .modal-footer strong { color: var(--text-secondary); }

        .panel-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 400; display: flex; justify-content: flex-end; }
        .panel-drawer { background: #0d1117; border-left: 1px solid var(--border); width: min(480px, 92vw); height: 100%; display: flex; flex-direction: column; overflow: hidden; animation: slideIn 0.2s ease; }
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .panel-header { display: flex; justify-content: space-between; align-items: center; padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--border); flex-shrink: 0; }
        .panel-title { font-size: 1rem; font-weight: 600; color: var(--text-primary); margin: 0; }
        .panel-close { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 1.1rem; padding: 0; }
        .panel-close:hover { color: var(--text-primary); }
        .panel-body { flex: 1; overflow-y: auto; padding: 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 0.75rem; }
        .panel-para { font-size: 0.8rem; color: var(--text-secondary); line-height: 1.65; margin: 0; white-space: pre-line; }
        .panel-footer { padding: 0.875rem 1.5rem; border-top: 1px solid var(--border); font-size: 0.68rem; color: var(--text-muted); font-style: italic; flex-shrink: 0; }

        /* ── Indicateur croissance tri-horizon ── */
        .indicator--croissance { text-align: left; }
        .croissance-horizons { display: flex; flex-direction: column; gap: 0.18rem; margin-top: 0.3rem; }
        .croissance-row { display: flex; justify-content: space-between; align-items: center; padding: 0.18rem 0; border-top: 1px solid var(--border-subtle); gap: 0.5rem; }
        .croissance-horizon-label { font-size: 0.68rem; font-weight: 600; color: var(--text-muted); white-space: nowrap; }
        .croissance-horizon-sub { font-size: 0.58rem; font-weight: 400; color: var(--text-muted); margin-left: 2px; }
        .croissance-val { font-size: 0.75rem; font-weight: 600; white-space: nowrap; }
        .croissance-nc { font-size: 0.68rem; color: var(--text-muted); font-style: italic; }

        .budget-selector { display: flex; gap: 0.4rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
        .budget-btn { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; color: var(--text-secondary); cursor: pointer; font-size: 0.75rem; font-weight: 500; padding: 0.3rem 0.75rem; transition: all 0.15s; }
        .budget-btn:hover { border-color: var(--accent-blue); color: var(--accent-blue); }
        .budget-btn.active { background: var(--accent-blue); border-color: var(--accent-blue); color: #fff; }

        .budget-banner { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: 0.6rem 0.875rem; border-radius: 8px; margin-bottom: 0.5rem; flex-wrap: wrap; }
        .budget-banner--warning { background: rgba(210,153,34,0.1); border: 1px solid rgba(210,153,34,0.3); }
        .budget-banner--info    { background: rgba(56,139,253,0.08); border: 1px solid rgba(56,139,253,0.2); }
        .budget-banner--success { background: rgba(63,185,80,0.08);  border: 1px solid rgba(63,185,80,0.2); }
        .budget-banner-text { display: flex; flex-direction: column; gap: 0.15rem; flex: 1; }
        .budget-banner-label { font-size: 0.72rem; font-weight: 600; color: var(--text-primary); }
        .budget-banner-msg   { font-size: 0.7rem; color: var(--text-secondary); line-height: 1.4; }
        .budget-banner-sub   { font-size: 0.65rem; color: var(--text-muted); white-space: nowrap; align-self: center; }
      `}</style>
    </>
  );
}
