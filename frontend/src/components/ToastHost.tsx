import { useEffect, useState } from 'preact/hooks';
import { subscribeToast, type ToastMsg } from '../toast';

export function ToastHost() {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  useEffect(() => subscribeToast(setMsg), []);
  if (!msg) return null;
  return (
    <div class={`toast ${msg.kind} ${msg.text.startsWith('🏆') ? 'pr' : ''}`} role={msg.kind === 'error' ? 'alert' : 'status'} key={msg.id}>
      {msg.text}
    </div>
  );
}
