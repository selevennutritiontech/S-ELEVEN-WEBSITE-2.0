/* Alerts for the S-ELEVEN console: shows notifications through the service worker (required on Android) and relays "Task completed" back to the page. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('notificationclick', function (e) {
  var d = e.notification.data || {}; e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) { var c = cs[0]; if (e.action === 'done' && c) c.postMessage({ type: 'alert-done', key: d.key }); if (c) return c.focus(); return self.clients.openWindow('./admin/'); }));
});
