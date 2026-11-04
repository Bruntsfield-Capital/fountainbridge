import { test, expect } from '@playwright/test';
import { inTopDownOrder, testLogin } from './helpers';

// FB-007: the attention queue + PR-derived ticket status inference. Runs against fixture PRs
// (PRS_FIXTURE_DIR) so it's deterministic.
const SHOTS = 'e2e/__screenshots__';

test('attention queue lists open PRs oldest-first, with preview as the primary link', async ({ page }) => {
  await testLogin(page, 'john.gallagher@wealthcx.com'); // admin — sees all ventures' PRs
  await page.goto('/attention');

  // 4 open (10, 11, 13, 14), 1 merged excluded. FB-099 added 13 and 14 — the lane's own branch shape,
  // one that matches a ticket by slug and one that matches nothing at all.
  await expect(page.getByTestId('attention-queue').locator('[data-testid^="approval-arca#"]')).toHaveCount(4);
  // FB-149: the count is finished work AND the sends waiting on a founder, and both are listed.
  const sends = await page.getByTestId('attention-sends').locator('article').count();
  expect(sends).toBeGreaterThan(0);
  await expect(page.getByTestId('attention-count')).toHaveText(String(4 + sends));
  // FB-024: plain-language copy, no git jargon ("open PR"/"the workshop never merges").
  await expect(page.getByText('Nothing goes live until you approve it.')).toBeVisible();
  const queue = page.getByTestId('attention-queue');
  await expect(queue).toBeVisible();

  // Oldest first: PR #10 (2026-07-15) before PR #11 (2026-07-19).
  const rows = queue.locator('[data-testid^="approval-arca#"]');
  await expect(rows.nth(0)).toHaveAttribute('data-testid', 'approval-arca#10');
  await expect(rows.nth(1)).toHaveAttribute('data-testid', 'approval-arca#11');

  // FB-064: the title opens the work INSIDE the studio. This page promises "waiting on your OK"
  // and used to offer only a link to github.com — three of the seven steps in the loop happened in
  // a developer tool the founder was never meant to open.
  await expect(page.getByTestId('approval-primary-arca#10')).toHaveAttribute('href', '/venture/arca/work/arca/10');
  await expect(page.getByTestId('approval-primary-arca#11')).toHaveAttribute('href', '/venture/arca/work/arca/11');

  // The preview is still one click away when there is one — it just is not the only thing to click.
  // FB-184: and only once the studio has opened it. The rig answers from
  // e2e/fixtures/preview-checks.json: #11's preview opens, #13's does not, #10's was never checked.
  await expect(page.getByTestId('approval-preview-arca#11')).toHaveAttribute('href', 'https://arca-pr-11.up.railway.app');
  await expect(page.getByTestId('approval-preview-arca#13')).toHaveCount(0);
  await expect(page.getByTestId('approval-preview-why-arca#13')).toContainText('it is not answering');
  await expect(page.getByTestId('approval-preview-arca#10')).toHaveCount(0);

  // Nothing on this page sends a founder to a code host any more.
  const offsite = await page.locator('a[href*="github.com"]').count();
  expect(offsite).toBe(0);

  await page.screenshot({ path: `${SHOTS}/07-attention-queue.png`, fullPage: true });
});

test('nav shows the attention badge count', async ({ page }) => {
  await testLogin(page, 'john.gallagher@wealthcx.com');
  await page.goto('/attention');
  const listed = (await page.getByTestId('attention-count').textContent())?.trim();
  await page.goto('/');
  await expect(page.getByTestId('nav-attention-badge')).toHaveText(listed!);
});

/**
 * FB-149's last criterion. An admin's header leads here, and this page listed finished work only —
 * so on the UI gate's fixtures it said 4 while ARCA's desk said 10. ARCA is the only venture with
 * fixture work and sends, so its desk's number is the whole page's number.
 */
test('an admin reads one number in the header, on this page and on the desk', async ({ page }) => {
  await testLogin(page, 'john.gallagher@wealthcx.com');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/venture/arca');
  const summary = (await page.getByTestId('desk-summary').textContent()) ?? '';
  const onDesk = summary.match(/(\d+)\s+decisions?\s+waits?\s+on you/)?.[1];
  expect(onDesk, `the desk's sentence states no count: "${summary}"`).toBeDefined();

  // The phone, where the header is the only "Needs you" there is.
  await page.setViewportSize({ width: 393, height: 851 });
  await page.goto('/venture/arca');
  await expect(page.getByTestId('nav-attention-badge')).toHaveText(onDesk!);
  await page.getByTestId('topnav').getByRole('link', { name: /Needs you/ }).click();
  await expect(page).toHaveURL(/\/attention$/);
  await expect(page.getByTestId('attention-count')).toHaveText(onDesk!);

  // A send is listed as one, and leads to its own page — never an approve button here (FB-183).
  const send = page.getByTestId('attention-sends').locator('article').first();
  await expect(send).toContainText('send');
  await expect(send.locator('a').first()).toHaveAttribute('href', /^\/venture\/arca\/approvals\//);
  await expect(page.getByTestId('attention-sends').getByRole('button')).toHaveCount(0);
});

test('open PR moves its ticket to "Needs your OK" (status inference)', async ({ page }) => {
  await testLogin(page, 'john.gallagher@wealthcx.com');
  // The desk's board is gone (FB-178); the inference it demonstrated is unchanged and is now read
  // on the queue, which is the only list of tickets a founder has.
  await page.goto('/venture/arca/tickets');
  // ARCA-1's markdown status is "In progress", but open PR #10 references it → "Needs your OK".
  // The point is that the inferred status wins over the file's own claim.
  //
  // FB-208 took the status off the row: it was one clause of five on a line that wrapped to three,
  // and status is what the filter above the list already selects. The inference is read where it now
  // lives — the ticket's own eyebrow — which is the same claim in a place with room for it.
  await page.getByTestId('tickets-row-ARCA-1').click();
  await expect(page.getByTestId('tickets-detail')).toContainText('Waiting for you');
});

test('a founder sees only their own ventures in the queue', async ({ page }) => {
  // FB-129 absorbed this page into the Tickets screen's "Needs you" filter, so a founder with one
  // venture is redirected there — the same work, on a screen where they can also decide about it.
  // The isolation this test exists for is asserted on wherever they land, not on the old route.
  await testLogin(page, 'ross@bruntsfield.capital'); // the-reset only; its repos have no PR fixtures
  await page.goto('/attention');
  await page.waitForURL(/\/venture\/the-reset\/tickets\?filter=needs/);

  await expect(page.getByTestId('tickets-view')).toBeVisible();
  // arca's work (John's fixture) must NOT leak into Ross's screen, whichever screen it is.
  const body = (await page.locator('body').textContent()) ?? '';
  expect(body).not.toContain('ARCA-');
  await expect(page.getByTestId('tickets-list-empty')).toBeVisible();
});

test('a bookmark of the old queue never 404s', async ({ page }) => {
  // Its own acceptance criterion: absorbed, not deleted.
  await testLogin(page, 'ross@bruntsfield.capital');
  const res = await page.goto('/attention');
  expect(res?.status()).toBeLessThan(400);
});

test('someone who can see several ventures keeps the cross-venture queue', async ({ page }) => {
  // Sending John to one venture's list would quietly lose the others. This page is the only place
  // that answers "what is waiting on me, anywhere".
  await testLogin(page, 'john.gallagher@wealthcx.com');
  await page.goto('/attention');
  await expect(page.getByTestId('attention-count')).toBeVisible();
});

test('the queue says what the checks mean, not CI UNKNOWN', async ({ page }) => {
  // FB-076. `CI UNKNOWN` in monospace small-caps beside every item means "this repository has no
  // automatic checks" — true of a young venture and completely fine, and it read as something being
  // wrong. The work view already said it plainly; the queue did not, so the same fact was
  // reassuring on one screen and alarming on the other.
  await testLogin(page, 'john.gallagher@wealthcx.com');
  await page.goto('/attention');
  const body = (await page.locator('body').textContent()) ?? '';
  expect(body).not.toContain('CI unknown');
  expect(body).not.toContain('CI UNKNOWN');
  await expect(page.getByTestId('approval-ci').first()).not.toHaveText(/^CI /);
});

test('read failures sit below the work and are grouped by cause', async ({ page }) => {
  // The version this replaced opened the page with five failures and two causes run into one
  // sentence, above the work the founder came for.
  await testLogin(page, 'john.gallagher@wealthcx.com');
  await page.goto('/attention');
  const failures = page.getByTestId('attention-errors');
  if (await failures.count()) {
    await inTopDownOrder([               // below the work, not above it
      ['the work', page.getByTestId('attention-queue')],
      ['the read failures', failures],
    ]);
    // Never a repository owner in front of a founder.
    expect((await failures.textContent()) ?? '').not.toContain('wealthcx01/');
  }
});

test('four destinations, each named for the job (FB-067)', async ({ page }) => {
  // Eight, three of which — Ventures, Workstreams, Foundry — sat next to each other and could not be
  // told apart from the words. They described how the software is organised, not what a founder came
  // to do.
  await testLogin(page, 'ross@bruntsfield.capital');
  await page.goto('/attention');
  const nav = (await page.getByTestId('topnav').locator('a').allTextContents())
    .map((t) => t.replace(/\d+$/, '').trim());
  expect(nav).toEqual(['Your venture', 'Needs you', 'What happened', 'Handbook']);

  // The `03` was a section number from the Bruntsfield marketing site.
  await expect(page.locator('header')).not.toContainText('03');
});

test('an admin is told it is an admin view (FB-067)', async ({ page }) => {
  await testLogin(page, 'john.gallagher@wealthcx.com');
  await page.goto('/attention');
  await expect(page.getByTestId('topnav')).toContainText('All ventures');
});

test('the moved pages still exist and are findable (FB-067)', async ({ page }) => {
  // They move, they do not disappear. A 404 would be deleting content the ticket said to keep.
  await testLogin(page, 'john.gallagher@wealthcx.com');
  for (const path of ['/foundry', '/playbook', '/lanes']) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBeLessThan(400);
  }
  await page.goto('/handbook');
  await expect(page.getByTestId('handbook-foundry')).toBeVisible();
  await expect(page.getByTestId('handbook-playbook')).toBeVisible();
});

test('badges say what they mean and can be reached by keyboard (FB-068)', async ({ page }) => {
  // A badge that cannot be interrogated trains people to ignore badges.
  await testLogin(page, 'john.gallagher@wealthcx.com');
  await page.goto('/venture/the-reset');
  const stale = page.getByTestId('lane-stale-thereset-platform');
  if (await stale.count()) {
    await expect(stale).toHaveAttribute('tabindex', '0');
    const title = await stale.getAttribute('title');
    expect(title?.length ?? 0).toBeGreaterThan(30);   // an explanation, not a restatement
    await expect(stale).not.toHaveText(/^⚠ stale$/);
  }
});


/**
 * FB-100 — words a founder should never meet. The items the walkthrough actually met, pinned so the
 * next surface does not re-earn them.
 */
test.describe('the walkthrough’s words (FB-100)', () => {
  test('the sign-in page does not disown its own second door', async ({ page }) => {
    // The subtitle read "Sign in with your venture Google account" directly above the email-and-
    // password form — a founder holding an email login told, by the page offering it, to use Google.
    await page.goto('/login');
    await expect(page.getByTestId('password-login')).toBeVisible();
    await expect(page.locator('section')).toContainText('email and password');
  });

  test('one alarm for one fact, not one per card', async ({ page }) => {
    await testLogin(page, 'john.gallagher@wealthcx.com');
    await page.goto('/attention');
    const shared = page.getByTestId('attention-checks-shared');
    const perCard = page.getByTestId('approval-ci');
    // Either the queue says it once above the list, or the items genuinely differ and each says its
    // own. Never fifteen copies of one sentence.
    if (await shared.count()) {
      await expect(perCard).toHaveCount(0);
    } else {
      expect(new Set(await perCard.evaluateAll((els) => els.map((e) => e.getAttribute('data-checks')))).size)
        .toBeGreaterThan(1);
    }
  });

  test('a wait says who it is waiting on', async ({ page }) => {
    await testLogin(page, 'john.gallagher@wealthcx.com');
    await page.goto('/attention');
    await expect(page.getByTestId('attention-queue')).toContainText('for you');
  });

  test('the studio does not introduce the founder to themselves', async ({ page }) => {
    // "Founder: John Gallagher" while signed in AS the founder. The manifest is right; this is
    // presentation. matthew@bruntsfield.capital is ARCA's named founder in the manifest.
    await testLogin(page, 'matthew@bruntsfield.capital');
    await page.goto('/venture/arca');
    await expect(page.getByTestId('board-founder')).toContainText('Founder: you');
  });
});
