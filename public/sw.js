/*
 * The studio's service worker (FB-141).
 *
 * ## It caches almost nothing, and that is the design
 *
 * A service worker that caches responses would be the single most dangerous file in this repository.
 * Every interesting page here is venture-scoped and session-scoped: `/venture/<id>` is one founder's
 * desk, decided server-side per request (CLAUDE.md #6). A cache sitting in front of that can serve
 * one founder's venture to the next person to open the app on a shared device, and can serve a
 * decision queue that was emptied an hour ago.
 *
 * So the rule is absolute and it is expressed as an allow-list, not a deny-list: only files that are
 * the same for everybody are ever cached. A deny-list would need updating every time a route is
 * added, and the failure mode of forgetting is a founder seeing another founder's work.
 *
 * ## Why it exists at all
 *
 * Installability. iOS will not add a site to the home screen as an app, and will not accept a push
 * subscription, without a registered service worker. Its only other job is to show the one push
 * (at the bottom of this file) — and it caches nothing for that either.
 */

const SHELL = 'foundry-shell-v1';

// Everything here is identical for every viewer, signed in or not. Nothing venture-scoped, nothing
// behind auth, nothing that names a person.
const SHELL_FILES = ['/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Same-origin GETs of the shell files, and nothing else. Every other request — every page, every
  // API call, every server action — goes to the network untouched, every time.
  const isShell = url.origin === self.location.origin
    && event.request.method === 'GET'
    && SHELL_FILES.includes(url.pathname);

  if (!isShell) return;

  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
});

/*
 * The one push (FB-141): "a push the moment the founder becomes the blocker. Nothing else pushes."
 *
 * The server decides when; this only shows what it was sent. The words come from `pushMessage` and
 * say which venture and how many, never what — a lock screen is read by whoever holds the phone.
 * The tag means a second buzz for the same venture replaces the first instead of stacking.
 *
 * Since FB-279 the server also sends the founder one message when their team's work is finished,
 * stuck or sent back (`cardMessage` in lib/founder-message.ts). Each card has its own tag, starting
 * `card-`, so a second card shows beside the first instead of silently replacing it. A new message
 * about the same card replaces the old one, and `renotify` makes the phone alert again for it.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* an unreadable push still says something */ }
  const title = typeof data.title === 'string' ? data.title : 'The studio needs you';
  const url = typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/';
  const tag = typeof data.tag === 'string' ? data.tag : 'blocker';
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === 'string' ? data.body : 'Something is waiting on your decision.',
    tag,
    renotify: tag.startsWith('card-'),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url },
  }));
});

// Pressing it opens the queue, filtered to what waits on this founder — not the desk. An open studio
// window is reused rather than a second one opened beside it.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin && 'navigate' in w) {
        // `navigate` refuses a window this worker does not control (one opened before it
        // installed). Then a new window is opened rather than the press doing nothing.
        try {
          await w.focus();
          const landed = await w.navigate(url);
          if (landed) return landed;
        } catch { /* fall through to a new window */ }
        break;
      }
    }
    return self.clients.openWindow(url);
  })());
});
