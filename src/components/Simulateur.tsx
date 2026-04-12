import { useState, useMemo, useRef, useEffect } from 'react';
import SankeyChart from './Sankey';

// ── Types ──────────────────────────────────────────────────────────────────
interface Poste {
  id: string; label: string; valeur: number; min: number; max: number;
  fixe?: boolean; source: string; infobulle: string;
  taux_compensation_secu?: number; taux_allegement?: number;
}
interface Mesure {
  id: string; label: string; source_label: string; source_url: string;
  type: 'recette' | 'depense'; budget: 'plf' | 'plfss'; poste: string;
  impact_min: number; impact_max: number; statut: string; confiance: string;
  infobulle: string; effets_indirects: string[];
  analogies_historiques: { pays: string; annee: number; mesure: string; impact_observe: string; score: number }[];
  questions: string[];
}
interface BudgetData {
  meta: { annee: number; pib: number; dette_initiale_pct: number };
  recettes_plf: Poste[]; recettes_plfss: Poste[];
  consolidation: { compensation_tva_secu: number; emprunt_etat: number; infobulle_compensation: string; infobulle_emprunt: string; };
  depenses_plf: Poste[]; depenses_plfss: Poste[];
  mesures: Mesure[];
  multiplicateurs: Record<string, { bas: number; haut: number }>;
}
interface Props { data: BudgetData }

// ── Helpers ────────────────────────────────────────────────────────────────
const STATUT: Record<string, { label: string; cls: string }> = {
  observe:                { label: 'Observé',      cls: 'badge-observe'   },
  hypothese_partielle:    { label: 'Hypothèse',    cls: 'badge-hypothese' },
  hypothese_non_verifiee: { label: 'Non vérifiée', cls: 'badge-hypothese' },
  incertain:              { label: 'Incertain',    cls: 'badge-incertain' },
};
const fmt = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(0)} mds`;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

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
function FicheMesure({ mesure, onClose }: { mesure: Mesure; onClose: () => void }) {
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
          <button className="modal-close" onClick={onClose}>✕</button>
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
function MesureRow({ mesure, checked, onToggle, onOpenFiche }: {
  mesure: Mesure; checked: boolean; onToggle: () => void; onOpenFiche: () => void;
}) {
  const st = STATUT[mesure.statut] ?? { label: mesure.statut, cls: 'badge-hypothese' };
  return (
    <div className={`mesure-row${checked ? ' checked' : ''}`}>
      <label className="mesure-check-wrap">
        <input type="checkbox" checked={checked} onChange={onToggle} className="mesure-check" />
        <span className="mesure-label">{mesure.label}</span>
      </label>
      <div className="mesure-right">
        <span className="mesure-impact">{fmt(mesure.impact_min)} à {fmt(mesure.impact_max)}</span>
        <span className={`badge ${st.cls}`}>{st.label}</span>
        <button className="btn-info" onClick={onOpenFiche}>ⓘ</button>
      </div>
    </div>
  );
}

// ── Simulateur ─────────────────────────────────────────────────────────────
export default function Simulateur({ data }: Props) {
  const [cochees, setCochees]         = useState<Set<string>>(new Set());
  const [ficheOuverte, setFiche]      = useState<Mesure | null>(null);

  const deltas = useMemo(() => {
    const acc: Record<string, { min: number; max: number }> = {};
    for (const id of cochees) {
      const m = data.mesures.find(m => m.id === id);
      if (!m) continue;
      if (!acc[m.poste]) acc[m.poste] = { min: 0, max: 0 };
      acc[m.poste].min += m.impact_min;
      acc[m.poste].max += m.impact_max;
    }
    return acc;
  }, [cochees]);

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

  const compensationSecu = useMemo(() => {
    const tva  = veff['tva'] ?? 216;
    const taux = data.recettes_plf.find(p => p.id === 'tva')?.taux_compensation_secu ?? 0.30;
    return Math.round(tva * taux);
  }, [veff]);

  const plfNet   = totalPlf - compensationSecu;
  const plfssNet = totalPlfss + compensationSecu;
  const emprunt  = data.consolidation.emprunt_etat;

  const totalDepPlf   = useMemo(() => data.depenses_plf.reduce((s, p) => s + ve(p), 0),   [veff]);
  const totalDepPlfss = useMemo(() => data.depenses_plfss.reduce((s, p) => s + ve(p), 0), [veff]);
  const totalDep      = totalDepPlf + totalDepPlfss;

  const solde       = (plfNet + plfssNet) - totalDep;
  const soldePct    = (solde / data.meta.pib) * 100;
  const dette       = data.meta.dette_initiale_pct - soldePct;

  const impactCroissance = useMemo(() => {
    let bas = 0, haut = 0;
    for (const id of cochees) {
      const m = data.mesures.find(m => m.id === id);
      if (!m) continue;
      const mult = data.multiplicateurs[m.poste];
      if (!mult) continue;
      const d = (m.impact_min + m.impact_max) / 2;
      bas  -= d * mult.bas  / data.meta.pib * 100;
      haut -= d * mult.haut / data.meta.pib * 100;
    }
    return { bas: Math.min(bas, haut), haut: Math.max(bas, haut) };
  }, [cochees]);

  const toggle = (id: string) => setCochees(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const sankeyRecettesPLF   = data.recettes_plf.map(p => ({ ...p, valeurEffective: ve(p) }));
  const sankeyRecettesPLFSS = data.recettes_plfss.map(p => ({ ...p, valeurEffective: ve(p) }));
  const sankeyDepensesPLF   = data.depenses_plf.map(p => ({ ...p, valeurEffective: ve(p) }));
  const sankeyDepensesPLFSS = data.depenses_plfss.map(p => ({ ...p, valeurEffective: ve(p) }));
  const mesuresActives = data.mesures.filter(m => cochees.has(m.id)).map(m => ({
    id: m.id, label: m.label, poste: m.poste,
    impact_min: m.impact_min, impact_max: m.impact_max,
    statut: m.statut,
    source_label: m.source_label,
    effets_indirects: m.effets_indirects,
  }));

  return (
    <>
      <div className="sankey-full">
        <SankeyChart
          recettes_plf={sankeyRecettesPLF}
          recettes_plfss={sankeyRecettesPLFSS}
          depenses_plf={sankeyDepensesPLF}
          depenses_plfss={sankeyDepensesPLFSS}
          compensationSecu={compensationSecu}
          emprunt={data.consolidation.emprunt_etat}
          compensation_infobulle={data.consolidation.infobulle_compensation}
          emprunt_infobulle={data.consolidation.infobulle_emprunt}
          deltas={deltas}
          mesuresActives={mesuresActives}
        />
      </div>

      {/* ── Indicateurs ── */}
      <div className="indicators">
        <div className="indicator">
          <div className="ind-label">Solde hors emprunt</div>
          <div className={`ind-value ${solde >= 0 ? 'val-pos' : 'val-neg'}`}>{fmt(solde)} €</div>
          <div className="ind-sub">{soldePct.toFixed(1)} % du PIB</div>
        </div>
        <div className="indicator">
          <div className="ind-label">Dette estimée</div>
          <div className={`ind-value ${dette > 100 ? 'val-neg' : 'val-pos'}`}>{dette.toFixed(1)} %</div>
          <div className="ind-sub">du PIB — réf. 60 % (Maastricht)</div>
        </div>
        <div className="indicator">
          <div className="ind-label">Impact croissance</div>
          <div className="ind-value val-neutral">{impactCroissance.bas.toFixed(2)} à {impactCroissance.haut.toFixed(2)} %</div>
          <div className="ind-sub">Fourchette multiplicateurs OFCE</div>
        </div>
        <div className="indicator">
          <div className="ind-label">Mesures actives</div>
          <div className="ind-value val-neutral">{cochees.size}</div>
          <div className="ind-sub">{cochees.size === 0 ? 'Budget PLF 2025 de base' : 'Scénario modifié'}</div>
        </div>
      </div>

      {/* ── Mesures ── */}
      <div className="mesures-zone">
        <div className="mesures-col">
          <h3 className="mesures-title"><span className="mesures-dot dot-blue"/>Propositions — Recettes</h3>
          {data.mesures.filter(m => m.type === 'recette').map(m => (
            <MesureRow key={m.id} mesure={m} checked={cochees.has(m.id)} onToggle={() => toggle(m.id)} onOpenFiche={() => setFiche(m)}/>
          ))}
        </div>
        <div className="mesures-col">
          <h3 className="mesures-title"><span className="mesures-dot dot-red"/>Propositions — Dépenses</h3>
          {data.mesures.filter(m => m.type === 'depense').map(m => (
            <MesureRow key={m.id} mesure={m} checked={cochees.has(m.id)} onToggle={() => toggle(m.id)} onOpenFiche={() => setFiche(m)}/>
          ))}
        </div>
      </div>

      {ficheOuverte && <FicheMesure mesure={ficheOuverte} onClose={() => setFiche(null)}/>}

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

        .consol-row { display: flex; justify-content: space-between; align-items: center; padding: 2px 0; font-size: 0.71rem; gap: 4px; }
        .consol-label { color: var(--text-secondary); display: flex; align-items: center; gap: 3px; }
        .consol-val { font-weight: 500; white-space: nowrap; }
        .consol-total { display: flex; justify-content: space-between; align-items: center; padding: 0.4rem 0.5rem; background: var(--bg-hover); border-radius: var(--radius); font-size: 0.75rem; font-weight: 600; border: 1px solid var(--border); margin-top: 0.2rem; }
        .consol-total-val { color: var(--accent-blue); }

        .col-sankey { background: var(--bg-card); }
        .sankey-wrap { min-height: 360px; }

        .indicators { display: grid; grid-template-columns: repeat(4,1fr); gap: 0.75rem; margin: 0.75rem 0; }
        @media (max-width: 768px) { .indicators { grid-template-columns: repeat(2,1fr); } }
        .indicator { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 0.875rem; text-align: center; }
        .ind-label { font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.3rem; }
        .ind-value { font-size: 1.3rem; font-weight: 600; }
        .val-pos { color: var(--accent-green); } .val-neg { color: var(--accent-red); } .val-neutral { color: var(--text-primary); }
        .ind-sub { font-size: 0.63rem; color: var(--text-muted); margin-top: 0.2rem; }

        .mesures-zone { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-top: 0.5rem; }
        @media (max-width: 700px) { .mesures-zone { grid-template-columns: 1fr; } }
        .mesures-col { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 0.875rem; }
        .mesures-title { display: flex; align-items: center; gap: 0.4rem; font-size: 0.75rem; font-weight: 600; margin-bottom: 0.6rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--border-subtle); }
        .mesures-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

        .mesure-row { display: flex; align-items: flex-start; justify-content: space-between; padding: 0.35rem 0; gap: 0.5rem; border-bottom: 1px solid var(--border-subtle); }
        .mesure-row:last-child { border-bottom: none; }
        .mesure-row.checked { background: rgba(56,139,253,0.06); border-radius: var(--radius); padding: 0.35rem 0.3rem; }
        .mesure-check-wrap { display: flex; align-items: flex-start; gap: 0.4rem; cursor: pointer; flex: 1; min-width: 0; }
        .mesure-check { accent-color: var(--accent-blue); width: 13px; height: 13px; flex-shrink: 0; margin-top: 2px; cursor: pointer; }
        .mesure-label { font-size: 0.76rem; color: var(--text-secondary); line-height: 1.35; }
        .mesure-row.checked .mesure-label { color: var(--text-primary); }
        .mesure-right { display: flex; align-items: center; gap: 0.3rem; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
        .mesure-impact { font-size: 0.68rem; color: var(--text-muted); white-space: nowrap; }

        .badge { display: inline-flex; align-items: center; padding: 1px 5px; border-radius: 9999px; font-size: 0.63rem; font-weight: 500; white-space: nowrap; }
        .badge-observe   { background: #1a3a2a; color: #3fb950; }
        .badge-hypothese { background: #2a2a1a; color: #d29922; }
        .badge-incertain { background: #2a1a1a; color: #f85149; }
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
      `}</style>
    </>
  );
}
