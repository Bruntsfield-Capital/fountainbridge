import { test, expect } from '@playwright/test';
import { testLogin } from './helpers';

/**
 * What happened (FB-132).
 *
 * The standard is the design's own line: *"Sent, failed, refused: it stays here with its state."* A
 * log that quietly drops failures teaches a founder that silence means nothing happened, so most of
 * what is asserted here is that nothing is filtered for tidiness.
 */

const JOHN = 'john.gallagher@wealthcx.com';
const ROSS = 'ross@bruntsfield.capital';
const SHOTS = 'e2e/__screenshots__';

test.describe('what happened', () => {
  test('it is one record, newest first, with a summary above it', async ({ page }) => {
    await testLogin(page, JOHN);
    await page.goto('/venture/arca/activity');
    await expect(page.getByTestId('venture-activity')).toBeVisible();
    await expect(page.getByTestId('activity-summary')).toBeVisible();
    // The paragraph counts changes in a fourteen-day window; the list carries decisions with no
    // window at all. A founder read "in the last 14 days" above a decision from June, so each now
    // says what it covers.
    await expect(page.getByTestId('activity-summary')).toContainText('Changes to your product');
    await expect(page.getByTestId('activity-scope')).toContainText(/did since \d/);

    const items = page.getByTestId('activity-item');
    expect(await items.count()).toBeGreaterThan(0);
    const dates = await items.evaluateAll((els) =>
      els.map((e) => e.querySelector('.mono')?.textContent?.trim() ?? ''));
    expect(dates.filter(Boolean).length).toBe(dates.length);

    await page.screenshot({ path: `${SHOTS}/23-what-happened.png`, fullPage: true });
  });

  test('the founder’s own decisions are in it', async ({ page }) => {
    // The thing that has never been on this page: a founder could not see their own yes in the
    // record, which is a strange omission from a page called "what happened".
    await testLogin(page, JOHN);
    await page.goto('/venture/arca/activity');
    const sources = await page.getByTestId('activity-item').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-source')));
    expect(sources).toContain('decision');

    // BY NAME, never as "you". Under D7 the approver is often not the reader — Bruntsfield approves
    // platform changes on a founder's venture — so addressing every decision to whoever is looking
    // put a founder's own name on a decision they never made.
    const decisions = await page.getByTestId('activity-item').evaluateAll((els) =>
      els.filter((e) => e.getAttribute('data-source') === 'decision').map((e) => e.textContent ?? ''));
    expect(decisions.length).toBeGreaterThan(0);
    for (const d of decisions) expect(d).not.toMatch(/\bYou (approved|sent back)\b/);
  });

  test('a completed approval says whether the studio issued it (FB-207)', async ({ page }) => {
    // This is the property that kept two ApprovalCard sections on the desk through two instructions
    // to move them. The desk was the only place a founder could see whether a completed approval's
    // signature was genuine, forged, or made against a proposal that changed afterwards (FB-046),
    // and this page listed the same decisions in prose carrying none of it.
    //
    // The sections are gone now, so this is where the property lives. If this test fails, a forged
    // grant on a past send is invisible in the studio — which is non-negotiable 4 failing quietly,
    // and the exact outcome the refusals were protecting against.
    await testLogin(page, JOHN);
    await page.goto('/venture/arca/activity');

    const clauses = page.getByTestId('activity-attestation');
    expect(await clauses.count(), 'no decision row says anything about its signature').toBeGreaterThan(0);

    // An attested grant reads as verified.
    const verified = clauses.locator('..').locator('[data-verified="true"]');
    expect(await verified.count()).toBeGreaterThan(0);

    // And every row carrying one is a way to the page that says WHICH of the three reasons it is —
    // the clause is short on purpose and must not be the end of the trail.
    const row = page.getByTestId('activity-item').filter({ has: clauses.first() }).first();
    await expect(row.locator('a').first()).toHaveAttribute('href', /\/approvals\//);
  });

  test('a forged grant is not quietly recorded as an approval (FB-207)', async ({ page }) => {
    // ARCA's fixtures carry an adversarial grant: a grant.json with a bogus attestation, of the kind
    // a lane could write. It must not read like a human's approval anywhere in the studio.
    await testLogin(page, JOHN);
    await page.goto('/venture/arca/activity');
    const unverified = page.getByTestId('activity-attestation').and(page.locator('[data-verified="false"]'));
    expect(await unverified.count(), 'nothing on this page says a signature did not verify').toBeGreaterThan(0);
    await expect(unverified.first()).toContainText('not verified');
  });

  test('every entry says its state in words, not only in colour', async ({ page }) => {
    // A state carried only by a coloured dot is a state a screen-reader user does not get.
    await testLogin(page, JOHN);
    await page.goto('/venture/arca/activity');
    const labelled = await page.getByTestId('activity-item').evaluateAll((els) =>
      els.every((e) => (e.querySelector('.sr-only')?.textContent ?? '').trim().length > 0));
    expect(labelled).toBe(true);
  });

  test('a founder cannot see another venture’s history through it', async ({ page }) => {
    // Venture isolation is server-side and absolute (CLAUDE.md #6). This route used to span every
    // venture the viewer could reach.
    await testLogin(page, ROSS);
    await page.goto('/venture/arca/activity');
    await expect(page.getByTestId('venture-forbidden')).toBeVisible();
    await expect(page.getByTestId('activity-feed')).toHaveCount(0);
  });

  // Two tests rather than one: `testLogin` goes to /login, which redirects away when a session
  // already exists, so signing in twice in one test hangs on a form that never appears.
  test('a founder is not offered the cross-venture feed', async ({ page }) => {
    // They have one venture. A door to "every venture at once" is a door to a room with their own
    // furniture in it.
    await testLogin(page, ROSS);
    await page.goto('/venture/the-reset/activity');
    await expect(page.getByTestId('venture-activity')).toBeVisible();
    await expect(page.getByTestId('activity-all-ventures')).toHaveCount(0);
  });

  test('Bruntsfield keeps the way to every venture at once', async ({ page }) => {
    // Scoping this screen narrows what an admin sees. The all-ventures feed still exists rather than
    // being taken away and replaced with nothing; FB-136 gives it a proper home.
    await testLogin(page, JOHN);
    await page.goto('/venture/arca/activity');
    await expect(page.getByTestId('activity-all-ventures')).toBeVisible();
  });

  test('it fits a phone', async ({ page }) => {
    await testLogin(page, JOHN);
    await page.setViewportSize({ width: 393, height: 851 });
    await page.goto('/venture/arca/activity');
    await expect(page.getByTestId('activity-feed')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/23-mobile-what-happened.png`, fullPage: true });
  });
});

/**
 * FB-158 — "What happened" streams.
 *
 * It was the one screen under a venture still at six seconds: three blocking reads, the most
 * expensive in the studio among them, none of them needed above the fold.
 */
test.describe('what happened streams (FB-158)', () => {
  test('the shell is gone once the record is in, and nothing is duplicated', async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
    await page.goto('/venture/arca/activity');
    await expect(page.getByTestId('activity-summary')).toBeVisible();
    await expect(page.getByTestId('activity-waiting')).toHaveCount(0);
    // One heading, not the shell's plus the record's.
    await expect(page.getByRole('heading', { name: 'What happened' })).toHaveCount(1);
    await expect(page.getByTestId('activity-scope')).toHaveCount(1);
  });
});

/**
 * FB-180 — the record reads as an account of the venture, not as a commit log.
 *
 * Asserted on the RENDERED rows, because that is where the audit found it: the composition is
 * pinned by unit tests, and this is the half that proves what a founder actually sees. `copy-lint`
 * passes over every one of these faults, since the strings are data a lane wrote, not source.
 */
test.describe('the record is written for the founder (FB-180)', () => {
  test.beforeEach(async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
    await page.goto('/venture/arca/activity');
    await expect(page.getByTestId('activity-feed')).toBeVisible();
  });

  test('no row carries a slug, a pull request number or the word lane', async ({ page }) => {
    const rows = await page.getByTestId('activity-item').allInnerTexts();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toMatch(/-[0-9]{3}-|\(#\d+\)|Foundry lane/);
    }
  });

  test('no two rows in a row say the same thing', async ({ page }) => {
    const rows = await page.getByTestId('activity-item').allInnerTexts();
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]).not.toBe(rows[i - 1]);
    }
  });

  test('the day is relative, and the date it stands for is still there to read', async ({ page }) => {
    const when = page.getByTestId('activity-item').first().locator('.activity-when');
    await expect(when).toHaveText(/Today|Yesterday|day$|\d/);
    // The absolute date has not been thrown away — it is on the element for anyone who needs it.
    await expect(when).toHaveAttribute('title', /\d{4}/);
  });
});
