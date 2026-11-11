import { useState } from 'preact/hooks';
import { errorMessage } from '../api';
import { disablePush, enablePush, isStandalone, pushOn, pushSupported, testPush } from '../push';
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
      <h2>Rest-timer notifications</h2>
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
    </div>
  );
}
