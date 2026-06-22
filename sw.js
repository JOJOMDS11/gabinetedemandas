// Service Worker para Gabinete 360 - PWA
// Versão: 1.1

const CACHE_NAME = 'gabinete-360-v2';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/nova-demanda.html',
  '/ver-demanda.html',
  '/manifest.json',
  'https://i.imgur.com/coryuD6.png'
];

// Instalar Service Worker
self.addEventListener('install', (event) => {
  console.log('🔧 Service Worker instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('📦 Cache criado');
        return cache.addAll(URLS_TO_CACHE.filter(url => !url.includes('supabase')));
      })
      .catch(err => console.log('❌ Erro ao cachear:', err))
  );
  self.skipWaiting();
});

// Ativar Service Worker
self.addEventListener('activate', (event) => {
  console.log('🚀 Service Worker ativado');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Removendo cache antigo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Interceptar requisições
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.hostname.includes('supabase')) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (!response || response.status !== 200) return response;
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, responseToCache));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  if (request.method === 'GET') {
    event.respondWith(
      caches.match(request)
        .then(response => response || fetch(request))
        .catch(() => new Response('Offline - recurso não disponível', { status: 503 }))
    );
    return;
  }

  event.respondWith(
    fetch(request).catch(() => new Response(
      JSON.stringify({ error: 'Offline - não é possível sincronizar agora' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    ))
  );
});

// Push Notification
self.addEventListener('push', function(event) {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: 'https://i.imgur.com/coryuD6.png',
      badge: 'https://i.imgur.com/coryuD6.png',
      vibrate: [200, 100, 500, 100, 200],
      requireInteraction: data.urgente || false,
      data: { url: data.url || 'https://jojomds11.github.io/gabinetedemandas/dashboard.html' }
    };
    event.waitUntil(self.registration.showNotification(data.title, options));
  }
});

// Clique na notificação — abre ou traz a aba do dashboard para frente
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : 'https://jojomds11.github.io/gabinetedemandas/dashboard.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url.includes('dashboard') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Sincronização em Background
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-demandas') {
    event.waitUntil(Promise.resolve());
  }
});

console.log('✅ Service Worker carregado');
