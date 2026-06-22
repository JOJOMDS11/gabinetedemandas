// Service Worker para Gabinete 360 - PWA
// Versão: 1.0
// Permite funcionar offline e instalar como app

const CACHE_NAME = 'gabinete-360-v1';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/nova-demanda.html',
  '/ver-demanda.html',
  '/manifest.json',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
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

// Interceptar requisições - Network First para dados, Cache First para assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Se é uma requisição ao Supabase, sempre tenta rede
  if (url.hostname.includes('supabase')) {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match(request))
    );
    return;
  }

  // Para APIs externas, tenta rede primeiro
  if (request.method === 'GET' && url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (!response || response.status !== 200) {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then(cache => cache.put(request, responseToCache));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Para assets (CSS, JS, imagens), usa cache primeiro
  if (request.method === 'GET') {
    event.respondWith(
      caches.match(request)
        .then(response => response || fetch(request))
        .catch(() => new Response('Offline - recurso não disponível', { status: 503 }))
    );
    return;
  }

  // Para POST/PUT/DELETE, sempre tenta rede
  event.respondWith(
    fetch(request)
      .catch(() => new Response(
        JSON.stringify({ error: 'Offline - não é possível sincronizar agora' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      ))
  );
});

self.addEventListener('push', function(event) {
    if (event.data) {
        const data = event.data.json();
        const options = {
            body: data.body,
            icon: 'https://i.imgur.com/coryuD6.png',
            badge: 'https://i.imgur.com/coryuD6.png',
            vibrate: [200, 100, 500, 100, 200],
            requireInteraction: data.urgente || false,
            data: { url: 'https://jojomds11.github.io/dashboard.html' }
        };
        event.waitUntil(self.registration.showNotification(data.title, options));
    }
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(clients.openWindow(event.notification.data.url));
});
  // Abre ou traz para frente a aba
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/dashboard.html');
      }
    })
  );
});

// Sincronização em Background (quando voltar online)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-demandas') {
    event.waitUntil(
      // Aqui você pode sincronizar dados pendentes
      Promise.resolve()
    );
  }
});

console.log('✅ Service Worker carregado');
