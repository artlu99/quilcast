// Shows mini app notifications pushed by the server (server/notify.mjs). Tapping one opens Quilcast at
// /apps?n=<id>, which opens the app at the page the notification points to.
self.addEventListener('push', (e) => {
  let d = {}
  try {
    d = e.data.json()
  } catch {}
  e.waitUntil(self.registration.showNotification(String(d.title || 'Quilcast'), { body: String(d.body || ''), icon: d.icon || '/apple-touch-icon.png', data: { url: String(d.url || '/apps') } }))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = new URL(e.notification.data?.url || '/apps', self.location.origin)
  // only our own pages
  if (url.origin !== self.location.origin) return
  e.waitUntil(self.clients.openWindow(url.href))
})
