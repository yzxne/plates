import { useState } from 'preact/hooks';
import { api, ApiError, errorMessage, setToken } from '../api';

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: Event) {
    e.preventDefault();
    if (!passcode || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api<{ token: string }>('POST', '/auth/login', { passcode });
      setToken(res.token);
      setPasscode('');
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'wrong_passcode' ? 'Wrong passcode.' : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main class="login">
      <div class="logo" aria-hidden="true"><span /></div>
      <h1>Plates</h1>
      <form onSubmit={submit} class="card">
        <label for="passcode">Passcode</label>
        <input
          id="passcode"
          type="password"
          autocomplete="current-password"
          value={passcode}
          onInput={(e) => setPasscode(e.currentTarget.value)}
          autofocus
        />
        {error && <p class="error" role="alert">{error}</p>}
        <button class="btn primary" type="submit" disabled={busy || !passcode}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </main>
  );
}
