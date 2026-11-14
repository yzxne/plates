import { useEffect, useState } from 'preact/hooks';
import { errorMessage } from '../api';
import { disablePush, enablePush, getWeighReminder, isStandalone, pushOn, pushSupported, setWeighReminder, testPush, type WeighReminder } from '../push';
import { showToast } from '../toast';

/** Settings card: rest-timer notifications (off by default). */
export function NotificationsCard() {
  const [on, setOn] = useState(pushOn());
  const [busy, setBusy] = useState(false);
  const usable = pushSupported() && isStandalone();

  async function toggle() {
    setBusy(true);
    try {
      if (on) { await disablePush(); setOn(false); showToast('Notifications off', 'info'); }
      else { await enablePush(); setOn(true); showToast('Notifications on', 'ok'); }
    } catch (err) {
      showToast(errorMessage(err), 'error', 8000);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    try {
      const r = await testPush();
      showToast(r.sent ? 'Test sent — lock your phone to see it' : 'No device is subscribed yet', r.sent ? 'ok' : 'error');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  }

  return (
    <div class="card">
      <h2>Notifications</h2>
      <p class="muted">
        A "Rest done" notification when your rest timer ends — uses your normal notification sound, works with the screen locked,
        shows on Apple Watch, and doesn't pause music. Off by default.
      </p>
      {!usable && (
        <p class="warn">Only works in the Home Screen app: Safari → Share → Add to Home Screen, then open Plates from its icon.</p>
      )}
      <div class="btn-row">
        <button class={`btn ${on ? '' : 'primary'}`} disabled={busy || !usable} onClick={toggle}>{on ? 'Turn off' : 'Turn on'}</button>
        {on && <button class="btn" onClick={test}>Send test</button>}
      </div>
      {on && <WeighReminderRow />}
    </div>
  );
}

const TIMES = Array.from({ length: 24 * 4 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);
const label = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h! % 12 || 12}:${String(m).padStart(2, '0')} ${h! < 12 ? 'AM' : 'PM'}`; };

const schedule = (r: WeighReminder) => {
  const [h, m] = r.time.split(':').map(Number);
  const times = Array.from({ length: r.count }, (_, k) => { const t = (h! * 60 + m! + k * r.gap) % 1440; return label(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`); });
  return `Reminds at ${times.join(', ')} until you weigh in.`;
};

/** Daily "Time to weigh in" push at a chosen time, skipped once you have weighed in that day. */
function WeighReminderRow() {
  const [r, setR] = useState<WeighReminder | null>(null);
  useEffect(() => { getWeighReminder().then(setR).catch((err) => showToast(errorMessage(err), 'error')); }, []);
  async function save(next: WeighReminder) {
    const before = r;
    setR(next);
    try { await setWeighReminder(next); showToast(next.on ? 'Weigh-in reminder saved' : 'Weigh-in reminder off', 'ok'); }
    catch (err) { setR(before); showToast(errorMessage(err), 'error'); }
  }
  if (!r) return null;
  return (
    <div class="remind-row">
      <label class="tick">
        <input type="checkbox" checked={r.on} onChange={(e) => void save({ ...r, on: e.currentTarget.checked })} />
        <span><strong>Weigh-in reminder</strong><small class="muted">Central time. Stops as soon as today's weigh-in is logged.</small></span>
      </label>
      {r.on && (
        <div class="remind-opts">
          <label>First at
            <select value={r.time} onChange={(e) => void save({ ...r, time: e.currentTarget.value })}>
              {TIMES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </select>
          </label>
          <label>Up to
            <select value={r.count} onChange={(e) => void save({ ...r, count: Number(e.currentTarget.value) })}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n === 1 ? 'once' : `${n} times`}</option>)}
            </select>
          </label>
          {r.count > 1 && (
            <label>Every
              <select value={r.gap} onChange={(e) => void save({ ...r, gap: Number(e.currentTarget.value) })}>
                {[30, 45, 60, 90].map((g) => <option key={g} value={g}>{g < 60 ? `${g} min` : g === 60 ? '1 hour' : '1½ hours'}</option>)}
              </select>
            </label>
          )}
          <small class="muted">{schedule(r)}</small>
        </div>
      )}
    </div>
  );
}
