import { test, expect } from '@playwright/test';
import { testLogin } from './helpers';

/**
 * FB-141 — the pocket studio, installable.
 *
 * A PWA cannot be fully proven in a headless browser: whether iOS actually adds it to a home screen
 * is a question only a phone answers. What CAN be proven here is everything the phone reads before
 * it decides — and the one rule that would be dangerous to get wrong.
 */
test.describe('the pocket studio installs (FB-141)', () => {
  test('the manifest says what an installed studio is', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);
    const m = await res.json();
    expect(m.name).toContain('Foundry');
    expect(m.display, 'fullscreen takes the status bar from a founder deciding something').toBe('standalone');
    // Not a venture. An icon is not a session, and isolation is decided per request (CLAUDE.md #6).
    expect(m.start_url).toBe('/');
    expect(m.start_url).not.toContain('/venture/');
    const purposes = m.icons.map((i: { purpose: string }) => i.purpose);
    expect(purposes, 'Android crops to a circle and will clip an unpadded mark').toContain('maskable');
  });

  test('the icons a phone asks for are actually there', async ({ request }) => {
    for (const path of ['/icon-192.png', '/icon-512.png', '/apple-touch-icon.png']) {
      const res = await request.get(path);
      expect(res.status(), `${path} is missing`).toBe(200);
      expect(res.headers()['content-type'], path).toContain('image/png');
    }
  });

  test('the service worker caches nothing that belongs to a founder', async ({ request }) => {
    // The most dangerous file in the repository if it got this wrong: every interesting page is
    // venture-scoped and session-scoped, and a cache in front of that can serve one founder's desk
    // to the next person to open the app on a shared device.
    const source = await (await request.get('/sw.js')).text();
    // Comments stripped first: the file EXPLAINS why it must not touch `/venture/`, and an assertion
    // that matched the prose would fail on the sentence promising the behaviour it is checking for.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code, 'the service worker names a venture route').not.toMatch(/\/venture\//);
    expect(code, 'the service worker names an API route').not.toMatch(/\/api\//);
    // An allow-list, not a deny-list — the failure mode of forgetting to deny a new route is a
    // founder seeing another founder's work.
    expect(code).toContain('SHELL_FILES.includes');
    for (const f of ['/icon-192.png', '/manifest.webmanifest']) expect(code).toContain(f);
  });

  test('a signed-in page still registers it', async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
    await page.goto('/venture/arca');
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  });
});
