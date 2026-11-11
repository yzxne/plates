import { useEffect, useState } from 'preact/hooks';
import { errorMessage } from '../api';
import { fmt } from '../format';
import { loadWeights, type WeighIn } from '../weightData';

/** Progress tab. Full charts (weight trend, expenditure, calories vs target, macros, habits, check-ins) arrive in Phase 5. */
export function Progress() {
  const [weights, setWeights] = useState<WeighIn[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { loadWeights(true).then(setWeights).catch((err) => setError(errorMessage(err))); }, []);
  return (
    <section>
      <header class="screen-head"><h1>Progress</h1></header>
      <div class="card empty">
        <p>Weight trend, expenditure, calories vs target, macros, habit grids and check-ins.</p>
        <small class="muted">Arrives in Phase 5.</small>
      </div>
      <div class="card">
        <h2>Weigh-ins</h2>
        {error && <p class="error">{error}</p>}
        {weights?.length === 0 && <p class="muted">No weigh-ins yet. Use "Weigh in" on Today.</p>}
        <ul class="plain">
          {weights?.slice(0, 14).map((w) => <li key={w.id}><span class="muted">{w.date} {w.time}</span> · <strong>{fmt(w.weight_lb, 1)} lb</strong></li>)}
        </ul>
      </div>
    </section>
  );
}
