import { test, expect } from '@playwright/test';
import { testLogin } from './helpers';

/**
 * FB-151 — where the studio spent its time.
 *
 * A Bruntsfield diagnostic, not a founder surface. Twice the studio was optimised by reasoning
 * about which code looked expensive and twice the reasoning was wrong, so the thing that replaces
 * the reasoning has to be reachable and has to be scoped.
 */
test.describe('where the studio spent its time (FB-151)', () => {
  test('an admin sees readings from the requests they just made', async ({ page }) => {
    await testLogin(page, 'john.gallagher@wealthcx.com');
    // Make some readings first: the rail is measured, so loading a venture screen produces rows.
    await page.goto('/venture/arca');
    await page.goto('/admin/timing');

    await expect(page.getByTestId('timing-table')).toBeVisible();
    await expect(page.getByTestId('timing-table')).toContainText('rail: everything');
    await expect(page.getByTestId('timing-table')).toContainText('rail: open work');
    // The header's own read is measured too — it was the five seconds, and it is not under a rail.
    await expect(page.getByTestId('timing-table')).toContainText('root layout: what waits on you across your ventures');
  });

  test('a founder is told plainly that it is not for them', async ({ page }) => {
    // Not a 404 and not a silent redirect: a founder who types the path deserves a sentence.
    await testLogin(page, 'matthew@bruntsfield.capital');
    await page.goto('/admin/timing');
    await expect(page.getByTestId('timing-forbidden')).toBeVisible();
    await expect(page.getByTestId('timing-table')).toHaveCount(0);
  });

  test('the readings say what they do not cover', async ({ page }) => {
    // A diagnostic that overstates its own reach is worse than none: these are one server process's
    // numbers, and a deploy empties them.
    await testLogin(page, 'john.gallagher@wealthcx.com');
    await page.goto('/admin/timing');
    await expect(page.getByTestId('timing')).toContainText('this server process');
    await expect(page.getByTestId('timing')).toContainText('A deploy empties them');
  });
});
