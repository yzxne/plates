// Settings → Shortcuts: a separate key for iPhone Shortcuts (never your passcode) + the addresses they call.
import { useEffect, useState } from 'preact/hooks';
import { api, API_BASE, errorMessage } from '../api';
import { showToast } from '../toast';

interface Status { exists: boolean; created_at: string | null }
const GUIDE = 'https://github.com/yzxne/plates/blob/main/docs/shortcuts.md';

async function copy(text: string, what: string) {
  try { await navigator.clipboard.writeText(text); showToast(`${what} copied`, 'ok'); } catch { showToast('Copy failed — press and hold to copy', 'error'); }
}

export function ShortcutsCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const startUrl = `${location.origin}${import.meta.env.BASE_URL}?start=next`;

  useEffect(() => { api<Status>('GET', '/shortcut-key').then(setStatus).catch(() => setStatus({ exists: false, created_at: null })); }, []);

  async function create() {
    if (status?.exists && !confirm('Make a new key? Shortcuts using the old key will stop working until you paste the new one.')) return;
    setBusy(true);
    try {
      const r = await api<{ key: string; created_at: string }>('POST', '/shortcut-key');
      setKey(r.key);
      setStatus({ exists: true, created_at: r.created_at });
    } catch (err) { showToast(errorMessage(err), 'error'); } finally { setBusy(false); }
  }

  async function revoke() {
    if (!confirm('Turn off the Shortcuts key? Your Shortcuts stop working until you make a new one.')) return;
    setBusy(true);
    try { await api('POST', '/shortcut-key/revoke'); setKey(''); setStatus({ exists: false, created_at: null }); showToast('Shortcuts key turned off', 'info'); }
    catch (err) { showToast(errorMessage(err), 'error'); } finally { setBusy(false); }
  }

  return (
    <div class="card">
      <h2>iPhone Shortcuts</h2>
      <p class="muted tiny">Log weight from Apple Health, quick-log food with Siri, get an evening reminder, or jump into your next workout. <a href={GUIDE} target="_blank" rel="noopener">Setup guide</a></p>
      {status == null ? <p class="muted">Loading…</p> : (
        <>
          <p class="tiny">{status.exists ? `Key active since ${new Date(status.created_at ?? '').toLocaleDateString()}.` : 'No key yet.'}</p>
          {key && (
            <div class="mt">
              <p class="warn tiny">Copy this key now — it's shown only once. Paste it into each Shortcut. Treat it like a password.</p>
              <div class="with-unit"><input readOnly value={key} aria-label="Shortcuts key" onFocus={(e) => e.currentTarget.select()} /><button class="btn small-btn" onClick={() => copy(key, 'Key')}>Copy</button></div>
            </div>
          )}
          <div class="btn-row mt">
            <button class="btn" disabled={busy} onClick={create}>{status.exists ? 'Make a new key' : 'Make a key'}</button>
            {status.exists && <button class="btn danger" disabled={busy} onClick={revoke}>Turn off</button>}
          </div>
          <details class="tiny mt">
            <summary>Addresses for the Shortcuts</summary>
            <p class="muted">Server: <code>{API_BASE}</code> <button class="btn link" onClick={() => copy(API_BASE, 'Address')}>Copy</button></p>
            <p class="muted">Start next workout: <code>{startUrl}</code> <button class="btn link" onClick={() => copy(startUrl, 'Link')}>Copy</button></p>
          </details>
        </>
      )}
    </div>
  );
}
