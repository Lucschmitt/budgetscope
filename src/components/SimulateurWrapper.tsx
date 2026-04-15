import { useState, useEffect } from 'react';
import Simulateur from './Simulateur';

interface BudgetEntry { id: string; label: string; file: string; }
interface Props { budgetList: BudgetEntry[]; }

export default function SimulateurWrapper({ budgetList }: Props) {
  const [activeId, setActiveId] = useState(budgetList[0]?.id ?? '');
  const [data, setData]         = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  useEffect(() => {
    const entry = budgetList.find(b => b.id === activeId);
    if (!entry) return;
    setLoading(true);
    setError('');
    fetch(entry.file)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(json => { setData(json); setLoading(false); })
      .catch(e  => { setError(e.message); setLoading(false); });
  }, [activeId]);

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
      Chargement du budget…
    </div>
  );

  if (error || !data) return (
    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--accent-red)', fontSize: '0.85rem' }}>
      Erreur de chargement : {error}
    </div>
  );

  return (
    <Simulateur
      data={data}
      budgetList={budgetList}
      onBudgetChange={setActiveId}
    />
  );
}
