self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Gabinete Daniel', {
      body: data.body || 'Nova notificação recebida.',
      icon: 'https://i.imgur.com/coryuD6.png',
      badge: 'https://i.imgur.com/coryuD6.png',
      vibrate: [200, 100, 500],
      data: { url: data.url || '/dashboard.html' } // Guarda o URL que veio do backend
    })
  );
});


self.addEventListener('notificationclick', function(event) {
  event.notification.close(); 
  
  
  const urlToOpen = event.notification.data.url;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      
      for (let i = 0; i < windowClients.length; i++) {
        let client = windowClients[i];
        if (client.url.includes(urlToOpen) && 'focus' in client) {
          return client.focus();
        }
      }
  
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
