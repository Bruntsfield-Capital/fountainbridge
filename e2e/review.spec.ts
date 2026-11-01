import { test, expect, request as newRequest, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { testLogin } from './helpers';
import { stateFolder } from './server-env.mjs';
import { answerPress, collect, putReviewCards, reportHeartbeat, reportTelegram, sendToDoor } from './review-cards';

/**
 * FB-274: the Review screen, and journeys 4 and 5 of `harness/END-TO-END.md`.
 *
 * Runs against Playwright's own studio, or against a test copy (`E2E_BASE_URL`, with
 * `FACTORY_RUNTIME_STATE` set to the folder the copy printed). Either way the studio writes each
 * press as one line to `presses.jsonl` in its state folder, and these tests read that file back: it
 * is what "recorded once" means.
 *
 * The cards are the rig's (`e2e/fixtures/review`): ARCA's #20 (the auctions view) and #21 (prices
 * in pounds), and THE RESET's #5, which ARCA's founder must never reach. Since FB-275 they reach the
 * studio only through the planning box's door, signed, with their pictures, before these tests run
 * (`e2e/review-cards.ts`). The screen reads them from the card store.
 *
 * Since FB-276 a press is recorded in the press store, and the stand-in factory collects it through
 * the same door and says what happened (`collect`, `answerPress`, `reportTelegram` in
 * `e2e/review-cards.ts`). The card's state on the screen comes from the store and the factory's
 * answers. The line file is still written, and still read here, because journey 5 checks it.
 */

const FOUNDER = 'arca.founder@bruntsfield.capital';
const JOHN = 'john.gallagher@wealthcx.com';
const PRESSES = join(stateFolder(), 'presses.jsonl');
const SHOTS = 'e2e/__screenshots__';

interface Press { repo: string; number: number; by: string; decision: string; note: string }
/** What the line file holds for one card number; ARCA's, or THE RESET's #5. */
function presses(number: number): Press[] {
  let text = '';
  try {
    text = readFileSync(PRESSES, 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Press).filter((p) => (p.repo === 'arca' || p.repo === 'thereset-platform') && p.number === number);
}

/**
 * Everything John-only, which must never be in a founder's browser.
 *
 * In the page's source a dollar figure is "$" and a number followed by a space or a stop. React's own
 * data in the page writes references as "$1" and "$L5", always followed by a quote, so those are not
 * counted. What a founder reads is checked with the plain rule as well.
 */
const JOHN_ONLY = [/\$\s?\d[\d,]*(?:\.\d+)?(?=[\s.,;)<]|$)/, /what to do next/i, /archon/i];
const JOHN_ONLY_READ = [/\$\s?\d/, /what to do next/i, /archon/i];

const ONLY_JOHN = 'Only John can do that. Nothing was recorded.';
const NOT_FOUND = 'That work could not be found.';
const OUT_OF_DATE = "This card is out of date: the run isn't waiting at it any more. Nothing was done.";

test.describe.configure({ mode: 'serial' });

/** The stand-in factory's own connection to the door. It has no session: only the door's secret. */
let standIn: APIRequestContext;

/** Collect until there is nothing left, so a test sees only what it pressed. */
async function drain(api: APIRequestContext) {
  for (let i = 0; i < 20; i++) {
    const got = await collect(api);
    if (!got.presses.length && !got.signOffs.length) return;
  }
}

// Each run starts with no presses, so a retry sees the cards as the factory sent them: every put is a
// new version of each card, and presses belong to one version.
test.beforeAll(async ({ browser }, info) => {
  rmSync(PRESSES, { force: true });
  standIn = await newRequest.newContext({ baseURL: String(info.project.use.baseURL) });
  await putReviewCards(browser, String(info.project.use.baseURL));
  await drain(standIn);
  await learnPressAction(browser);
  expect(presses(21)).toEqual([]);
});
test.afterAll(async () => {
  rmSync(PRESSES, { force: true });
  await standIn?.dispose();
});

/** The headers that address the studio's press action, learned once in `beforeAll`. */
let pressAction: Record<string, string> = {};
const REVIEW_21 = '/venture/arca/review/arca/21';

/**
 * Learn how this studio addresses its press action: press the page's own Accept once, and stop that
 * request before it reaches the server, so it presses nothing.
 */
async function learnPressAction(browser: Browser) {
  const page = await browser.newPage();
  try {
    await testLogin(page, FOUNDER);
    await page.goto(REVIEW_21);
    let captured: Record<string, string> | null = null;
    await page.route(`**${REVIEW_21}`, async (route) => {
      const headers = route.request().headers();
      if (route.request().method() === 'POST' && headers['next-action']) {
        captured = headers;
        await route.abort();
      } else {
        await route.continue();
      }
    });
    await page.getByTestId('review-accept').click();
    await expect.poll(() => captured !== null).toBe(true);
    const h = captured! as Record<string, string>;
    pressAction = Object.fromEntries(['next-action', 'content-type', 'accept', 'origin'].filter((k) => h[k]).map((k) => [k, h[k]]));
  } finally {
    await page.close();
  }
}

/**
 * The studio's press door, called directly, as anyone can call a server action: with any arguments,
 * under this page's sign-in. Answers the server's whole reply, as text.
 */
async function callPressDoor(page: Page, args: unknown[]) {
  const r = await page.request.post(REVIEW_21, { headers: pressAction, data: JSON.stringify(args) });
  expect(r.status()).toBe(200);
  return r.text();
}

async function pictureSize(page: Page) {
  const img = page.getByTestId('review-picture');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  return img.evaluate((el: HTMLImageElement) => ({ name: el.dataset.picture, w: el.naturalWidth, h: el.naturalHeight }));
}

test.describe('journey 4: a founder reviews finished work and sends it back with a pinned note', () => {
  test('the screen has a preview link, four pictures at their sizes, and a plain summary', async ({ page }) => {
    await testLogin(page, FOUNDER);
    await page.goto('/venture/arca/review/arca/20');
    await expect(page.getByTestId('review-title')).toHaveText('The auctions view, finished.');
    await expect(page.getByTestId('review-summary')).toContainText('Your team built one new screen and changed none of the others.');
    await expect(page.getByTestId('review-preview')).toHaveAttribute('href', 'https://arca-pr-20.up.railway.app');

    const seen = [];
    for (const when of ['before', 'after'] as const) {
      for (const size of ['computer', 'phone'] as const) {
        await page.getByTestId(`review-show-${when}`).click();
        await page.getByTestId(`review-show-${size}`).click();
        await expect(page.getByTestId('review-picture')).toHaveAttribute('data-picture', `${when}-${size}`);
        seen.push(await pictureSize(page));
      }
    }
    expect(seen).toEqual([
      { name: 'before-computer', w: 1440, h: 1000 },
      { name: 'before-phone', w: 393, h: 851 },
      { name: 'after-computer', w: 1440, h: 1000 },
      { name: 'after-phone', w: 393, h: 851 },
    ]);
  });

  test('a spot clicked on the phone "after" picture becomes one note, recorded once, naming the picture and the spot', async ({ page }) => {
    await testLogin(page, FOUNDER);
    await page.goto('/venture/arca/review/arca/20');
    await page.getByTestId('review-show-after').click();
    await page.getByTestId('review-show-phone').click();
    await expect(page.getByTestId('review-sendback')).toBeDisabled();

    const shot = page.getByTestId('review-shot');
    const box = (await shot.boundingBox())!;
    await shot.click({ position: { x: box.width * 0.8, y: box.height * 0.4 } });
    await expect(page.getByTestId('review-pin-1')).toBeVisible();
    await page.getByTestId('review-note-text-1').fill('The button is cut off here');
    await expect(page.getByTestId('review-sendback')).toContainText('Send it back with my 1 note');
    await page.screenshot({ path: `${SHOTS}/40-review-pinned.png`, fullPage: true });

    await page.getByTestId('review-sendback').click();
    await expect(page.getByTestId('review-state')).toHaveText('Sent back');
    await expect(page.getByTestId('review-accept')).toHaveCount(0);

    const recorded = presses(20);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ by: FOUNDER, decision: 'sent-back' });
    expect(recorded[0].note).toMatch(/^1\. On the "after" picture, on a phone, \d+% across and \d+% down: The button is cut off here$/);

    // The stand-in collects exactly one Note, with the picture and the spot.
    const got = await collect(standIn);
    expect(got.signOffs).toEqual([]);
    expect(got.presses).toEqual([expect.objectContaining({ venture: 'arca', repo: 'arca', number: 20, action: 'send-back', by: FOUNDER, byJohn: false, note: recorded[0].note })]);

    // Still sent back when the page is opened again, with nothing left to press.
    await page.reload();
    await expect(page.getByTestId('review-screen')).toHaveAttribute('data-state', 'sent-back');
    await expect(page.getByTestId('review-accept')).toHaveCount(0);
    await expect(page.getByTestId('review-sent-note')).toContainText('The button is cut off here');
  });
});

test.describe('journey 5: a founder signs off, John approves', () => {
  test("a founder's Accept is their sign-off, waiting for John, and the stand-in collects no press", async ({ page }) => {
    await testLogin(page, FOUNDER);
    await page.goto('/venture/arca/review/arca/21');
    await page.getByTestId('review-accept').click();
    await expect(page.getByTestId('review-signed-by')).toHaveText('Signed off by you');
    await expect(page.getByTestId('review-decision')).toContainText('Waiting for John');
    expect(presses(21).map((p) => p.decision)).toEqual(['signed-off']);

    // Nothing for Archon. The sign-off comes in its own list, for Telegram's card text only.
    const got = await collect(standIn);
    expect(got.presses).toEqual([]);
    expect(got.signOffs).toEqual([expect.objectContaining({ repo: 'arca', number: 21, action: 'accept', by: FOUNDER, byJohn: false })]);
  });

  test('the founder calling Approve directly is refused, and nothing is recorded', async ({ page }) => {
    await testLogin(page, FOUNDER);
    for (const action of ['approve', 'reject', 'try-again', 'split']) {
      expect(await callPressDoor(page, ['arca', 'arca', 21, action, '', null])).toContain(ONLY_JOHN);
    }
    expect(presses(21).map((p) => p.decision)).toEqual(['signed-off']);
    expect(await collect(standIn)).toEqual({ ok: true, message: '0 presses, 0 sign-offs.', presses: [], signOffs: [], more: false });
  });

  test('John approves once; the stand-in collects it and answers; the card shows the result, and a second press is out of date', async ({ page, browser }) => {
    await testLogin(page, JOHN);
    await page.goto('/venture/arca/review/arca/21');
    await expect(page.getByTestId('review-signed-by')).toContainText('Signed off by');

    // A second screen of John's, open on the same card before he approves on the first.
    const other = await browser.newPage();
    await testLogin(other, JOHN);
    await other.goto('/venture/arca/review/arca/21');
    await expect(other.getByTestId('review-accept')).toBeVisible();

    await page.getByTestId('review-accept').click();
    await expect(page.getByTestId('review-state')).toHaveText('Approved · waiting for the factory');
    await expect(page.getByTestId('review-accept')).toHaveCount(0);

    await other.getByTestId('review-accept').click();
    await expect(other.getByTestId('review-msg')).toHaveText(OUT_OF_DATE);
    await expect(other.getByTestId('review-accept')).toHaveCount(0);
    await other.close();

    // The stand-in collects one Approve, John's, and says it is done.
    const got = await collect(standIn);
    expect(got.signOffs).toEqual([]);
    expect(got.presses).toEqual([expect.objectContaining({ repo: 'arca', number: 21, action: 'approve', by: JOHN, byJohn: true })]);
    expect((await answerPress(standIn, got.presses[0].id, 'done', 'Made part of ARCA.')).status()).toBe(200);

    await page.reload();
    await expect(page.getByTestId('review-state')).toHaveText('Part of the product');
    await expect(page.getByTestId('review-answer')).toHaveText('Made part of ARCA.');
    await expect(page.getByTestId('review-accept')).toHaveCount(0);
    await expect(page.getByTestId('review-sendback')).toHaveCount(0);

    expect(presses(21).map((p) => [p.decision, p.by])).toEqual([['signed-off', FOUNDER], ['approved', JOHN]]);
    expect((await collect(standIn)).presses).toEqual([]);
  });

  test("the founder sees the factory's result too, with no buttons", async ({ page }) => {
    await testLogin(page, FOUNDER);
    await page.goto('/venture/arca/review/arca/21');
    await expect(page.getByTestId('review-state')).toHaveText('Part of the product');
    await expect(page.getByTestId('review-decision')).toContainText('Approved by John');
    await expect(page.getByTestId('review-accept')).toHaveCount(0);
  });
});

test.describe('journey 5: a press reported from Telegram also shows here', () => {
  test.beforeAll(async ({ browser }, info) => {
    await putReviewCards(browser, String(info.project.use.baseURL));
    await drain(standIn);
  });

  test("John's tap on Telegram settles the card here: it shows what happened, and loses its buttons", async ({ page }) => {
    const r = await reportTelegram(standIn, { repo: 'arca', number: 20, action: 'reject', at: new Date().toISOString(), message: 'Rejected on Telegram.' });
    expect(r.status()).toBe(200);

    await testLogin(page, FOUNDER);
    await page.goto('/venture/arca/review/arca/20');
    await expect(page.getByTestId('review-state')).toHaveText('Rejected');
    await expect(page.getByTestId('review-decision')).toContainText('Rejected by John on Telegram');
    await expect(page.getByTestId('review-answer')).toHaveText('Rejected on Telegram.');
    await expect(page.getByTestId('review-accept')).toHaveCount(0);
    // It was done on Telegram, so there is nothing for the box to collect.
    expect(await collect(standIn)).toMatchObject({ presses: [], signOffs: [] });
  });
});

test.describe("journey 6: founder A can't press founder B's work", () => {
  test.beforeAll(async ({ browser }, info) => {
    rmSync(PRESSES, { force: true });
    await putReviewCards(browser, String(info.project.use.baseURL));
    await drain(standIn);
  });

  test("ARCA's founder calling the press door with THE RESET's card gets the missing-card answer, and nothing is recorded", async ({ page, browser }) => {
    await testLogin(page, FOUNDER);
    const call = (args: unknown[]) => callPressDoor(page, args);

    // Under ARCA, naming THE RESET's card: the same answer, word for word, as a card that does not exist.
    const theirs = await call(['arca', 'thereset-platform', 5, 'stop', '', null]);
    const missing = await call(['arca', 'arca', 999, 'stop', '', null]);
    expect(theirs).toContain(NOT_FOUND);
    expect(theirs).toBe(missing);
    // Under THE RESET itself: refused before anything is read.
    expect(await call(['the-reset', 'thereset-platform', 5, 'stop', '', null])).toContain('You do not have access to this venture.');
    expect(await call(['the-reset', 'thereset-platform', 5, 'send-back', 'Let me in', null])).toContain('You do not have access to this venture.');

    expect(presses(5)).toEqual([]);
    expect(await collect(standIn)).toMatchObject({ presses: [], signOffs: [] });

    // THE RESET's card is unchanged: John still finds it waiting.
    const john = await browser.newPage();
    await testLogin(john, JOHN);
    await john.goto('/venture/the-reset/review/thereset-platform/5');
    await expect(john.getByTestId('review-screen')).toHaveAttribute('data-state', 'finished');
    await expect(john.getByTestId('review-accept')).toBeVisible();
    await john.close();
  });
});

test.describe("a founder sees only their own venture's work", () => {
  test("THE RESET's card, typed in under ARCA, gets the same answer as a card that does not exist", async ({ page }) => {
    await testLogin(page, FOUNDER);
    const theirs = await page.goto('/venture/arca/review/thereset-platform/5');
    const theirsSaid = await page.getByTestId('review-not-here').innerHTML();
    const nothing = await page.goto('/venture/arca/review/arca/999');
    const nothingSaid = await page.getByTestId('review-not-here').innerHTML();
    expect(theirs?.status()).toBe(nothing?.status());
    expect(theirsSaid).toBe(nothingSaid);
    await expect(page.getByTestId('review-screen')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('check-in screen');
  });

  test("THE RESET's own address is refused, and its pictures answer like missing ones", async ({ page }) => {
    await testLogin(page, FOUNDER);
    await page.goto('/venture/the-reset/review/thereset-platform/5');
    await expect(page.getByTestId('review-screen')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('check-in screen');

    const theirs = await page.request.get('/venture/the-reset/review/thereset-platform/5/picture/after-phone');
    const crossed = await page.request.get('/venture/arca/review/thereset-platform/5/picture/after-phone');
    const missing = await page.request.get('/venture/arca/review/arca/999/picture/after-phone');
    expect([theirs.status(), crossed.status(), missing.status()]).toEqual([404, 404, 404]);
    expect(await crossed.text()).toBe(await missing.text());
  });
});

test.describe("the planning box's door", () => {
  test('is outside the sign-in gate, and keeps nothing unsigned or wrongly signed', async ({ request }) => {
    const card = JSON.stringify({ kind: 'card', repo: 'arca', number: 20, state: 'finished', sentAt: new Date().toISOString(), title: 'Not from the box' });
    const unsigned = await request.post('/api/factory', { data: card, headers: { 'content-type': 'application/json' }, maxRedirects: 0 });
    expect(unsigned.status()).toBe(401);
    const forged = await sendToDoor(request, card, 'not-the-secret');
    expect(forged.status()).toBe(401);
    expect(await forged.json()).toEqual({ ok: false, message: 'The signature does not match. Nothing was kept.' });
  });

  test('refuses a card that names a venture its repository does not belong to', async ({ request }) => {
    const card = JSON.stringify({ kind: 'card', venture: 'arca', repo: 'thereset-platform', number: 5, state: 'finished', sentAt: new Date().toISOString(), title: 'Moved' });
    const r = await sendToDoor(request, card);
    expect(r.status()).toBe(422);
  });
});

test.describe("John's parts never reach a founder's browser", () => {
  // The cards as the factory sent them, still waiting, so John's decision panel is drawn.
  test.beforeAll(async ({ browser }, info) => {
    rmSync(PRESSES, { force: true });
    await putReviewCards(browser, String(info.project.use.baseURL));
  });

  test('the founder page holds no dollar figure, no "What to do next" and no Archon link', async ({ page }) => {
    await testLogin(page, FOUNDER);
    // The server's whole answer, including the data the page hydrates from, not only what is drawn.
    const html = await (await page.request.get('/venture/arca/review/arca/20')).text();
    expect(html).toContain('The auctions view');
    for (const re of JOHN_ONLY) expect(html, `the founder's page matches ${re}`).not.toMatch(re);

    await page.goto('/venture/arca/review/arca/20');
    await expect(page.getByTestId('review-screen')).toBeVisible();
    const drawn = await page.content();
    for (const re of JOHN_ONLY) expect(drawn, `the drawn page matches ${re}`).not.toMatch(re);
    const read = await page.locator('body').innerText();
    for (const re of JOHN_ONLY_READ) expect(read, `what the founder reads matches ${re}`).not.toMatch(re);
    const links = await page.locator('a').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href).join(' '));
    expect(links).not.toMatch(/archon/i);
  });

  test('John sees what it cost, what to do next, and the run', async ({ page }) => {
    await testLogin(page, JOHN);
    await page.goto('/venture/arca/review/arca/20');
    await expect(page.getByTestId('review-cost')).toHaveText('$3.40 so far, of a $25 budget');
    await expect(page.getByTestId('review-next-step')).toContainText('What to do next');
    await expect(page.getByTestId('review-run').locator('a')).toHaveAttribute('href', /archon/);
  });
});

test.describe('journey 7: the factory goes quiet', () => {
  test.beforeAll(async ({ browser }, info) => {
    rmSync(PRESSES, { force: true });
    await putReviewCards(browser, String(info.project.use.baseURL));
    await drain(standIn);
  });

  test('after five minutes without a report the card says so and its buttons are off; when it reports again they come back', async ({ page, browser }) => {
    await testLogin(page, JOHN);
    await page.goto(REVIEW_21);
    await expect(page.getByTestId('review-quiet')).toHaveCount(0);
    await expect(page.getByTestId('review-accept')).toBeEnabled();

    // The stand-in's last report, signed four minutes and 58 seconds ago: quiet two seconds from now.
    expect((await reportHeartbeat(standIn, Date.now() - 298_000)).status()).toBe(200);
    await expect.poll(async () => {
      await page.reload();
      return page.getByTestId('review-quiet').count();
    }, { timeout: 15_000 }).toBe(1);
    await expect(page.getByTestId('review-quiet')).toHaveText(/^The factory hasn't reported since \d\d:\d\d\. These may be out of date\.$/);
    await expect(page.getByTestId('review-accept')).toBeDisabled();
    await expect(page.getByTestId('review-sendback')).toBeDisabled();
    await expect(page.getByTestId('review-off')).toHaveText('The buttons are off until the factory reports again, because a decision made now would not reach it.');
    await page.screenshot({ path: `${SHOTS}/42-review-quiet.png`, fullPage: true });

    // Pressed anyway, straight at the studio's press door: refused, and nothing is recorded.
    const answer = await callPressDoor(page, ['arca', 'arca', 21, 'accept', '', null]);
    expect(answer).toMatch(/The factory hasn't reported since \d\d:\d\d, so nothing was recorded\./);
    expect(presses(21)).toEqual([]);
    expect(await collect(standIn)).toMatchObject({ presses: [], signOffs: [] });

    // Every other list of the founder's cards says it too: the desk, "What happened", and a card's
    // detail on the Tickets screen.
    const founder = await browser.newPage();
    await testLogin(founder, FOUNDER);
    const QUIET = /The factory hasn't reported since \d\d:\d\d\. These may be out of date\./;
    await founder.goto('/venture/arca');
    await expect(founder.getByTestId('waiting-cards-quiet')).toHaveText(QUIET);
    await founder.goto('/venture/arca/activity');
    await expect(founder.getByTestId('activity-cards-quiet')).toHaveText(QUIET);
    await founder.goto('/venture/arca/tickets?filter=needs');
    await founder.getByTestId('tickets-row-ARCA-070').click();
    await expect(founder.getByTestId('detail-card-quiet')).toHaveText(QUIET);

    // The stand-in reports again.
    expect((await reportHeartbeat(standIn)).status()).toBe(200);
    await page.reload();
    await expect(page.getByTestId('review-quiet')).toHaveCount(0);
    await expect(page.getByTestId('review-off')).toHaveCount(0);
    await expect(page.getByTestId('review-accept')).toBeEnabled();
    await founder.goto('/venture/arca');
    await expect(founder.getByTestId('waiting-on-you')).toBeVisible();
    await expect(founder.getByTestId('waiting-cards-quiet')).toHaveCount(0);
    await founder.close();
  });
});

test('the Review screen at a phone width keeps its buttons in reach and the page inside the screen', async ({ page, browser }, info) => {
  await page.setViewportSize({ width: 393, height: 851 });
  await testLogin(page, FOUNDER);
  rmSync(PRESSES, { force: true });
  await putReviewCards(browser, String(info.project.use.baseURL));
  await page.goto('/venture/arca/review/arca/21');
  await expect(page.getByTestId('review-picture')).toHaveAttribute('data-picture', 'after-phone');
  const accept = (await page.getByTestId('review-accept').boundingBox())!;
  expect(accept.y + accept.height, 'Sign it off is below the bottom of the phone').toBeLessThanOrEqual(851);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(wide, 'the page is wider than the phone').toBeLessThanOrEqual(393);
  await page.screenshot({ path: `${SHOTS}/41-review-phone.png`, fullPage: true });
});
