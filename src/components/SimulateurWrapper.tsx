import { useState, useEffect } from 'react';
import Simulateur from './Simulateur';

interface BudgetEntry    { id: string; label: string; file: string; }
interface ProgrammeEntry { id: string; label: string; label_court: string; couleur: string; file: string; }
interface Props {
  budgetList:    BudgetEntry[];
  programmeList?: ProgrammeEntry[];
  catalogueFile?: string;
  multiplicateursFile?: string;
}

const BASE = import.meta.env.BASE_URL ?? '';

export default function SimulateurWrapper({
  budgetList,
  programmeList = [],
  catalogueFile       = `${BASE}/data/mesures/catalogue.json`,
  multiplicateursFile = `${BASE}/data/mesures/multiplicateurs.json`,
}: Props) {
  const [activeId,        setActiveId]        = useState(budgetList[0]?.id ?? '');
  const [budgetData,      setBudgetData]       = useState<any>(null);
  const [catalogue,       setCatalogue]        = useState<any[]>([]);
  const [multiplicateurs, setMultiplicateurs]  = useState<Record<string, any>>({});
  const [programmes,      setProgrammes]       = useState<Record<string, any>>({});
  const [loading,         setLoading]          = useState(true);
  const [error,           setError]            = useState('');

  // ── Charge budget + catalogue + multiplicateurs au montage ────────────
  useEffect(() => {
    const entry = budgetList.find(b => b.id === activeId);
    if (!entry) return;
    setLoading(true);
    setError('');

    Promise.all([
      fetch(entry.file).then(r => { if (!r.ok) throw new Error(`Budget HTTP ${r.status}`); return r.json(); }),
      fetch(catalogueFile).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(multiplicateursFile).then(r => r.ok ? r.json() : {}).catch(() => ({})),
    ])
      .then(([budget, cat, mult]) => {
        setBudgetData(budget);
        // Fallback : si catalogue vide, récupérer les mesures legacy du JSON budget
        setCatalogue(cat.length > 0 ? cat : (budget.mesures ?? []));
        // Fallback : si multiplicateurs vides, récupérer depuis le JSON budget
        setMultiplicateurs(Object.keys(mult).length > 0 ? mult : (budget.multiplicateurs ?? {}));
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [activeId]);

  // ── Charge les programmes en parallèle (non bloquant) ─────────────────
  useEffect(() => {
    if (programmeList.length === 0) return;
    Promise.all(
      programmeList.map(p =>
        fetch(p.file)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
          .then(data => data ? [p.id, data] as [string, any] : null)
      )
    ).then(results => {
      const map: Record<string, any> = {};
      for (const r of results) { if (r) map[r[0]] = r[1]; }
      setProgrammes(map);
    });
  }, [programmeList]);

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
      Chargement du budget…
    </div>
  );
  if (error || !budgetData) return (
    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--accent-red)', fontSize: '0.85rem' }}>
      Erreur de chargement : {error}
    </div>
  );

  return (
    <Simulateur
      data={budgetData}
      catalogue={catalogue}
      multiplicateurs={multiplicateurs}
      programmeList={programmeList}
      programmes={programmes}
      budgetList={budgetList}
      onBudgetChange={setActiveId}
    />
  );
}
