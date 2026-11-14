// Plates service worker — only for notifications (rest timer, weigh-in reminder). No offline caching.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Pushes carry no data. The phone asks the API which notification it was for ("rest" or "weigh");
// if that fails it falls back to "Rest done". iOS requires a visible notification for each push.
const API = new URL(self.location.href).searchParams.get('api');

async function pushKind() {
  if (!API) return 'rest';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(API + '/push/last', { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    const { kind } = await r.json();
    return kind === 'weigh' ? 'weigh' : 'rest';
  } catch {
    return 'rest';
  }
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    if ((await pushKind()) === 'weigh') {
      await self.registration.showNotification('Time to weigh in', {
        body: 'Before you eat or drink. Tap to log it.',
        tag: 'plates-weigh',
        icon: 'icons/icon-192.png',
      });
      return;
    }
    // Never silent, even with the app open: the in-app beep is muted by the silent switch and iPhone Safari
    // can't vibrate, so the notification is the only thing that buzzes on a silenced phone.
    await self.registration.showNotification('Rest done', {
      body: 'Time for your next set.',
      tag: 'plates-rest',
      renotify: true,
      silent: false,
      icon: 'icons/icon-192.png',
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows[0]) return windows[0].focus();
    return self.clients.openWindow('./');
  })());
});
