import { useEffect, useState } from 'preact/hooks';
import { getUsage, type AiUsage } from '../aiData';
import { errorMessage } from '../api';

/** Settings card: AI spend this month vs the monthly cap (brief §6). */
export function AiUsageCard() {
  const [u, setU] = useState<AiUsage | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { getUsage().then(setU).catch((err) => setError(errorMessage(err))); }, []);

  const pct = u && u.cap > 0 ? Math.min(100, (u.month_total / u.cap) * 100) : 0;
  return (
    <div class="card">
      <h2>AI estimates</h2>
      {error && <p class="error">{error}</p>}
      {!u && !error && <><span class="skel skel-line" style={{ width: '60%' }} /><span class="skel skel-line" style={{ width: '90%' }} /></>}
      {u && !u.configured && (
        <p class="warn">Not set up yet — the Anthropic API key isn't on the backend. "Paste AI result" still works for free.</p>
      )}
      {u && (
        <>
          <p class="no-margin">
            <strong>${u.month_total.toFixed(2)}</strong> of ${u.cap.toFixed(2)} this month · {u.count} estimate{u.count === 1 ? '' : 's'}
          </p>
          <div class="usage-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
            <span class={pct >= 100 ? 'over' : ''} style={{ width: `${pct}%` }} />
          </div>
          <p class="muted tiny-pad">
            {u.count > 0 ? `About $${(u.month_total / u.count).toFixed(4)} per estimate. ` : 'A photo estimate costs well under 1¢. '}
            Change the cap under Settings → AI monthly cap. When it's reached, use "Paste AI result" instead.
          </p>
        </>
      )}
    </div>
  );
}
