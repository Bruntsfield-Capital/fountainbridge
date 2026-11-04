import { test, expect } from '@playwright/test';
import { testLogin } from './helpers';

/**
 * FB-295: a venture the factory builds shows the factory, not its old machine.
 *
 * This suite only means anything when the server was started with `STUDIO_FACTORY_BUILT=arca`. Run
 * it with `npm run test:e2e:factory`. The other suites run with it empty, because their ARCA
 * fixtures are an old machine's records and they test those screens. Without it set, every test
 * here is skipped, and says why.
 */
const FACTORY_ON = (process.env.STUDIO_FACTORY_BUILT ?? '').split(/[,\s]+/).includes('arca');

test.describe('a venture the factory builds (FB-295)', () => {
  test.skip(!FACTORY_ON, 'Needs the server started with STUDIO_FACTORY_BUILT=arca (npm run test:e2e:factory).');

  test.beforeEach(async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
  });

  test('the desk shows the factory line, and none of the old machine', async ({ page }) => {
    await page.goto('/venture/arca');
    await expect(page.getByTestId('factory-line')).toContainText('The factory builds ARCA.');
    await expect(page.getByTestId('office-section')).toHaveCount(0);
    await expect(page.getByTestId('lane-activity')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('checked in');
    await expect(page.locator('main')).not.toContainText('venture’s machine');
  });

  test('the rail says the same line, and shows no budgets', async ({ page }) => {
    await page.goto('/venture/arca');
    await expect(page.getByTestId('rail-engine')).toContainText('The factory builds ARCA.');
    await expect(page.getByTestId('rail-budgets')).toHaveCount(0);
  });

  test('the Tickets page never says the old machine has not checked in', async ({ page }) => {
    await page.goto('/venture/arca/tickets');
    await expect(page.locator('body')).not.toContainText('has not checked in');
    await expect(page.locator('body')).not.toContainText('venture’s machine');
  });
});

test.describe('a venture with its own machine (FB-295)', () => {
  test.skip(!FACTORY_ON, 'Needs the server started with STUDIO_FACTORY_BUILT=arca (npm run test:e2e:factory).');

  test('is unchanged', async ({ page }) => {
    await testLogin(page, 'john.gallagher@wealthcx.com');
    await page.goto('/venture/the-reset');
    await expect(page.getByTestId('rail-engine')).not.toContainText('The factory builds');
    await expect(page.getByTestId('factory-section')).toHaveCount(0);
  });
});
