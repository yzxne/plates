// Settings → AI coach: copy a summary of the last 4 weeks (and the coach instructions) to paste into the Claude app.
// The coach itself is a chat in a "Plates Coach" project in the Claude app. Setup: docs/coach-prompt.md.
import { useState } from 'preact/hooks';
import { COACH_INSTRUCTIONS } from '../../../shared/coachPrompt';
import { errorMessage } from '../api';
import { makeCoachSummary } from '../coachSummaryData';
import { showToast } from '../toast';

const GUIDE = 'https://github.com/yzxne/plates/blob/main/docs/coach-prompt.md';

/**
 * Copies text that is still being built. iPhone Safari only allows clipboard writes during the tap itself,
 * so a ClipboardItem holding a promise is used where available; otherwise the text is built first, then copied.
 */
async function copyLater(make: () => Promise<string>): Promise<string> {
  const pending = make();
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': pending.then((t) => new Blob([t], { type: 'text/plain' })) })]);
      return pending;
    } catch { /* fall through */ }
  }
  const text = await pending;
  await navigator.clipboard.writeText(text);
  return text;
}

export function CoachCard() {
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState(''); // shown when the clipboard refuses, to copy by hand

  async function copySummary() {
    setBusy(true);
    setFallback('');
    let built = '';
    try {
      built = await copyLater(async () => (built = await makeCoachSummary()));
      showToast(`Summary copied (${Math.round(built.length / 1000)}k characters). Paste it into Plates Coach in the Claude app.`, 'ok');
    } catch (err) {
      if (built) { setFallback(built); showToast('Copy blocked — press and hold the box below to copy', 'error'); }
      else showToast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function copyInstructions() {
    try { await navigator.clipboard.writeText(COACH_INSTRUCTIONS); showToast('Instructions copied', 'ok'); }
    catch { setFallback(COACH_INSTRUCTIONS); showToast('Copy blocked — press and hold the box below to copy', 'error'); }
  }

  return (
    <div class="card">
      <h2>AI coach</h2>
      <p class="muted tiny">Your coach is a chat in the Claude app. Copy a summary of your last 4 weeks (food, weight, check-ins, lifts, notes, alcohol, sleep, water), paste it into your <b>Plates Coach</b> project, and ask anything. Only the summary leaves your Sheet.</p>
      <div class="btn-row mt">
        <button class="btn primary" disabled={busy} onClick={copySummary}>{busy ? 'Building…' : 'Copy summary'}</button>
      </div>
      {fallback && (
        <textarea class="mt" readOnly rows={6} value={fallback} aria-label="Text to copy" onFocus={(e) => e.currentTarget.select()} />
      )}
      <details class="tiny mt">
        <summary>First time: set up the project</summary>
        <ol class="muted">
          <li>Tap <b>Copy instructions</b> below.</li>
          <li>Claude app → Projects → New project → name it <b>Plates Coach</b>.</li>
          <li>Open the project's instructions, paste, save.</li>
          <li>Then each time: Copy summary → new chat in Plates Coach → paste → ask ("Weekly review", "Why isn't my weight moving?").</li>
        </ol>
        <div class="btn-row">
          <button class="btn" onClick={copyInstructions}>Copy instructions</button>
          <a class="btn link" href={GUIDE} target="_blank" rel="noopener">Full guide</a>
        </div>
      </details>
    </div>
  );
}
