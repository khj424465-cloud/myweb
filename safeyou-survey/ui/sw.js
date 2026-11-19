self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate' && new URL(event.request.url).origin === self.location.origin) {
    event.respondWith(fetch(event.request).catch(() => new Response('인터넷에 연결한 뒤 다시 시도해 주세요.', {
      status: 503, headers: {'Content-Type':'text/plain; charset=utf-8'}
    })));
  }
});
