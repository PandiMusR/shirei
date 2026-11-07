import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';
import { shouldNotify } from './pushClient';
import { networkOnlyPattern } from './swUpdate';

declare let self: ServiceWorkerGlobalScope;

clientsClaim();

self.addEventListener('message', (event) => {
  const data = event.data as { type?: string } | null;
  if (data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(networkOnlyPattern, new NetworkOnly(), 'GET');

type PushBody = { title?: unknown; body?: unknown; url?: unknown; test?: unknown };

function readPush(event: PushEvent): { title: string; body: string; url: string; test: boolean } {
  const fallback = { title: 'Shirei', body: 'Task finished', url: '/', test: false };
  if (!event.data) return fallback;
  try {
    const value = event.data.json() as PushBody;
    if (typeof value.title !== 'string' || typeof value.body !== 'string' || typeof value.url !== 'string') return fallback;
    return { title: value.title, body: value.body, url: value.url, test: value.test === true };
  } catch {
    return fallback;
  }
}

function taskTag(url: string, test: boolean): string {
  if (test) return 'shirei-test';
  const path = new URL(url, self.registration.scope).pathname;
  const parts = path.split('/').filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? 'shirei';
}

self.addEventListener('push', (event) => {
  const payload = readPush(event);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const clients = windows.map((client) => ({ visibilityState: client.visibilityState, url: client.url }));
      if (!shouldNotify(clients, payload.url, payload.test)) return;
      await self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: '/pwa-192.png',
        tag: taskTag(payload.url, payload.test),
        data: { url: payload.url },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data as { url?: unknown } | null;
  const raw = data && typeof data.url === 'string' ? data.url : '/';
  const url = new URL(raw, self.registration.scope).href;
  const path = new URL(url).pathname;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => {
        try {
          return new URL(client.url).pathname === path;
        } catch {
          return false;
        }
      });
      if (open) {
        await open.focus();
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
