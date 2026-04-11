import { useState, useMemo } from 'react';
import SankeyChart from './Sankey';

// ── Types ──────────────────────────────────────────────────────────────────
interface Poste {
  id: string;
  label: string;
  valeur: number;
  min: number;
  max: number;
  couleur: string;
  fixe?: boolean;
}

interface Mesure {
  id: string;
  label: string;
  source: string;
  type: 'recette' | 'depense';
  poste: string;
  impact_min: number;
  impact_max: number;
  statut: string;
  confiance: string;
  effets_indirects: string[];
  questions: string[];
}

interface BudgetData {
  recettes: Poste[];
  depenses: Poste[];
  mesures: Mesure[];
  pib: number;
  dette_initiale_pct: number;
  multiplicateurs: Record<string, { bas: number; haut: number }>;
}

interface Props {
  data: BudgetData;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const STATUT_CONFIG: Record<string, { label: string; cls: string }> = {
  observe:                { label: 'Observé',        cls: 'badge-observe'   },
  hypothese_partielle:    { label: 'Hypothèse',      cls: 'badge-hypothese' },
  hypothese_non_verifiee: { label: 'Non vérifiée',   cls: 'badge-hypothese' },
  incertain:              { label: 'Incertain',      cls: 'badge-incertain' },
};

function fmt(n: number): string {
  const abs = Math.abs(n);
  const sign = n >= 0 ? '+' : '−';
  return `${sign}${abs.toFixed(0)} mds`;
}

function clamp(val: number, min: number, max: number) {
  return Math.min(max, Math.max(min, val));
}

// ── Composant fiche mesure (inline) ───────────────────────────────────────
function FicheMesure({ mesure, onClose }: { mesure: Mesure; onClose: () => void }) {
  const statut = STATUT_CONFIG[mesure.statut] ?? { label: mesure.statut, cls: 'badge-hypothese' };
  return (
    <div className="fiche-overlay" onClick={onClose}>
      <div className="fiche-card" onClick={e => e.stopPropagation()}>
        <div className="fiche-header">
          <div>
            <h3 className="fiche-title">{mesure.label}</h3>
            <p className="fiche-source">{mesure.source}</p>
          </div>
          <button className="fiche-close" onClick={onClose}>✕</button>
        </div>

        <div className="fiche-impact">
          <span className="fiche-impact-label">Impact direct estimé</span>
          <span className="fiche-impact-value">
            {fmt(mesure.impact_min)} à {fmt(mesure.impact_max)} €
          </span>
          <span className={`badge ${statut.cls}`}>{statut.label}</span>
        </div>

        {mesure.effets_indirects.length > 0 && (
          <div className="fiche-section">
            <h4 className="fiche-section-title">Effets indirects</h4>
            <ul className="fiche-list">
              {mesure.effets_indirects.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        {mesure.questions.length > 0 && (
          <div className="fiche-section">
            <h4 className="fiche-section-title">Questions soulevées</h4>
            <ul className="fiche-list fiche-questions">
              {mesure.questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="fiche-footer">
          <span className="fiche-confiance">Confiance : {mesure.confiance}</span>
        </div>
      </div>
    </div>
  );
}

// ── Composant principal ────────────────────────────────────────────────────
export default function Simulateur({ data }: Props) {
  const [cochees, setCochees] = useState<Set<string>>(new Set());
  const [ficheOuverte, setFicheOuverte] = useState<Mesure | null>(null);

  // Calculer les deltas cumulés par poste
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
  }, [cochees, data.mesures]);

  // Valeurs effectives des postes (base + delta médian)
  function valeurEffective(poste: Poste): number {
    const d = deltas[poste.id];
    if (!d) return poste.valeur;
    const median = (d.min + d.max) / 2;
    return clamp(poste.valeur + median, poste.min, poste.max);
  }

  // Totaux
  const totalRecettes = useMemo(() =>
    data.recettes.reduce((s, p) => s + valeurEffective(p), 0),
    [cochees]
  );
  const totalDepenses = useMemo(() =>
    data.depenses.reduce((s, p) => s + valeurEffective(p), 0),
    [cochees]
  );
  const solde = totalRecettes - totalDepenses;
  const soldePctPIB = (solde / data.pib) * 100;

  // Impact croissance (fourchette)
  const impactCroissance = useMemo(() => {
    let bas = 0, haut = 0;
    for (const id of cochees) {
      const m = data.mesures.find(m => m.id === id);
      if (!m) continue;
      const mult = data.multiplicateurs[m.poste];
      if (!mult) continue;
      const delta = (m.impact_min + m.impact_max) / 2;
      // Dépense baisse = effet négatif ; recette hausse = effet négatif sur conso
      const signe = m.type === 'depense' ? -1 : -1;
      bas  += signe * delta * mult.bas  / data.pib * 100;
      haut += signe * delta * mult.haut / data.pib * 100;
    }
    return { bas: Math.min(bas, haut), haut: Math.max(bas, haut) };
  }, [cochees]);

  // Dette estimée
  const detteEstimee = data.dette_initiale_pct - soldePctPIB;

  function toggle(id: string) {
    setCochees(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const mesuresRecettes = data.mesures.filter(m => m.type === 'recette');
  const mesuresDepenses = data.mesures.filter(m => m.type === 'depense');

  return (
    <>
      <div className="sim-layout">
        {/* ── Recettes ── */}
        <aside className="panel">
          <h2 className="panel-title">
            <span className="dot dot-blue" />
            Recettes
            <span className="panel-total">{totalRecettes.toFixed(0)} mds €</span>
          </h2>

          <div className="postes">
            {data.recettes.map(poste => {
              const val = valeurEffective(poste);
              const pct = ((val - poste.min) / (poste.max - poste.min)) * 100;
              const d = deltas[poste.id];
              return (
                <div key={poste.id} className="poste">
                  <div className="poste-header">
                    <span className="poste-label">{poste.label}</span>
                    <span className="poste-val">
                      {val.toFixed(0)} mds
                      {d && <span className="poste-delta delta-pos">{fmt((d.min+d.max)/2)}</span>}
                    </span>
                  </div>
                  <div className="track">
                    <div className="track-fill track-blue" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mesures-section">
            <h3 className="mesures-title">Propositions</h3>
            {mesuresRecettes.map(m => {
              const statut = STATUT_CONFIG[m.statut] ?? { label: m.statut, cls: 'badge-hypothese' };
              return (
                <div key={m.id} className="mesure-row">
                  <label className="mesure-label-wrap">
                    <input
                      type="checkbox"
                      checked={cochees.has(m.id)}
                      onChange={() => toggle(m.id)}
                      className="mesure-check"
                    />
                    <span className="mesure-label">{m.label}</span>
                  </label>
                  <div className="mesure-right">
                    <span className={`badge ${statut.cls}`}>{statut.label}</span>
                    <button className="btn-info" onClick={() => setFicheOuverte(m)} title="Voir la fiche">ⓘ</button>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* ── Sankey ── */}
        <section className="sankey-zone">
          <div className="sankey-card">
            <SankeyChart
              recettes={data.recettes.map(p => ({ ...p, valeurEffective: valeurEffective(p) }))}
              depenses={data.depenses.map(p => ({ ...p, valeurEffective: valeurEffective(p) }))}
              totalRecettes={totalRecettes}
              totalDepenses={totalDepenses}
            />
          </div>
        </section>

        {/* ── Dépenses ── */}
        <aside className="panel">
          <h2 className="panel-title">
            <span className="dot dot-red" />
            Dépenses
            <span className="panel-total">{totalDepenses.toFixed(0)} mds €</span>
          </h2>

          <div className="postes">
            {data.depenses.map(poste => {
              const val = valeurEffective(poste);
              const pct = ((val - poste.min) / (poste.max - poste.min)) * 100;
              const d = deltas[poste.id];
              return (
                <div key={poste.id} className={`poste ${poste.fixe ? 'poste-fixe' : ''}`}>
                  <div className="poste-header">
                    <span className="poste-label">
                      {poste.label}
                      {poste.fixe && <span className="poste-fixe-badge">fixe</span>}
                    </span>
                    <span className="poste-val">
                      {val.toFixed(0)} mds
                      {d && <span className="poste-delta delta-neg">{fmt((d.min+d.max)/2)}</span>}
                    </span>
                  </div>
                  <div className="track">
                    <div className="track-fill track-red" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mesures-section">
            <h3 className="mesures-title">Propositions</h3>
            {mesuresDepenses.map(m => {
              const statut = STATUT_CONFIG[m.statut] ?? { label: m.statut, cls: 'badge-hypothese' };
              return (
                <div key={m.id} className="mesure-row">
                  <label className="mesure-label-wrap">
                    <input
                      type="checkbox"
                      checked={cochees.has(m.id)}
                      onChange={() => toggle(m.id)}
                      className="mesure-check"
                    />
                    <span className="mesure-label">{m.label}</span>
                  </label>
                  <div className="mesure-right">
                    <span className={`badge ${statut.cls}`}>{statut.label}</span>
                    <button className="btn-info" onClick={() => setFicheOuverte(m)} title="Voir la fiche">ⓘ</button>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>

      {/* ── Indicateurs ── */}
      <div className="indicators">
        <div className="indicator">
          <div className="ind-label">Solde budgétaire</div>
          <div className={`ind-value ${solde >= 0 ? 'val-pos' : 'val-neg'}`}>
            {fmt(solde)} €
          </div>
          <div className="ind-sub">{soldePctPIB.toFixed(1)} % du PIB</div>
        </div>
        <div className="indicator">
          <div className="ind-label">Dette estimée</div>
          <div className={`ind-value ${detteEstimee > 100 ? 'val-neg' : 'val-pos'}`}>
            {detteEstimee.toFixed(1)} %
          </div>
          <div className="ind-sub">du PIB — réf. Maastricht 60 %</div>
        </div>
        <div className="indicator">
          <div className="ind-label">Impact croissance</div>
          <div className="ind-value val-neutral">
            {impactCroissance.bas.toFixed(2)} à {impactCroissance.haut.toFixed(2)} %
          </div>
          <div className="ind-sub">Fourchette multiplicateurs OFCE</div>
        </div>
        <div className="indicator">
          <div className="ind-label">Mesures actives</div>
          <div className="ind-value val-neutral">{cochees.size}</div>
          <div className="ind-sub">
            {cochees.size === 0 ? 'Budget de base PLF 2025' : 'Scénario modifié'}
          </div>
        </div>
      </div>

      {/* ── Fiche mesure ── */}
      {ficheOuverte && (
        <FicheMesure mesure={ficheOuverte} onClose={() => setFicheOuverte(null)} />
      )}

      <style>{`
        .sim-layout {
          display: grid;
          grid-template-columns: 300px 1fr 300px;
          gap: 1rem;
          margin: 1.5rem 0 1rem;
          align-items: start;
        }
        @media (max-width: 1100px) {
          .sim-layout { grid-template-columns: 1fr; }
          .sankey-zone { order: -1; }
        }

        /* Panel */
        .panel {
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .panel-title {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          font-weight: 600;
        }
        .panel-total {
          margin-left: auto;
          font-size: 0.75rem;
          color: var(--text-secondary);
          font-weight: 400;
        }
        .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .dot-blue { background: var(--accent-blue); }
        .dot-red  { background: var(--accent-red); }

        /* Postes */
        .postes { display: flex; flex-direction: column; gap: 0.65rem; }
        .poste {}
        .poste-fixe { opacity: 0.6; }
        .poste-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 4px;
          gap: 0.5rem;
        }
        .poste-label {
          font-size: 0.78rem;
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          gap: 0.3rem;
        }
        .poste-val {
          font-size: 0.78rem;
          color: var(--text-primary);
          font-weight: 500;
          white-space: nowrap;
          display: flex;
          align-items: center;
          gap: 0.3rem;
        }
        .poste-delta { font-size: 0.7rem; font-weight: 600; }
        .delta-pos { color: var(--accent-green); }
        .delta-neg { color: var(--accent-red); }
        .poste-fixe-badge {
          font-size: 0.65rem;
          padding: 1px 5px;
          border-radius: 9999px;
          background: var(--bg-hover);
          color: var(--text-muted);
          border: 1px solid var(--border);
        }

        /* Track (barre de progression en lecture seule) */
        .track {
          height: 4px;
          background: var(--border);
          border-radius: 2px;
          overflow: hidden;
        }
        .track-fill {
          height: 100%;
          border-radius: 2px;
          transition: width 0.4s ease;
        }
        .track-blue { background: var(--accent-blue); }
        .track-red  { background: var(--accent-red); }

        /* Mesures */
        .mesures-section {
          border-top: 1px solid var(--border-subtle);
          padding-top: 0.75rem;
        }
        .mesures-title {
          font-size: 0.7rem;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 0.5rem;
        }
        .mesure-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.35rem 0;
          gap: 0.5rem;
        }
        .mesure-label-wrap {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          cursor: pointer;
          flex: 1;
          min-width: 0;
        }
        .mesure-check {
          accent-color: var(--accent-blue);
          width: 13px;
          height: 13px;
          flex-shrink: 0;
          cursor: pointer;
        }
        .mesure-label {
          font-size: 0.78rem;
          color: var(--text-secondary);
          line-height: 1.3;
        }
        .mesure-row:has(.mesure-check:checked) .mesure-label {
          color: var(--text-primary);
        }
        .mesure-right {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          flex-shrink: 0;
        }
        .btn-info {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 0.85rem;
          padding: 0 2px;
          transition: color 0.2s;
          line-height: 1;
        }
        .btn-info:hover { color: var(--accent-blue); }

        /* Sankey zone */
        .sankey-zone {}
        .sankey-card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 0.5rem;
          min-height: 420px;
        }

        /* Indicateurs */
        .indicators {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 1rem;
          margin-top: 1rem;
        }
        @media (max-width: 768px) { .indicators { grid-template-columns: repeat(2,1fr); } }
        .indicator {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1rem;
          text-align: center;
        }
        .ind-label {
          font-size: 0.7rem;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.4rem;
        }
        .ind-value { font-size: 1.4rem; font-weight: 600; }
        .val-pos     { color: var(--accent-green); }
        .val-neg     { color: var(--accent-red); }
        .val-neutral { color: var(--text-primary); }
        .ind-sub { font-size: 0.68rem; color: var(--text-muted); margin-top: 0.25rem; }

        /* Fiche overlay */
        .fiche-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.7);
          z-index: 200;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
        }
        .fiche-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.5rem;
          max-width: 480px;
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .fiche-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1rem;
        }
        .fiche-title { font-size: 1rem; font-weight: 600; margin-bottom: 0.2rem; }
        .fiche-source { font-size: 0.75rem; color: var(--text-muted); }
        .fiche-close {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 1rem;
          flex-shrink: 0;
          padding: 2px;
        }
        .fiche-close:hover { color: var(--text-primary); }
        .fiche-impact {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem;
          background: var(--bg-card);
          border-radius: var(--radius);
          flex-wrap: wrap;
        }
        .fiche-impact-label { font-size: 0.75rem; color: var(--text-muted); }
        .fiche-impact-value { font-size: 0.9rem; font-weight: 600; flex: 1; }
        .fiche-section {}
        .fiche-section-title {
          font-size: 0.75rem;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.4rem;
        }
        .fiche-list {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
        }
        .fiche-list li {
          font-size: 0.82rem;
          color: var(--text-secondary);
          padding-left: 1rem;
          position: relative;
        }
        .fiche-list li::before { content: '→'; position: absolute; left: 0; color: var(--text-muted); }
        .fiche-questions li::before { content: '?'; color: var(--accent-orange); }
        .fiche-footer { border-top: 1px solid var(--border-subtle); padding-top: 0.75rem; }
        .fiche-confiance { font-size: 0.75rem; color: var(--text-muted); }
      `}</style>
    </>
  );
}
