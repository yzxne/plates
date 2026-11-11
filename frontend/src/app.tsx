import { useEffect, useState } from 'preact/hooks';
import { getToken, onUnauthorized } from './api';
import { AddSheet } from './components/AddSheet';
import { TabBar, type TabId } from './components/TabBar';
import { ToastHost } from './components/ToastHost';
import { queue } from './queue';
import { Login } from './screens/Login';
import { More } from './screens/More';
import { Placeholder } from './screens/Placeholder';
import { showToast } from './toast';

const GOOGLE_ERRORS: Record<string, string> = {
  denied: 'Google sign-in was cancelled.',
  expired: 'That sign-in link expired. Try connecting again.',
  google_scope_missing: 'Plates needs the "files it creates" permission. Connect again and keep that box ticked.',
  google_no_refresh: 'Google did not give long-term access. Remove Plates in your Google Account → Security → Third-party access, then connect again.',
};

/** Reads ?google=... after the OAuth redirect, then removes it from the address bar. */
function takeGoogleResult(): 'connected' | 'error' | null {
  const params = new URLSearchParams(window.location.search);
  const result = params.get('google');
  if (!result) return null;
  const reason = params.get('reason') ?? '';
  history.replaceState(null, '', window.location.pathname);
  if (result === 'connected') {
    showToast('Google connected', 'ok');
    return 'connected';
  }
  showToast(GOOGLE_ERRORS[reason] ?? `Google connection failed (${reason || 'unknown'}).`, 'error', 7000);
  return 'error';
}

export function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [tab, setTab] = useState<TabId>('dashboard');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    onUnauthorized(() => setAuthed(false));
    if (takeGoogleResult()) setTab('more');
  }, []);

  // Retry unsaved writes when the app opens, comes back to the foreground, or the network returns.
  useEffect(() => {
    if (!authed) return;
    const flush = () => { if (queue.list().length) void queue.flush(); };
    const onVisible = () => { if (document.visibilityState === 'visible') flush(); };
    flush();
    window.addEventListener('online', flush);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', flush);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [authed]);

  if (!authed) {
    return (
      <>
        <Login onSuccess={() => setAuthed(true)} />
        <ToastHost />
      </>
    );
  }

  return (
    <div class="app">
      <main class="screen">
        {tab === 'dashboard' && <Placeholder title="Dashboard" phase={5} text="Your weekly nutrition, expenditure and weight trend will show here." />}
        {tab === 'food' && <Placeholder title="Food Log" phase={2} text="Log meals by day, grouped into breakfast, lunch, dinner and snacks." />}
        {tab === 'train' && <Placeholder title="Train" phase={4} text="Routines, live workout logging and history." />}
        {tab === 'more' && <More onLogout={() => setAuthed(false)} />}
      </main>
      <TabBar current={tab} onSelect={setTab} onAdd={() => setAdding(true)} />
      {adding && <AddSheet onClose={() => setAdding(false)} />}
      <ToastHost />
    </div>
  );
}
