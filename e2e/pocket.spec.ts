import { test, expect } from '@playwright/test';
import { boxOf, inTopDownOrder, testLogin } from './helpers';

/**
 * FB-138 — the pocket studio.
 *
 * Runs in the `mobile` project (Pixel 5), so every case here is a phone.
 *
 * The line the ticket hangs on: *"Decisions work exactly as on the desk: read it, one press, grant
 * signed."* Not a cut-down view — the same authority. A founder who can only READ on a phone stays
 * the bottleneck until they get home.
 */
const JOHN = 'john.gallagher@wealthcx.com';
const SHOTS = 'e2e/__screenshots__';

test.describe('the pocket studio (FB-138)', () => {
  test.beforeEach(async ({ page }) => {
    await testLogin(page, JOHN);
  });

  test('one column, in the order a founder needs on a phone', async ({ page }) => {
    // Blocker → office → queue → prompt. At a desk the order is different because the eye scans a
    // wide page differently; this is the design's screen 11.
    await page.goto('/venture/arca');
    await expect(page.getByTestId('desk')).toBeVisible();

    // Measure a settled page. The desk streams (FB-157) and then hydrates, so a box read the instant
    // the shell arrives is a box for markup that is about to move — or for a node that is about to
    // be replaced, which measures as nothing at all. `inTopDownOrder` waits and retries, and reads
    // every position from one render (FB-191).
    const hasBanner = (await page.getByTestId('blocker-banner').count()) > 0;
    await inTopDownOrder([
      ['what you are blocking', page.getByTestId(hasBanner ? 'blocker-banner' : 'blocker-none')],
      ['what your team is doing', page.getByTestId('office-plate')],
      ['the queue', page.getByTestId('waiting-on-you')],
      ['the prompt', page.getByTestId('prompt-bar-input')],
    ]);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'the pocket studio scrolls sideways').toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${SHOTS}/20-pocket-studio.png`, fullPage: true });
  });

  test('"Decide →" goes to the decision, not to a query nobody reads', async ({ page }) => {
    // It was `?work=<repo>#<number>` — a parameter the desk ignores. The row the amber banner sends
    // a founder to did nothing at all when pressed.
    await page.goto('/venture/arca');
    // A pull request row specifically. FB-183 put external sends in this same queue, above the work
    // — nothing leaves the company without one — so "the first row" is no longer a pull request.
    const decide = page.locator('[data-testid^="waiting-decide-"]:not([data-testid^="waiting-decide-external-"])').first();
    // FB-203, item 10 deleted the words "Decide →" and made the whole row the target, with the
    // arrow riding on how long it has waited — because that is the reason to press it. So the
    // assertion is about where the row goes, which is the property that was broken when this test
    // was written and the only one worth pinning.
    await expect(decide).toHaveText(/waiting/);
    await decide.click();
    // FB-277: a factory card's row is finished work too, and its decision is made on its Review
    // screen rather than on the work page. Either way the row lands on the decision.
    await expect(page).toHaveURL(/\/venture\/arca\/(work|review)\/[^/]+\/\d+$/);
    await expect(page.locator('[data-testid="work-decision"], [data-testid="review-decision"]').first()).toBeVisible();
  });

  test('a founder can approve from a phone, through the same signed path', async ({ page }) => {
    await page.goto('/venture/arca/work/arca/10');
    const accept = page.getByTestId('work-accept');
    // Reachable and pressable at this width — a control that exists off-screen is not a decision.
    const box = await boxOf(accept, 'the Approve button');
    expect(box.x + box.width, 'the Approve button is off the side of the phone')
      .toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(box.height, 'the Approve button is not a thumb target').toBeGreaterThanOrEqual(32);
    await accept.click();
    // It reached the server and answered — this rig holds no write credential, so the honest
    // refusal is what proves the path, exactly as the desk's own test does.
    await expect(page.getByTestId('work-msg')).toBeVisible();
  });

  test('refusing still requires a note, on a phone as at a desk', async ({ page }) => {
    await page.goto('/venture/arca/work/arca/10');
    await page.getByTestId('work-sendback-open').click();
    const send = page.getByTestId('work-sendback');
    await expect(send, 'work can be sent back with no reason given').toBeDisabled();
    await page.getByTestId('work-note').fill('Not this quarter — the pricing page comes first.');
    await expect(send).toBeEnabled();
  });

  test('there is always a way back to the desk', async ({ page }) => {
    await page.goto('/venture/arca/work/arca/10');
    await page.getByTestId('work-back').click();
    await expect(page).toHaveURL(/\/venture\/arca$/);
  });

  test('the prompt bar opens the same composer', async ({ page }) => {
    await page.goto('/venture/arca');
    await page.getByTestId('prompt-bar-input').fill('Draft the pricing page');
    await page.getByTestId('prompt-bar-send').click();
    await page.waitForURL(/\/composer/);
    await expect(page.getByTestId('composer-input')).toHaveValue('Draft the pricing page');
  });
});

/**
 * FB-160 — what the pocket studio contains.
 *
 * FB-138 put the four sections in the design's order and left the rest of the desk underneath, on
 * purpose: hiding is not safe by guess, and the obvious rule would have taken the approval gate off
 * the phone. This is the decision about contents.
 *
 * The rule: the four the design names, plus everything a founder can act on, plus one press to the
 * rest. Nothing duplicated — one markup, sections stood down.
 */
test.describe('what the pocket studio contains (FB-160)', () => {
  test.beforeEach(async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
    await page.goto('/venture/arca');
  });

  test('the venture is named before anything else, not after the prompt', async ({ page }) => {
    // Everything the pocket order does not name falls to `order: 5`, and that included the title —
    // so a founder scrolled the whole screen before being told which venture they were looking at.
    await inTopDownOrder([
      ['the venture name', page.locator('.desk .pocket-0').first()],
      ['the blocker banner', page.getByTestId('blocker-banner')],
    ]);
  });

  test('the sections the design does not put on a phone are stood down', async ({ page }) => {
    await expect(page.getByTestId('dept-surfaces')).toBeHidden();
    await expect(page.getByTestId('desk-summary')).toBeHidden();
  });

  test('nothing a founder can act on is hidden', async ({ page }) => {
    // The queue, with its decisions — external sends included since FB-183 — and the thing that is
    // stuck, which the banner counts but does not name.
    await expect(page.getByTestId('waiting-on-you')).toBeVisible();
    await expect(page.getByTestId('blocker-banner')).toBeVisible();
    // FB-203, item 5: this was the "Where things stand" box. That box went, because three of its
    // four lines repeated the banner and the summary. Its blocked line did not repeat anything, so
    // it kept its place on the phone in the banner's own shape.
    await expect(page.getByTestId('desk-stuck').first()).toBeVisible();
    await expect(page.getByTestId('prompt-bar')).toBeVisible();
  });

  test('the banner gives the sentence the width of the phone (FB-203, item 4)', async ({ page }) => {
    // The fault this catches, in full: "Decide now →" held its place at the right of the row, the
    // sentence was left a column about fifteen characters wide, and one banner ran twelve lines
    // down a 393px screen. Every existing test passed — the banner was present, correct, linked,
    // and in the right place. Only looking at the picture found it.
    //
    // Asserted as a proportion rather than a pixel count, so it keeps holding as the copy and the
    // phone change: on a phone the sentence gets most of the box, and the action drops beneath it.
    // Measured through `boxOf`, which retries. A bare `boundingBox()` here returned null in a full
    // run and passed on its own — FB-191's flake exactly: React replaces the node while hydrating,
    // and a measurement taken across that swap reads a box that no longer exists.
    const banner = page.getByTestId('blocker-banner');
    const box = await boxOf(banner, 'the blocker banner');
    const line = await boxOf(banner.locator('.blocker-line'), 'the banner’s sentence');
    expect(line.width / box.width).toBeGreaterThan(0.6);
    // The action is under the sentence, not beside it.
    const decide = await boxOf(page.getByTestId('blocker-decide'), '“Decide now”');
    expect(decide.y).toBeGreaterThan(line.y + line.height - 2);
  });

  test('the whole desk is one press away, and one press back', async ({ page }) => {
    await page.getByTestId('pocket-more').click();
    await expect(page).toHaveURL(/\?full=1$/);
    await expect(page.getByTestId('dept-surfaces')).toBeVisible();
    await expect(page.getByTestId('desk-summary')).toBeVisible();

    await page.getByTestId('pocket-less').click();
    await expect(page).toHaveURL(/\/venture\/arca$/);
    await expect(page.getByTestId('dept-surfaces')).toBeHidden();
  });

  /**
   * The rule FB-158 and FB-136 both learned the hard way: a phone-only second copy of a section is
   * how two of every control end up in one document.
   */
  test('no section is rendered twice, in either mode', async ({ page }) => {
    for (const url of ['/venture/arca', '/venture/arca?full=1']) {
      await page.goto(url);
      // Scoped to the DESK's own sections, which is what the rule is about. The rail streams its
      // numbers behind a Suspense boundary (FB-151), so during the fallback the rail and its shell
      // are both in the document by design — that is FB-158's rule, with its own test, not this one.
      await expect(page.getByTestId('desk')).toBeVisible();
      const dupes = await page.evaluate(() => {
        const desk = document.querySelector('[data-testid="desk"]');
        if (!desk) return [['no desk', 0]] as [string, number][];
        const seen = new Map<string, number>();
        for (const el of desk.querySelectorAll('[data-testid]')) {
          const id = el.getAttribute('data-testid') as string;
          seen.set(id, (seen.get(id) ?? 0) + 1);
        }
        // `pixel-agent-<state>` is keyed on the agent's state, not on its desk, so three desks in
        // one state share an id. Decorative, aria-hidden, and not a section — noted, not fixed here.
        return [...seen].filter(([id, n]) => n > 1 && !id.startsWith('pixel-agent-'));
      });
      expect(dupes, `${url} renders these twice`).toEqual([]);
    }
  });
});
