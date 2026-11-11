// Rest-timer notifications via Web Push. Works only in the Home Screen app on iPhone (iOS 16.4+).
import { api } from './api';
import { safeStore } from './storage';

const FLAG = 'plates.push.on';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export const pushOn = () => pushSupported() && safeStore.getItem(FLAG) === '1' && Notification.permission === 'granted';

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const s = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
  await navigator.serviceWorker.ready;
  return reg;
}

/** Must be called from a tap (iOS rule). */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error('Notifications need the Home Screen app (Share → Add to Home Screen), then open Plates from its icon.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications were not allowed. You can allow them in iPhone Settings → Notifications → Plates.');
  const reg = await registration();
  const { key } = await api<{ key: string }>('GET', '/push/key');
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  await api('POST', '/push/subscribe', { endpoint: sub.endpoint });
  safeStore.setItem(FLAG, '1');
}

export async function disablePush(): Promise<void> {
  safeStore.removeItem(FLAG);
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration('./');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api('POST', '/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}

export async function testPush(): Promise<{ sent: number }> {
  return api<{ sent: number }>('POST', '/push/test');
}

/** Schedules the "Rest done" notification. Fire-and-forget: the in-app timer still works if this fails. */
export function scheduleRestPush(seconds: number): void {
  if (!pushOn() || seconds <= 0) return;
  void api('POST', '/push/rest', { seconds: Math.round(seconds) }).catch(() => {});
}

export function cancelRestPush(): void {
  if (!pushOn()) return;
  void api('POST', '/push/rest/cancel').catch(() => {});
}
