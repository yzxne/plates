import { useEffect, useState } from 'preact/hooks';
import { queue } from '../queue';
import { showToast } from '../toast';

/** Shows saves that failed and are waiting to retry. Hidden when empty. */
export function PendingCard() {
  const [items, setItems] = useState(queue.list());
  const [busy, setBusy] = useState(false);
  useEffect(() => queue.subscribe(() => setItems(queue.list())), []);

  if (!items.length) return null;

  async function retry() {
    setBusy(true);
    const { sent, failed } = await queue.flush();
    setBusy(false);
    if (sent && !failed) showToast(`Saved ${sent} pending change${sent > 1 ? 's' : ''}`, 'ok');
    else if (failed) showToast('Still not saved — see the error below', 'error');
  }

  function discard(id: string, label: string) {
    if (confirm(`Discard "${label}"? This change will be lost.`)) queue.discard(id);
  }

  return (
    <div class="card pending">
      <h2>Not saved yet ({items.length})</h2>
      <ul>
        {items.map((i) => (
          <li key={i.id}>
            <div>
              <strong>{i.label}</strong>
              <small class="error">{i.stuck ? 'Rejected: ' : ''}{i.lastError}</small>
            </div>
            <button class="btn link danger" onClick={() => discard(i.id, i.label)}>Discard</button>
          </li>
        ))}
      </ul>
      <button class="btn primary" disabled={busy} onClick={retry}>{busy ? 'Retrying…' : 'Retry now'}</button>
    </div>
  );
}
