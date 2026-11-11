import { useEffect, useState } from 'preact/hooks';
import { defaultMeal, type Meal } from '../../shared/nutrition';
import { getToken, onUnauthorized } from './api';
import { TabBar, type TabId } from './components/TabBar';
import { ToastHost } from './components/ToastHost';
import { chicagoHour, today } from './dates';
import { queue } from './queue';
import { getActive, startWorkout, subscribeActive } from './activeWorkout';
import { formatDuration, type Exercise, type Routine, type Workout } from '../../shared/training';
import { cachedHistory, exerciseMap, loadExercises, loadHistory } from './trainData';
import { AddFlow } from './screens/AddFlow';
import { FoodLog } from './screens/FoodLog';
import { Logger } from './screens/Logger';
import { Train } from './screens/Train';
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
  const [adding, setAdding] = useState<{ meal: Meal } | null>(null);
  const [foodDate, setFoodDate] = useState(today());
  const [logVersion, setLogVersion] = useState(0);
  const [trainVersion, setTrainVersion] = useState(0);
  const [hasActive, setHasActive] = useState(!!getActive());
  const [logger, setLogger] = useState<{ exercises: Exercise[]; history: Workout[] } | null>(null);
  useEffect(() => subscribeActive(() => setHasActive(!!getActive())), []);

  async function openLogger() {
    try {
      const [exercises, history] = await Promise.all([loadExercises(), loadHistory()]);
      setLogger({ exercises, history });
    } catch {
      setLogger({ exercises: [...exerciseMap().values()], history: cachedHistory() });
    }
  }
  function start(routine?: Routine) {
    if (!getActive()) startWorkout(routine, (id) => exerciseMap().get(id)?.rest_sec ?? 90);
    void openLogger();
  }
  // "+" in the tab bar logs to the Food Log's day if you're on it, otherwise today.
  const addDate = tab === 'food' ? foodDate : today();

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
    <div class={`app ${hasActive && !logger ? 'has-active' : ''}`}>
      <main class="screen">
        {tab === 'dashboard' && <Placeholder title="Dashboard" phase={5} text="Your weekly nutrition, expenditure and weight trend will show here." />}
        {tab === 'food' && <FoodLog date={foodDate} onDate={setFoodDate} onAdd={(meal) => setAdding({ meal })} version={logVersion} />}
        {tab === 'train' && <Train onStart={start} version={trainVersion} />}
        {tab === 'more' && <More onLogout={() => setAuthed(false)} />}
      </main>
      {hasActive && !logger && <ActiveBar onOpen={openLogger} />}
      <TabBar current={tab} onSelect={setTab} onAdd={() => setAdding({ meal: defaultMeal(chicagoHour()) })} />
      {adding && (
        <AddFlow
          date={addDate}
          meal={adding.meal}
          onClose={() => setAdding(null)}
          onLogged={() => {
            setLogVersion((v) => v + 1);
            if (tab !== 'food') { setFoodDate(addDate); setTab('food'); }
          }}
        />
      )}
      {logger && (
        <Logger exercises={logger.exercises} history={logger.history}
          onMinimize={() => setLogger(null)}
          onDone={() => { setLogger(null); setTrainVersion((v) => v + 1); }} />
      )}
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
