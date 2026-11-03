import { test, expect } from '@playwright/test';
import { testLogin } from './helpers';

/**
 * FB-106 — what has the venture been given?
 *
 * John: "nothing that allows the founder to see what docs have been uploaded either to the composer
 * or the studio?" Documents went in through the composer, landed in the venture's context/ and
 * library/ on git, and then vanished from the founder's view — the only way to see the corpus was
 * GitHub, which is the product this studio exists to replace.
 */
test.describe('what your venture knows (FB-106)', () => {
  test.beforeEach(async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
  });

  test('the studio offers the way in, on every screen', async ({ page }) => {
    // FB-203, item 6 removed the desk's own link. Memory is a rail item, so it is reachable from
    // everywhere rather than from the desk alone — a link on the desk to a place the navigation
    // already goes is the doubled navigation FB-124 shipped. This asserts the rail is that door.
    await page.goto('/venture/arca');
    // Scoped to `rail`. The nav also renders inside `rail-waiting`, the shell shown while the rail
    // streams in, so a bare testid matches two elements for as long as both are in the document —
    // which is never on this machine and often on CI's.
    await page.getByTestId('rail').getByTestId('rail-nav-memory').click();
    await expect(page).toHaveURL(/\/venture\/arca\/knowledge$/);
  });

  test('every deposited document is listed, and says what it is for', async ({ page }) => {
    // FB-133 turned the two grouped lists into one table. What each document is FOR still has to
    // reach the founder — it moved into the row rather than being dropped.
    await page.goto('/venture/arca/knowledge');
    const table = page.getByTestId('memory-table');
    await expect(table).toContainText('Brand positioning');
    await expect(table).toContainText('Price list');
    await expect(table).toContainText('Set naming decision');
    await expect(table).toContainText('reads before it works');
  });

  test('a founder reads a document without leaving the studio', async ({ page }) => {
    // The whole point: the only way to see this was GitHub.
    await page.goto('/venture/arca/knowledge');
    await page.getByTestId('knowledge-doc-arca/context/sell/brand-positioning.md').click();
    const reader = page.getByTestId('knowledge-reader');
    await expect(reader).toBeVisible();
    await expect(reader).toContainText('a trading desk, not a toy aisle');
    // Rendered, not printed: the founder never meets raw markdown.
    await expect(page.getByTestId('knowledge-reader-title')).toHaveText('Brand positioning');
  });

  test('the rules are stated where the button is', async ({ page }) => {
    // A founder who meets a refusal they were not warned about learns the studio does not know its
    // own limits. The sentence is built from the constant the code enforces.
    await page.goto('/venture/arca/knowledge');
    await expect(page.getByTestId('knowledge-limits')).toContainText('PDF');
    await expect(page.getByTestId('knowledge-limits')).toContainText('12MB');
    await expect(page.getByTestId('knowledge-limits')).toContainText('proposed for your OK');
  });

  test('handing a document over reaches the server and answers honestly', async ({ page }) => {
    // No write credential in the UI gate, so the honest refusal is what this proves: the control
    // exists, reaches the server, and says what is wrong rather than failing silently.
    await page.goto('/venture/arca/knowledge');
    await page.getByTestId('knowledge-file').setInputFiles({
      name: 'price-list.txt', mimeType: 'text/plain', buffer: Buffer.from('Graded slabs: 10% over market.'),
    });
    await page.getByTestId('knowledge-submit').click();
    await expect(page.getByTestId('knowledge-result')).toBeVisible();
  });

  test('another venture’s knowledge is not reachable by guessing the URL', async ({ page }) => {
    // Venture isolation is server-side on this route like every other (CLAUDE.md #6).
    await page.goto('/venture/the-reset/knowledge');
    await expect(page.getByTestId('knowledge')).toHaveCount(0);
  });
});

/**
 * FB-133 — Memory: what the venture knows.
 *
 * The screen the design asks for on top of FB-106's list: one table, with where each document came
 * from, and the recurring work underneath it. The founder's question here is never "what files
 * exist" — it is "is the thing I handed over actually being used?"
 */
test.describe('memory (FB-133)', () => {
  test.beforeEach(async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
  });

  test('the table names the source of every document, in the founder’s terms', async ({ page }) => {
    await page.goto('/venture/arca/knowledge');

    // The studio's own Add control wrote this one, so it was the founder.
    await expect(page.getByTestId('memory-from-arca/context/general/price-list.md')).toHaveText('You');
    // The composer deposited this one. Not "You" — the machine made that call mid-conversation.
    await expect(page.getByTestId('memory-from-arca/context/sell/brand-positioning.md')).toHaveText('Your composer');
    // Nobody the studio recognises: whoever actually wrote it.
    await expect(page.getByTestId('memory-from-arca/library/build/set-naming.md')).toHaveText('Founder');
  });

  test('a document with a history says Updated, never Added over the date of an edit', async ({ page }) => {
    await page.goto('/venture/arca/knowledge');
    await expect(page.getByTestId('memory-added-arca/context/general/price-list.md')).toHaveText('Added 20 July 2026');
    // Four changes behind it: the date we hold is the last one, and the word has to say so.
    await expect(page.getByTestId('memory-added-arca/library/build/set-naming.md')).toHaveText('Updated 2 June 2026');
  });

  test('the FB-133 apology for an empty “Last used” is GONE', async ({ page }) => {
    // Asserted as an absence on purpose. The column was empty for a ticket and a half with the
    // reason written underneath, and the risk when it fills is not that the new sentence is missing
    // — it is that the OLD one survives beside it, telling a founder nothing records what their
    // team reads while the row next to it names the ticket that read it. A test for the replacement
    // would pass with both on screen.
    await page.goto('/venture/arca/knowledge');
    await expect(page.getByTestId('memory-table')).toBeVisible();
    await expect(page.getByTestId('knowledge')).not.toContainText('nothing yet records');
    await expect(page.getByTestId('knowledge')).not.toContainText('a number nobody measured');
  });

  test('“Last used” names the work, and links to it (FB-156)', async ({ page }) => {
    await page.goto('/venture/arca/knowledge');
    const cell = page.getByTestId('memory-used-arca/context/sell/brand-positioning.md');
    await expect(cell).toHaveAttribute('data-use', 'used');
    // A link, not a bare date: the founder's question is what it was used FOR.
    const link = cell.getByRole('link', { name: 'Replace the tagline' });
    await expect(link).toHaveAttribute('href', '/venture/arca/tickets?t=ARCA-58');
    await expect(cell).toContainText('30 August 2026');
  });

  test('a document nothing has read says so, and differently from one with no record', async ({ page }) => {
    // The distinction the ticket turns on. Both are a dash to the eye — the table would be
    // unreadable otherwise — and they are different sentences to a screen reader, because "nobody
    // has read this" is a finding the founder can act on and "we do not keep the record" is not.
    await page.goto('/venture/arca/knowledge');
    const unread = page.getByTestId('memory-used-arca/context/general/price-list.md');
    await expect(unread).toHaveAttribute('data-use', 'never');
    await expect(unread).toContainText('—');
    await expect(unread.locator('.sr-only')).toHaveText('Nothing has read this yet.');

    // And the note underneath explains the dash the rows are actually showing.
    await expect(page.getByTestId('memory-used-note')).toContainText('nothing has read that document yet');
  });

  test('the screen says which documents the team cannot find (FB-169)', async ({ page }) => {
    // Listed here is not the same as findable by the team. ARCA's index skipped every Build
    // document for a month while this table listed them; the sentence under it now says so, by name.
    await page.goto('/venture/arca/knowledge');
    const note = page.getByTestId('memory-find-note');
    await expect(note).toHaveAttribute('data-tone', 'attention');
    await expect(note).toContainText('Your team cannot find 1 document of your 4');
    await expect(note).toContainText('Set naming decision');
  });

  test('the summary counts the same documents the table lists', async ({ page }) => {
    // The FB-149 failure — a count over one screen and a list over another — on the one screen whose
    // entire job is to state what the studio actually holds.
    await page.goto('/venture/arca/knowledge');
    const rows = await page.locator('[data-testid^="memory-row-"]').count();
    await expect(page.getByTestId('memory-summary')).toContainText(`${rows} documents`);
    // And the areas it names add up to the same total.
    const summary = (await page.getByTestId('memory-summary').textContent()) ?? '';
    const counted = [...summary.matchAll(/(\d+) (?:pieces? of background|artifacts?)/g)]
      .reduce((n, m) => n + Number(m[1]), 0);
    expect(counted).toBe(rows);
  });

  test('the recurring work is on the screen, with a way to change it', async ({ page }) => {
    // `/routines` has no row in the rail, so this is the only route to it.
    await page.goto('/venture/arca/knowledge');
    await expect(page.getByTestId('memory-routines')).toContainText('Each week, work the new sign-ups');
    await expect(page.getByTestId('memory-routine-daily-price-check')).toContainText('waiting for you');
    await page.getByTestId('memory-routines-link').click();
    await expect(page).toHaveURL(/\/venture\/arca\/routines$/);
  });

  test('the screen fits a phone, long document names and all', async ({ page }) => {
    // FB-153: a single long string pushed a 393px window to 471px. A four-column table is the same
    // defect waiting to happen, so the page must not scroll sideways at any point.
    await page.setViewportSize({ width: 393, height: 851 });
    await page.goto('/venture/arca/knowledge');
    await expect(page.getByTestId('memory-table')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

/**
 * FB-157 — Memory streams, and its Add control is not duplicated by the shell.
 *
 * The waiting shell deliberately carries no form: content in a Suspense fallback is not hydrated, so
 * a form there would be present, duplicated beside the real one, and dead to the touch.
 */
test.describe('memory streams (FB-157)', () => {
  test('there is exactly one Add control, and it is the live one', async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
    await page.goto('/venture/arca/knowledge');
    await expect(page.getByTestId('knowledge-file')).toHaveCount(1);
    await expect(page.getByTestId('knowledge-submit')).toHaveCount(1);
    await expect(page.getByTestId('knowledge-waiting')).toHaveCount(0);

    await page.getByTestId('knowledge-file').setInputFiles({
      name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('A note.'),
    });
    await page.getByTestId('knowledge-submit').click();
    await expect(page.getByTestId('knowledge-result')).toBeVisible();
  });
});

/**
 * FB-140 — a credential must never reach a venture's records.
 *
 * The composer's deposit tool has scanned every deposit since it was written. The studio's own Add
 * control did not scan at all: two doors to one place, one of them guarded.
 */
test.describe('handing over a document (FB-140)', () => {
  test.beforeEach(async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
    await page.goto('/venture/arca/knowledge');
  });

  test('a document carrying a private key is refused, with a reason', async ({ page }) => {
    await page.getByTestId('knowledge-file').setInputFiles({
      name: 'runbook.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Deploy notes\n\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n'),
    });
    await page.getByTestId('knowledge-submit').click();
    const result = page.getByTestId('knowledge-result');
    await expect(result).toBeVisible();
    await expect(result).toContainText('was not saved');
    await expect(result).toContainText('a private key');
    // Actionable, not a lecture: it says what to do next.
    await expect(result).toContainText(/remove it/i);
  });

  test('the refusal never repeats the credential back', async ({ page }) => {
    // The message is rendered on a screen and could be read over a shoulder or pasted into a
    // support thread. The whole point is to keep the value out of the record — including this one.
    const token = `ghp_${'z'.repeat(36)}`;
    await page.getByTestId('knowledge-file').setInputFiles({
      name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from(`token ${token}\n`),
    });
    await page.getByTestId('knowledge-submit').click();
    await expect(page.getByTestId('knowledge-result')).toContainText('a GitHub token');
    await expect(page.getByTestId('knowledge-result')).not.toContainText(token);
  });

  test('an ordinary document is not refused', async ({ page }) => {
    // A coarse net still has to pass what founders actually upload. This rig holds no write
    // credential, so the honest refusal proves it got past the scan and reached the server.
    await page.getByTestId('knowledge-file').setInputFiles({
      name: 'positioning.txt', mimeType: 'text/plain',
      buffer: Buffer.from('A trading desk, not a toy aisle. Our password policy is a manager.'),
    });
    await page.getByTestId('knowledge-submit').click();
    const result = page.getByTestId('knowledge-result');
    await expect(result).toBeVisible();
    await expect(result).not.toContainText('was not saved');
  });

  test('a document cannot be handed to another venture by guessing the URL', async ({ page }) => {
    // Venture isolation on the write path, not only the read (CLAUDE.md #6).
    await page.goto('/venture/the-reset/knowledge');
    await expect(page.getByTestId('knowledge-file')).toHaveCount(0);
    await expect(page.getByTestId('venture-forbidden')).toBeVisible();
  });
});

/**
 * FB-181 — Memory listed repository scaffolding as founder knowledge.
 *
 * The fixture carries `context/README.md` committed by `wealthcx01`, so one row would have
 * reproduced two of the three faults at once: a file the founder never handed over, credited to a
 * company. If either fix is removed, this goes red on the rendered screen rather than in a unit.
 */
test.describe('what belongs on the Memory screen (FB-181)', () => {
  test.beforeEach(async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
    await page.goto('/venture/arca/knowledge');
    await expect(page.getByTestId('memory-table')).toBeVisible();
  });

  test('a directory readme is not listed as something a founder handed over', async ({ page }) => {
    const rows = await page.locator('tbody tr').allInnerTexts();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).not.toMatch(/README/i);
  });

  test('no row names the GitHub organisation in the From column', async ({ page }) => {
    const rows = await page.locator('tbody tr').allInnerTexts();
    for (const row of rows) expect(row).not.toContain('wealthcx01');
  });

  test('each row names the surface the document belongs to, from its own path', async ({ page }) => {
    // `context/sell/brand-positioning.md` is a Sell document kept in the product repo. Keying this
    // off the repository would say "Build" and would be wrong.
    const row = page.locator('tbody tr', { hasText: 'Brand positioning' }).first();
    await expect(row).toContainText('Sell');
  });
});
