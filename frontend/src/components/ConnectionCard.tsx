import { useEffect, useState } from 'preact/hooks';
import { api, ApiError, errorMessage } from '../api';
import { queue } from '../queue';
import { showToast } from '../toast';

export interface Status {
  backend: { missing_secrets: string[]; usda_key?: boolean };
  google: { connected: boolean; reconnect_needed: boolean };
  sheet: { set_up: boolean; ok?: boolean; title?: string; url?: string; error?: string; message?: string };
}

interface SetupResult {
  created: boolean;
  url: string;
  addedTabs: string[];
  addedColumns: string[];
  problems: string[];
}

export function ConnectionCard({ onStatus }: { onStatus?: (s: Status | null) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  async function load() {
    setLoadError('');
    try {
      const s = await api<Status>('GET', '/status');
      setStatus(s);
      onStatus?.(s);
    } catch (err) {
      setLoadError(errorMessage(err));
      onStatus?.(null);
    }
  }

  useEffect(() => { void load(); }, []);

  async function connect() {
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>('POST', '/oauth/google/start');
      window.location.href = url; // leaves the app; Google sends you back here
    } catch (err) {
      showToast(errorMessage(err), 'error');
      setBusy(false);
    }
  }

  async function setup(createNew = false) {
    setBusy(true);
    try {
      const r = await api<SetupResult>('POST', '/sheet/setup', createNew ? { create_new: true } : {});
      setProblems(r.problems);
      if (r.created) showToast('Plates spreadsheet created in your Google Drive', 'ok');
      else if (r.addedTabs.length || r.addedColumns.length) showToast('Spreadsheet updated with missing tabs/columns', 'ok');
      else showToast('Spreadsheet looks good', 'ok');
      await load();
      void queue.flush();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'sheet_missing') await load();
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function createReplacement() {
    if (!confirm('Create a brand-new, empty Plates spreadsheet? The app will use the new one from now on. (If the old one is only in Drive trash, restoring it is better.)')) return;
    await setup(true);
  }

  async function disconnect() {
    if (!confirm('Disconnect Google? Plates stops reading and saving until you reconnect. Your spreadsheet is not deleted.')) return;
    setBusy(true);
    try {
      await api('POST', '/oauth/google/disconnect');
      showToast('Google disconnected', 'info');
      await load();
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div class="card">
        <h2>Google connection</h2>
        <p class="error">{loadError}</p>
        <button class="btn" onClick={load}>Try again</button>
      </div>
    );
  }
  if (!status) return <div class="card"><h2>Google connection</h2><span class="skel skel-line" style={{ width: '55%' }} /><span class="skel skel-line" style={{ width: '80%' }} /></div>;

  const { backend, google, sheet } = status;
  return (
    <div class="card">
      <h2>Google connection</h2>

      {backend.missing_secrets.length > 0 && (
        <p class="warn">Backend setup incomplete — missing: {backend.missing_secrets.join(', ')}</p>
      )}
      {backend.usda_key === false && (
        <p class="warn">USDA key not set — food search uses USDA's shared demo key (30 searches/hour).</p>
      )}

      {!google.connected && (
        <>
          <p class="muted">
            {google.reconnect_needed ? 'Google access expired or was removed. Reconnect to keep saving.' : 'Not connected. Plates saves everything to a Google Sheet it creates.'}
          </p>
          <button class="btn primary" disabled={busy} onClick={connect}>
            {google.reconnect_needed ? 'Reconnect Google' : 'Connect Google'}
          </button>
        </>
      )}

      {google.connected && !sheet.set_up && (
        <>
          <p class="status-line"><span class="dot ok" /> Connected</p>
          <p class="muted">Next: create the Plates spreadsheet in your Drive.</p>
          <button class="btn primary" disabled={busy} onClick={() => setup()}>Create Plates spreadsheet</button>
        </>
      )}

      {google.connected && sheet.set_up && sheet.ok && (
        <>
          <p class="status-line"><span class="dot ok" /> Connected · {sheet.title}</p>
          <div class="btn-row">
            <a class="btn" href={sheet.url} target="_blank" rel="noopener noreferrer">Open sheet</a>
            <button class="btn" disabled={busy} onClick={() => setup()}>Check tabs</button>
          </div>
        </>
      )}

      {google.connected && sheet.set_up && sheet.ok === false && (
        <>
          <p class="status-line"><span class="dot bad" /> Spreadsheet problem</p>
          <p class="error">{sheet.message}</p>
          {sheet.error === 'sheet_not_found' ? (
            <button class="btn" disabled={busy} onClick={createReplacement}>Create a new spreadsheet</button>
          ) : (
            <button class="btn" disabled={busy} onClick={load}>Try again</button>
          )}
        </>
      )}

      {problems.length > 0 && (
        <ul class="warn-list">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}

      {google.connected && (
        <button class="btn link danger" disabled={busy} onClick={disconnect}>Disconnect Google</button>
      )}
    </div>
  );
}
