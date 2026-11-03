import { test, expect } from '@playwright/test';
import { testLogin } from './helpers';

// FB-023: the Founder Handbook reading surface — private (FB-015), mirrors the /playbook pattern.
const SHOTS = 'e2e/__screenshots__';
const JOHN = 'john.gallagher@wealthcx.com';

test('handbook is private — a signed-out visitor is sent to login', async ({ page }) => {
  await page.goto('/handbook');
  await page.waitForURL((url) => url.pathname.startsWith('/login'));
  await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
});

test('a signed-out visitor cannot reach a chapter either', async ({ page }) => {
  await page.goto('/handbook/how-to-start');
  await page.waitForURL((url) => url.pathname.startsWith('/login'));
});

test('a signed-in user sees the index and can open a chapter', async ({ page }) => {
  await testLogin(page, JOHN);
  await page.goto('/handbook');
  await expect(page.getByTestId('handbook-index')).toBeVisible();
  await expect(page.getByTestId('hb-how-to-start')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/14-handbook-index.png`, fullPage: true });

  await page.getByTestId('hb-how-to-start').click();
  await page.waitForURL(/\/handbook\/how-to-start$/);
  await expect(page.getByTestId('handbook-chapter')).toBeVisible();
  await expect(page.getByText('Chapter 1', { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/14-handbook-chapter.png`, fullPage: true });
});

test('handbook is reachable from the studio nav', async ({ page }) => {
  await testLogin(page, JOHN);
  await page.goto('/');
  await page.getByRole('link', { name: 'Handbook', exact: true }).click();
  await page.waitForURL(/\/handbook$/);
  await expect(page.getByTestId('handbook-index')).toBeVisible();
});

/**
 * FB-134 — the handbook, in the venture shell.
 *
 * The venture route re-exported the global page, so every chapter link, the back link and the
 * prev/next pair pointed at `/handbook` — outside the rail. A founder opening chapter three from
 * their desk lost their desk to read it.
 */
test.describe('the handbook inside a venture (FB-134)', () => {
  test.beforeEach(async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
  });

  test('reading a chapter never leaves the venture', async ({ page }) => {
    await page.goto('/venture/arca/handbook');
    await page.getByTestId('hb-how-to-start').click();
    await expect(page).toHaveURL(/\/venture\/arca\/handbook\/how-to-start$/);
    // The rail is still there, which is the whole point.
    await expect(page.getByTestId('rail')).toHaveCount(1);

    await page.getByTestId('handbook-next').click();
    await expect(page).toHaveURL(/\/venture\/arca\/handbook\/how-to-build$/);
    await page.getByTestId('handbook-back').click();
    await expect(page).toHaveURL(/\/venture\/arca\/handbook$/);
  });

  test('every chapter says how long it takes, and none says zero', async ({ page }) => {
    await page.goto('/venture/arca/handbook');
    const minutes = page.locator('[data-testid$="-minutes"]');
    const n = await minutes.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      await expect(minutes.nth(i)).toHaveText(/^[1-9]\d* min read$/);
    }
  });

  test('the chapters are three across, and it is three by rule', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/venture/arca/handbook');

    // Three laid-out columns...
    const lefts = await page.locator('[data-testid="handbook-grid"] > a').evaluateAll((els) =>
      [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))]);
    expect(lefts).toHaveLength(3);

    // ...and three BY RULE, not by luck. The column beside the rail is ~766px, which an auto-filling
    // `minmax(15rem, 1fr)` also happens to divide into three — so the check above passes with the
    // rule replaced, and on its own it asserts nothing. The computed track count does.
    const tracks = await page.locator('[data-testid="handbook-grid"]').evaluate(
      (e) => getComputedStyle(e).gridTemplateColumns.split(/\s+/).filter(Boolean).length);
    expect(tracks, 'the grid is three by rule, at any width above 60rem').toBe(3);
  });

  test('the reader holds the reading measure, not the full column', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/venture/arca/handbook/how-to-start');
    const width = await page.locator('.playbook-prose').evaluate((e) => e.getBoundingClientRect().width);
    // 62ch of this face lands well under the 68rem content column; the point is that it is bounded
    // by the measure and not by the page.
    expect(width).toBeLessThan(700);
    expect(width).toBeGreaterThan(300);
  });

  test('a founder cannot read another venture’s shell by guessing the URL', async ({ page }) => {
    await page.goto('/venture/the-reset/handbook');
    await expect(page.getByTestId('handbook-index')).toHaveCount(0);
  });
});

/**
 * FB-188 — a chapter does not take the page sideways on a phone.
 *
 * FB-153 found that `.ticket-body` was a class name with no rule behind it, so a ticket citing a
 * long URL pushed the page sideways. It fixed that class. `.playbook-prose` was the identical case
 * next door and was not looked at, and chapter one carries an ASCII diagram 644px wide in a 393px
 * window. It shipped, and this scorecard recorded that "a chapter matches" — measured on a chapter
 * that has no diagram in it.
 *
 * Every chapter, not one: the fault was in the one nobody sampled.
 */
test.describe('a chapter fits the phone it is read on (FB-188)', () => {
  test('no chapter takes the page sideways', async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
    await page.setViewportSize({ width: 393, height: 851 });
    await page.goto('/venture/arca/handbook');
    const slugs = await page.$$eval('a[href*="/handbook/"]', (els) =>
      [...new Set(els.map((e) => e.getAttribute('href')).filter((h): h is string => Boolean(h)))]);
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) {
      await page.goto(slug);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${slug} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
    }
  });

  test('a wide diagram scrolls inside its own box rather than moving the page', async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
    await page.setViewportSize({ width: 393, height: 851 });
    await page.goto('/venture/arca/handbook/how-to-start');
    const pre = page.locator('pre').first();
    if (await pre.count()) {
      await expect(pre).toHaveCSS('overflow-x', 'auto');
      const fits = await pre.evaluate((e) => e.getBoundingClientRect().width <= document.documentElement.clientWidth);
      expect(fits, 'the block itself is wider than the window').toBe(true);
    }
  });
});
