import { test, expect, type Page } from '@playwright/test';
import { testLogin } from './helpers';
import { putReviewCards } from './review-cards';

/**
 * Journey 3 of `harness/END-TO-END.md` (FB-277), and journey 6's "in their lists".
 *
 * The stand-in sends four cards through the box's door (`e2e/review-cards.ts`): ARCA finished
 * (`arca/20`, and a second, `arca/21`), ARCA stuck (`arca/22`), THE RESET finished
 * (`thereset-platform/5`) and cowgate done (`cowgate/40`, the factory's own work). ARCA's founder
 * opens their desk, "Needs you" and "What happened": ARCA's cards are there, in plain English, and
 * nothing of John's. John sees all four, with what each cost.
 *
 * Run it against a test copy the way the factory will:
 *
 *   node scripts/test-copy.mjs start --port 3100
 *   E2E_BASE_URL=http://127.0.0.1:3100 npx playwright test e2e/factory-cards.spec.ts
 */

const FOUNDER_A = 'matthew@bruntsfield.capital';
const JOHN = 'john.gallagher@wealthcx.com';

const ARCA_FINISHED = 'The auctions view';
const ARCA_STUCK = 'Graded card photos on every listing';
const RESET_FINISHED = 'The first check-in screen';
const COWGATE_DONE = "The listener's second inbox";

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }, info) => {
  await putReviewCards(browser, String(info.project.use.baseURL));
});

/**
 * "No dollar figure, no "What to do next" line, no "Tell the lane" and no link to Archon": in what
 * the page shows, and in everything the server sent, which is where a hidden one would be.
 */
async function noJohnsParts(page: Page, where: string) {
  const shown = await page.locator('body').innerText();
  expect(shown, `${where} shows a dollar figure`).not.toMatch(/\$\s?\d/);
  expect(shown, `${where} shows "What to do next"`).not.toMatch(/what to do next/i);
  expect(shown, `${where} shows "Tell the lane"`).not.toMatch(/tell the lane/i);
  expect(shown, `${where} names Archon`).not.toMatch(/archon/i);
  const sent = await page.content();
  for (const part of ['$3.40', '$2.10', '$6.80', '$1.20', '$4.10', 'What to do next', 'Tell the lane', 'archon.example']) {
    expect(sent, `${where} was sent ${part}`).not.toContain(part);
  }
  await expect(page.locator('a[href*="archon" i]'), `${where} links to Archon`).toHaveCount(0);
}

/** Nothing of THE RESET's and nothing of the factory's own: journey 6, "in their lists". */
async function noOneElses(page: Page, where: string) {
  const shown = await page.locator('body').innerText();
  for (const other of [RESET_FINISHED, 'RESET-012', COWGATE_DONE, 'CG-0066', 'cowgate']) {
    expect(shown, `${where} shows ${other}`).not.toContain(other);
  }
  const sent = await page.content();
  for (const other of [RESET_FINISHED, COWGATE_DONE, 'CG-0066']) expect(sent, `${where} was sent ${other}`).not.toContain(other);
}

test.describe('3. A founder sees factory work where they already look', () => {
  test.beforeEach(async ({ page }) => testLogin(page, FOUNDER_A));

  test("the desk: ARCA's finished card waits on them, its stuck one is on the stuck line", async ({ page }) => {
    await page.goto('/venture/arca');
    const row = page.getByTestId('waiting-card-arca-20');
    await expect(row).toContainText(ARCA_FINISHED);
    await expect(row).toContainText('finished, waiting for your OK');
    // A finished card opens its Review screen.
    await expect(page.getByTestId('waiting-decide-card-arca-20')).toHaveAttribute('href', '/venture/arca/review/arca/20');
    await expect(page.getByTestId('desk-stuck')).toContainText(ARCA_STUCK);
    await noJohnsParts(page, "ARCA's desk");
    await noOneElses(page, "ARCA's desk");
  });

  test('"Needs you": both of ARCA\'s cards, as rows of the list, counted in the tab and the rail', async ({ page }) => {
    await page.goto('/venture/arca/tickets?filter=needs');
    await expect(page.getByTestId('tickets-row-ARCA-070')).toContainText(ARCA_FINISHED);
    await expect(page.getByTestId('tickets-card-ARCA-070')).toHaveText('finished, waiting for your OK');
    await expect(page.getByTestId('tickets-row-ARCA-074')).toContainText(ARCA_STUCK);
    await expect(page.getByTestId('tickets-card-ARCA-074')).toHaveText('stuck, needs a person');
    // One row for each piece of work.
    await expect(page.getByTestId('tickets-row-ARCA-070')).toHaveCount(1);
    const tab = ((await page.getByTestId('tickets-filter-needs').textContent()) ?? '').match(/(\d+)/)?.[1];
    const rail = ((await page.getByTestId('rail-needs-badge').textContent()) ?? '').trim();
    expect(tab).toBe(rail);
    expect(await page.locator('[data-testid^="tickets-row-"]').count()).toBe(Number(tab));

    await page.getByTestId('tickets-row-ARCA-074').click();
    await expect(page.getByTestId('detail-card-what')).toContainText('Your team got stuck on this');
    await expect(page.getByTestId('detail-card-john')).toHaveCount(0);
    await noJohnsParts(page, "ARCA's Needs you");
    await noOneElses(page, "ARCA's Needs you");

    await page.goto('/venture/arca/tickets?filter=all');
    await noJohnsParts(page, "ARCA's tickets");
    await noOneElses(page, "ARCA's tickets");
  });

  test('"What happened": a line for each card, in plain English', async ({ page }) => {
    await page.goto('/venture/arca/activity');
    const feed = page.getByTestId('activity-feed');
    await expect(feed).toContainText(`Your team finished ${ARCA_FINISHED}. It waits for your OK.`);
    await expect(feed).toContainText(`Your team got stuck on ${ARCA_STUCK}. It needs a person.`);
    await expect(feed.locator('[data-source="card"]').filter({ hasText: ARCA_STUCK })).toContainText('ARCA-074');
    await noJohnsParts(page, "ARCA's What happened");
    await noOneElses(page, "ARCA's What happened");
  });

  test("journey 6: THE RESET's and the factory's cards are in none of ARCA's other lists either", async ({ page }) => {
    // The cross-venture pages, as a founder with one venture reaches them.
    await page.goto('/attention');
    await expect(page).toHaveURL(/\/venture\/arca\/tickets\?filter=needs/);
    await noOneElses(page, '/attention');
    await page.goto('/activity');
    await expect(page.locator('[data-testid^="activity-card-arca-"]').first()).toBeVisible();
    await expect(page.locator('[data-testid^="activity-card-"]:not([data-testid^="activity-card-arca-"])')).toHaveCount(0);
    await noJohnsParts(page, '/activity');
    await noOneElses(page, '/activity');
  });
});

test.describe('3. John sees all four, in Telegram\'s words, with costs', () => {
  test.beforeEach(async ({ page }) => testLogin(page, JOHN));

  test('"Needs you" across the ventures: ARCA\'s two and THE RESET\'s, each with its cost and next step', async ({ page }) => {
    await page.goto('/attention');
    await expect(page.getByTestId('attention-card-arca-arca-20')).toContainText(ARCA_FINISHED);
    await expect(page.getByTestId('attention-card-cost-arca-arca-20')).toContainText('$3.40 so far, of a $25 budget');
    await expect(page.getByTestId('attention-card-arca-arca-22')).toContainText(ARCA_STUCK);
    await expect(page.getByTestId('attention-card-next-arca-arca-22')).toContainText('What to do next: Tell the lane');
    await expect(page.getByTestId('attention-card-the-reset-thereset-platform-5')).toContainText(RESET_FINISHED);
    await expect(page.getByTestId('attention-card-cost-the-reset-thereset-platform-5')).toContainText('$1.20');
  });

  test("what has been happening: the factory's own card, done, with its cost", async ({ page }) => {
    await page.goto('/activity');
    const cowgate = page.getByTestId('activity-card-factory-cowgate-40');
    await expect(cowgate).toContainText(`${COWGATE_DONE} became part of the factory.`);
    await expect(cowgate).toContainText('$4.10, of a $25 budget');
    for (const id of ['arca-arca-20', 'arca-arca-22', 'the-reset-thereset-platform-5']) {
      await expect(page.getByTestId(`activity-card-${id}`).first()).toBeVisible();
    }
  });

  test("ARCA's own pages carry John's cost on the card rows", async ({ page }) => {
    await page.goto('/venture/arca');
    await expect(page.getByTestId('waiting-card-arca-20-meta')).toContainText('$3.40 so far, of a $25 budget');
    await page.goto('/venture/arca/tickets?filter=needs&t=arca%2FARCA-074');
    await expect(page.getByTestId('tickets-card-cost-ARCA-074')).toHaveText('$6.80, of a $15 budget');
    await expect(page.getByTestId('detail-card-john')).toContainText('What to do next: Tell the lane');
    await page.goto('/venture/arca/activity');
    await expect(page.getByTestId('activity-feed').locator('[data-source="card"]').filter({ hasText: ARCA_STUCK })).toContainText('$6.80');
  });
});
