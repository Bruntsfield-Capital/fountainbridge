import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { load } from 'js-yaml';
import { testLogin } from './helpers';

/**
 * Journeys 1 and 2 of `harness/END-TO-END.md`, checked the way that file says (FB-272).
 *
 * Kept word for word close to the journeys so that a person can read one beside the other. Run it
 * against a test copy, the way the factory will:
 *
 *   node scripts/test-copy.mjs start --port 3100
 *   E2E_BASE_URL=http://127.0.0.1:3100 npx playwright test e2e/journeys.spec.ts
 *
 * Without E2E_BASE_URL it runs against Playwright's own server, like every other spec.
 */

const FOUNDER_A = 'matthew@bruntsfield.capital';
const JOHN = 'john.gallagher@wealthcx.com';

/** Every venture in `ventures/` except the example, read the same way the studio reads them. */
function ventures(): Array<{ id: string; name: string }> {
  return readdirSync('ventures')
    .filter((f) => f.endsWith('.yaml') && !f.startsWith('example'))
    .map((f) => load(readFileSync(join('ventures', f), 'utf8')) as { id: string; name: string })
    .map(({ id, name }) => ({ id, name }));
}

test.describe('1. A founder arrives at their own venture', () => {
  test('signed out, they are sent to /login; signed in, / leads to ARCA and names no other venture', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login(\?|$)/);

    await testLogin(page, FOUNDER_A);
    await page.goto('/');
    await expect(page).toHaveURL(/\/venture\/arca$/);

    // "The page names no other venture": no other venture's name or id anywhere in what is shown.
    const text = await page.locator('body').innerText();
    for (const other of ventures().filter((v) => v.id !== 'arca')) {
      expect(text, `ARCA's desk names ${other.name}`).not.toContain(other.name);
      expect(text, `ARCA's desk names ${other.id}`).not.toContain(other.id);
    }
  });
});

test.describe('2. John sees every venture', () => {
  test('signed in, John sees the ledger with a row for every venture except the example', async ({ page }) => {
    await testLogin(page, JOHN);
    await page.goto('/');
    await expect(page.getByTestId('ledger-table')).toBeVisible();

    const all = ventures();
    expect(all.length, 'ventures/ holds no ventures').toBeGreaterThan(0);
    for (const v of all) {
      await expect(page.getByTestId(`ledger-row-${v.id}`), `no row for ${v.name}`).toBeVisible();
    }
    await expect(page.getByTestId('ledger-row-example-venture')).toHaveCount(0);
  });
});
