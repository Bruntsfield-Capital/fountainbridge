import { test, expect } from '@playwright/test';
import { testLogin } from './helpers';

/**
 * FB-235: the Sell surface. Who needs the founder now, where every deal stands, and nothing that sends.
 *
 * The fixture is `e2e/fixtures/crm/arca.json`: fifteen invented people and sixteen deals, big enough
 * that the list and the board both hit their caps.
 */
const SHOTS = 'e2e/__screenshots__';
const FOUNDER = 'matthew@bruntsfield.capital';

test('a founder can answer "who is waiting on me" from the Sell surface alone', async ({ page }) => {
  await testLogin(page, FOUNDER);
  await page.goto('/venture/arca/sell');

  const rows = page.getByTestId('sell-action');
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText('Ada Example');
  await expect(rows.first()).toContainText('Waiting for your reply');
  await expect(page.getByTestId('sell-next-more')).toContainText('2 more');
  await expect(page.getByTestId('sell-stage')).toHaveCount(6);
  await expect(page.getByTestId('sell-stage').last()).toHaveAttribute('data-stage', 'won');
  await expect(page.getByTestId('sell-summary')).toContainText('6 of 14 open deals have no value yet');
  await page.screenshot({ path: `${SHOTS}/sell-desk.png`, fullPage: true });
});

test('pressing a draft action sends nothing: it opens the composer with a draft request', async ({ page }) => {
  await testLogin(page, FOUNDER);
  await page.goto('/venture/arca/sell');

  // Anything that left the page as a write would be a POST. Pressing the action must make none
  // before the composer is on the screen.
  const posts: string[] = [];
  page.on('request', (r) => { if (r.method() !== 'GET') posts.push(`${r.method()} ${r.url()}`); });

  // The Sell content itself draws no form and no button. The one form on the page is "Sign out" in
  // the studio's top bar, which every page has; it ends the session and sends nothing.
  await expect(page.getByTestId('sell-page')).toBeVisible();
  await expect(page.getByTestId('sell-page').locator('form, button, input')).toHaveCount(0);
  await expect(page.locator('form')).toHaveCount(1);
  await expect(page.locator('form.signout-form')).toHaveCount(1);
  await page.getByTestId('sell-action-draft').first().click();
  await page.waitForURL(/\/venture\/arca\/composer\?ask=/);
  const ask = new URL(page.url()).searchParams.get('ask') ?? '';
  expect(ask).toMatch(/^Draft a reply to Ada Example/);
  expect(ask).toMatch(/Do not send anything\.$/);
  expect(posts.filter((p) => !p.includes('/_next/')), 'pressing a draft action wrote something').toEqual([]);
});

test('the desk links to the pipeline from the Sell surface', async ({ page }) => {
  await testLogin(page, FOUNDER);
  await page.goto('/venture/arca');
  // ARCA's Sell surface is open in its manifest (arca-marketing is in its repos), so the link is there.
  await page.getByTestId('sell-pipeline-link').click();
  await page.waitForURL(/\/venture\/arca\/sell$/);
  await expect(page.getByTestId('sell-next')).toBeVisible();
});

test('a founder cannot open another venture’s pipeline', async ({ page }) => {
  // Signed in as ARCA's founder, asking for the-reset's Sell page. The-reset has no fixture, so an
  // empty page would look the same as a refusal; only the refusal notice proves the access check ran.
  await testLogin(page, FOUNDER);
  await page.goto('/venture/the-reset/sell');
  await expect(page.getByTestId('venture-forbidden')).toBeVisible();
  await expect(page.getByTestId('sell-page')).toHaveCount(0);
});
