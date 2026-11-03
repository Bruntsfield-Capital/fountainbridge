#!/usr/bin/env node
/**
 * Measure a studio screen over a venture's REAL data, signed in as its founder (FB-178).
 *
 * ## Why this exists
 *
 * CLAUDE.md #11 says the live side of every design comparison is production, signed in as the
 * venture's founder, "because fixtures are small and every fault this rule exists to catch only
 * appears at real size". For weeks that reading was recorded as blocked, on the belief that it
 * needed a signed-in session on the production server that nobody had.
 *
 * It does not. **Git is the source of truth for work items** — the studio is a view over the venture
 * repos' `docs/tickets/` through the GitHub API, with no separate database of record. So a local
 * build pointed at a real `GITHUB_TOKEN` reads exactly the data production reads. The only thing
 * production adds is its own hostname.
 *
 * The machine already had the token. `gh auth token` has had `repo` scope on `wealthcx01/arca` the
 * whole time. This script exists so that fact cannot be forgotten again.
 *
 * ## What it is not
 *
 * **Not a gate, and never run in CI.** It hits the live GitHub API, which the committed UI gate
 * deliberately never does — a gate that needs the network is a gate that fails when GitHub has a bad
 * morning. This is the manual instrument for the rule, run when a screen changes.
 *
 * It also does not decide anything. It records heights and takes pictures; a person still has to
 * look at them. Height is the cheapest proxy for "this screen shows more than it was meant to", not
 * a verdict.
 *
 * ## Running it
 *
 *     node scripts/measure-on-real-data.mjs                      # the desk, both viewports
 *     ROUTES=/venture/arca,/venture/arca/tickets node scripts/measure-on-real-data.mjs
 *     EMAIL=john.gallagher@wealthcx.com node scripts/measure-on-real-data.mjs
 *
 * It starts nothing. Build and start the studio yourself first, so the thing measured is a build you
 * chose:
 *
 *     export GITHUB_TOKEN="$(gh auth token)"
 *     export E2E_TEST_LOGIN=1 E2E_TEST_LOGIN_SECRET=pick-anything-local
 *     export AUTH_SECRET=pick-anything-local AUTH_TRUST_HOST=true
 *     export STUDIO_ADMIN_EMAILS=john.gallagher@wealthcx.com
 *     npm run build && npm run start -- --port 3200
 *
 * Both `E2E_TEST_LOGIN` variables are needed. With only the first, the provider is deliberately
 * inert and the hidden secret on the sign-in form renders empty — the sign-in then fails silently
 * and every screen you measure is the sign-in page. Which is why this script prints where it landed
 * beside every number.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL?.trim() || 'http://localhost:3200';
/** ARCA's founder. The rule's view: an admin sees extra banners a founder never does. */
const EMAIL = process.env.EMAIL?.trim() || 'matthew@bruntsfield.capital';
const ROUTES = (process.env.ROUTES?.trim() || '/venture/arca').split(',').map((r) => r.trim());
const OUT = process.env.OUT_DIR?.trim() || 'e2e/__screenshots__';

const SIZES = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'phone', width: 393, height: 851 },
];

const slug = (route) => route.replace(/^\/+|\/+$/g, '').replace(/\W+/g, '-') || 'home';

async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  const secret = await page.locator('input[name="secret"]').getAttribute('value').catch(() => null);
  if (!secret) {
    throw new Error(
      'the sign-in form carries no secret — start the server with BOTH E2E_TEST_LOGIN=1 and '
      + 'E2E_TEST_LOGIN_SECRET set, or every reading below would be of the sign-in page.',
    );
  }
  await page.getByTestId('e2e-email').fill(EMAIL);
  await page.getByTestId('e2e-submit').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const rows = [];

  for (const size of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height } });
    const page = await ctx.newPage();
    await signIn(page);

    for (const route of ROUTES) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => {});

      // Print where you landed, beside the number. FB-151 merged a conclusion drawn from timings
      // taken on a page that had redirected somewhere else entirely.
      const landed = new URL(page.url()).pathname;
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      // A screen that could not read its venture is SHORTER, and would read as a pass.
      const main = await page.locator('main').innerText().catch(() => '');
      const unread = /could not (be )?read|not known/i.test(main);

      const file = `${OUT}/real--${slug(route)}--${size.name}.png`;
      await page.screenshot({ path: file, fullPage: true });
      rows.push({ route, landed, size: size.name, height, sideways, unread, file });
    }
    await ctx.close();
  }
  await browser.close();

  for (const r of rows) {
    const flags = [
      r.landed !== r.route ? `LANDED ON ${r.landed} — this is not the screen you asked for` : null,
      r.sideways > 0 ? `SCROLLS SIDEWAYS by ${r.sideways}px` : null,
      r.unread ? 'SAYS SOMETHING COULD NOT BE READ — the height is of a degraded screen' : null,
    ].filter(Boolean);
    process.stdout.write(
      `${r.route} @ ${r.size}: ${r.height}px  ${flags.length ? `\n  ** ${flags.join('\n  ** ')}` : '·'} ${r.file}\n`,
    );
  }
  process.stdout.write('\nNow open the pictures. The numbers do not say whether the screens are right.\n');
}

main().catch((err) => {
  process.stderr.write(`measure-on-real-data: ${err.message}\n`);
  process.exit(1);
});
