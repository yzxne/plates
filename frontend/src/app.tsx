import { useEffect, useState } from 'preact/hooks';
import type { Meal } from '../../shared/nutrition';
import { formatDuration, previousSets, type Exercise, type Routine, type Workout } from '../../shared/training';
import { getActive, startWorkout, subscribeActive } from './activeWorkout';
import { ApiError, getToken, onUnauthorized } from './api';
import { TabBar, type TabId } from './components/TabBar';
import { ToastHost } from './components/ToastHost';
import { UndoHost } from './components/UndoHost';
import { today } from './dates';
import { queue } from './queue';
import { AddFlow } from './screens/AddFlow';
import { Logger } from './screens/Logger';
import { Login } from './screens/Login';
import { More } from './screens/More';
import { Progress, type ProgressSection } from './screens/Progress';
import { SetupWizard } from './screens/SetupWizard';
import { Today } from './screens/Today';
import { NextWorkoutCard, Train } from './screens/Train';
import { loadSettings, mealNow } from './settingsStore';
import { ensureCheckIn } from './coachData';
import { showToast } from './toast';
import { cachedHistory, exerciseMap, loadExercises, loadHistory } from './trainData';

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

type Setup = 'checking' | 'needs-connection' | 'needs-setup' | 'done';

export function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [tab, setTab] = useState<TabId>('today');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [progressFocus, setProgressFocus] = useState<ProgressSection>(null);
  const [setup, setSetup] = useState<Setup>('checking');
  const [adding, setAdding] = useState<{ meal: Meal } | null>(null);
  const [foodDate, setFoodDate] = useState(today());
  const [logVersion, setLogVersion] = useState(0);
  const [trainVersion, setTrainVersion] = useState(0);
  const [hasActive, setHasActive] = useState(!!getActive());
  const [logger, setLogger] = useState<{ exercises: Exercise[]; history: Workout[] } | null>(null);
  useEffect(() => subscribeActive(() => setHasActive(!!getActive())), []);

  useEffect(() => {
    onUnauthorized(() => setAuthed(false));
    takeGoogleResult();
  }, []);

  // Load settings after login; decide whether the first-run wizard is needed.
  useEffect(() => {
    if (!authed) return;
    setSetup('checking');
    loadSettings(true)
      .then((v) => setSetup(v.setup_complete === 'true' ? 'done' : 'needs-setup'))
      .catch((err) => {
        const c = err instanceof ApiError ? err.code : '';
        setSetup(['sheet_not_set_up', 'google_not_connected', 'google_reconnect'].includes(c) ? 'needs-connection' : 'done');
      });
  }, [authed]);

  // Weekly check-in: automatic, no action needed (brief v2). Runs on open and when the app comes back to the front.
  useEffect(() => {
    if (!authed || setup !== 'done') return;
    const run = () => {
      void ensureCheckIn().then((r) => {
        if (r.ran) {
          showToast(`Check-in done · new targets average ${r.avg.toLocaleString('en-US')} kcal/day`, 'ok', 6000);
          setLogVersion((v) => v + 1);
        }
      }).catch(() => {});
    };
    run();
    const onVisible = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [authed, setup]);

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

  async function openLogger() {
    try {
      const [exercises, history] = await Promise.all([loadExercises(), loadHistory()]);
      setLogger({ exercises, history });
    } catch {
      setLogger({ exercises: [...exerciseMap().values()], history: cachedHistory() });
    }
  }
  async function start(routine?: Routine) {
    if (!getActive()) {
      let history: Workout[] = cachedHistory();
      try { await loadExercises(); history = await loadHistory(); } catch { /* start anyway */ }
      startWorkout(routine, (id) => exerciseMap().get(id)?.rest_sec ?? 90, (id) => previousSets(id, history));
    }
    void openLogger();
  }

  if (!authed) {
    return (
      <>
        <Login onSuccess={() => setAuthed(true)} />
        <ToastHost />
      </>
    );
  }

  // Logging on Today keeps the day you're looking at; elsewhere it's today. The meal comes from the time windows.
  const addDate = tab === 'today' ? foodDate : today();

  return (
    <div class={`app ${hasActive && !logger ? 'has-active' : ''}`}>
      <main class="screen">
        {tab === 'today' && (
          <Today date={foodDate} onDate={setFoodDate} onAdd={(meal) => setAdding({ meal })} onSettings={() => setSettingsOpen(true)} version={logVersion}
            onOpenProgress={(sec) => { setProgressFocus(sec); setTab('progress'); }}
            nextWorkout={foodDate === today() ? <NextWorkoutCard onStart={(r) => void start(r)} version={trainVersion} /> : null} />
        )}
        {tab === 'progress' && <Progress focus={progressFocus} />}
        {tab === 'train' && <Train onStart={start} version={trainVersion} />}
      </main>
      {hasActive && !logger && <ActiveBar onOpen={openLogger} />}
      <TabBar current={tab} onSelect={(t) => { setProgressFocus(null); setTab(t); }} onAdd={() => setAdding({ meal: mealNow() })} />
      {adding && (
        <AddFlow
          date={addDate}
          meal={adding.meal}
          onClose={() => setAdding(null)}
          onLogged={() => {
            setLogVersion((v) => v + 1);
            if (tab !== 'today') { setFoodDate(addDate); setTab('today'); }
          }}
        />
      )}
      {logger && (
        <Logger exercises={logger.exercises} history={logger.history}
          onMinimize={() => setLogger(null)}
          onDone={() => { setLogger(null); setTrainVersion((v) => v + 1); }} />
      )}
      {settingsOpen && <More onLogout={() => { setSettingsOpen(false); setAuthed(false); }} onClose={() => { setSettingsOpen(false); setLogVersion((v) => v + 1); }} />}
      {(setup === 'needs-setup' || setup === 'needs-connection') && (
        <SetupWizard needsConnection={setup === 'needs-connection'} onDone={() => { setSetup('done'); setLogVersion((v) => v + 1); }} />
      )}
      <UndoHost />
      <ToastHost />
    </div>
  );
}

function ActiveBar({ onOpen }: { onOpen: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const w = getActive()?.workout;
  if (!w) return null;
  const sec = Math.max(0, Math.round((now - Date.parse(w.start_time)) / 1000));
  return (
    <button class="active-bar" onClick={onOpen}>
      <span><strong>{w.name}</strong> in progress</span>
      <span>{formatDuration(sec)} · Resume</span>
    </button>
  );
}
