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

// AQUI ESTÁ O SEGREDO DO CLIQUE:
self.addEventListener('notificationclick', function(event) {
  event.notification.close(); // Fecha a notificação no telemóvel
  
  // Pega o URL que passámos lá no dashboard
  const urlToOpen = event.notification.data.url;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      // Se já tiver uma aba aberta com esse URL, apenas foca nela
      for (let i = 0; i < windowClients.length; i++) {
        let client = windowClients[i];
        if (client.url.includes(urlToOpen) && 'focus' in client) {
          return client.focus();
        }
      }
      // Se não tiver, abre uma aba/janela nova diretamente na demanda
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
