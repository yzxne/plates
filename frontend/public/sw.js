// Plates service worker — only for rest-timer notifications. No offline caching.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Pushes carry no data; every push means "your rest is over". iOS requires a visible notification for each push.
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
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
