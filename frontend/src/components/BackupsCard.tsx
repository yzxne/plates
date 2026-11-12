// Import & export → Automatic backups: weekly .xlsx copies kept on the Plates server (outside Google).
import { useEffect, useState } from 'preact/hooks';
import { api, apiBlob, errorMessage } from '../api';
import { saveFile } from '../exportData';
import { showToast } from '../toast';

interface Backup { date: string; bytes: number; at: string }
const fmtDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const kb = (n: number) => `${Math.round(n / 1024)} KB`;

export function BackupsCard() {
  const [list, setList] = useState<Backup[] | null>(null);
  const [keep, setKeep] = useState(8);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = () => api<{ backups: Backup[]; keep: number }>('GET', '/backups')
    .then((r) => { setList(r.backups); setKeep(r.keep); })
    .catch((err) => setError(errorMessage(err)));
  useEffect(() => { void load(); }, []);

  async function backUpNow() {
    setBusy('now');
    try { await api('POST', '/backups/run', {}, 60_000); await load(); showToast('Backup saved', 'ok'); }
    catch (err) { showToast(errorMessage(err), 'error'); } finally { setBusy(''); }
  }

  async function download(b: Backup) {
    setBusy(b.date);
    try { await saveFile(await apiBlob(`/backups/${b.date}`), `plates-backup-${b.date}.xlsx`); }
    catch (err) { showToast(errorMessage(err), 'error'); } finally { setBusy(''); }
  }

  return (
    <div class="card">
      <h2>Automatic backups</h2>
      <p class="muted tiny">Every Monday the Plates server saves an Excel copy of your Sheet outside Google. The newest {keep} are kept. Download one any time.</p>
      {error && <p class="error tiny">{error}</p>}
      {list?.length === 0 && <p class="muted tiny">No backups yet. The first runs next Monday, or tap Back up now.</p>}
      {list && list.length > 0 && (
        <div class="list">
          {list.map((b) => (
            <button key={b.date} class="row" disabled={!!busy} onClick={() => download(b)}>
              <span class="row-text"><span>{fmtDate(b.date)}</span><small class="muted">{kb(b.bytes)}</small></span>
              <span class="btn link">{busy === b.date ? 'Saving…' : 'Download'}</span>
            </button>
          ))}
        </div>
      )}
      <button class="btn mt" style="width:100%" disabled={!!busy} onClick={backUpNow}>{busy === 'now' ? 'Backing up…' : 'Back up now'}</button>
    </div>
  );
}
