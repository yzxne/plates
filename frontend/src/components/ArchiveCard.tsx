// Import & export → Keep the app fast: move food-log rows older than 12 months to the FoodArchive tab.
import { useEffect, useState } from 'preact/hooks';
import { api, errorMessage } from '../api';
import { loadSettings } from '../settingsStore';
import { showToast } from '../toast';

interface Preview { before: string; total: number; movable: number }

export function ArchiveCard() {
  const [p, setP] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<Preview>('GET', '/food/archive', undefined, 45_000).then(setP).catch(() => setP(null));
  useEffect(() => { void load(); }, []);

  async function move() {
    if (!p || !confirm(`Move ${p.movable.toLocaleString()} food entries from before ${p.before} into the archive tab? They still show on their days and can be edited. Google's version history can undo this.`)) return;
    setBusy(true);
    try {
      const r = await api<{ moved: number }>('POST', '/food/archive', {}, 90_000);
      await loadSettings(true);
      showToast(`Moved ${r.moved.toLocaleString()} entries`, 'ok');
      await load();
    } catch (err) { showToast(errorMessage(err), 'error'); } finally { setBusy(false); }
  }

  return (
    <div class="card">
      <h2>Keep the app fast</h2>
      <p class="muted tiny">
        Food you logged more than 12 months ago can move to the archive tab, so everyday loading stays quick as your log grows.
        Nothing is lost; old days still show and stay editable.
      </p>
      {p && <p class="tiny">{p.total.toLocaleString()} entries in your food log · {p.movable ? `${p.movable.toLocaleString()} older than 12 months` : 'nothing old enough to move yet'}.</p>}
      <button class="btn" style="width:100%" disabled={busy || !p?.movable} onClick={move}>{busy ? 'Moving…' : 'Move old food to the archive'}</button>
    </div>
  );
}
