import { test, expect } from '@playwright/test';
import { boxOf, testLogin } from './helpers';

/**
 * The desk (FB-128).
 *
 * The screen a founder opens and leaves open. What is asserted here is the **order** — which is the
 * argument, and is contractual — plus the three properties that can be quietly wrong: that one count
 * reaches the summary, the banner and the rail's badge; that the degraded strip sits below anything
 * the founder must act on; and that the prompt bar carries words without filing anything.
 */

const JOHN = 'john.gallagher@wealthcx.com';
const SHOTS = 'e2e/__screenshots__';

test.describe('the desk', () => {
  test.beforeEach(async ({ page }) => {
    await testLogin(page, JOHN);
    await page.goto('/venture/arca');
  });

  test('the sections run in the design’s order', async ({ page }) => {
    // The order is the argument: what is happening, what waits on me, what my team did, is any of
    // it working. A dashboard that shuffles those is a dashboard that answers a different question.
    const order = await page.evaluate(() => {
      const ids = ['desk-summary', 'prompt-bar', 'office-plate', 'lane-activity', 'waiting-on-you', 'dept-surfaces'];
      return ids
        .map((id) => {
          const el = document.querySelector(`[data-testid="${id}"]`);
          return el ? { id, top: el.getBoundingClientRect().top + window.scrollY } : null;
        })
        .filter((x): x is { id: string; top: number } => x !== null);
    });
    expect(order.map((o) => o.id)).toEqual(['desk-summary', 'prompt-bar', 'office-plate', 'lane-activity', 'waiting-on-you', 'dept-surfaces']);
    expect(order.map((o) => o.top)).toEqual([...order.map((o) => o.top)].sort((a, b) => a - b));

    await page.screenshot({ path: `${SHOTS}/20-desk.png`, fullPage: true });
  });

  test('the summary and the banner are one count', async ({ page }) => {
    // FB-099 is what happens when two surfaces answer "how much is waiting?" from different
    // knowledge: a badge saying 15 over columns saying 0.
    const summary = (await page.getByTestId('desk-summary').textContent()) ?? '';
    const inSummary = summary.match(/(\d+)\s+decisions?\s+waits?\s+on you/)?.[1] ?? '0';

    const banner = page.getByTestId('blocker-banner');
    if (await banner.count()) expect((await banner.textContent()) ?? '').toContain(`${inSummary} item`);
    else expect(inSummary).toBe('0');
  });

  test('the rail’s badge, the desk’s sentence and the badge’s destination are one number', async ({ page }) => {
    // FB-149. The badge used to count open work only, because its destination could not list an
    // external send — while the desk's sentence counted sends too. Tickets lists sends now, so all
    // three state one count. The badge's own row is where it leads, so that is what is followed.
    const badge = page.getByTestId('rail-needs-badge');
    const shown = (await badge.count()) ? ((await badge.textContent()) ?? '').trim() : '0';

    const summary = (await page.getByTestId('desk-summary').textContent()) ?? '';
    const inSummary = summary.match(/(\d+)\s+decisions?\s+waits?\s+on you/)?.[1] ?? '0';
    expect(shown).toBe(inSummary);

    await page.goto('/venture/arca/tickets?filter=needs');
    const there = ((await page.getByTestId('tickets-filter-needs').textContent()) ?? '').match(/(\d+)/)?.[1] ?? '0';
    expect(shown).toBe(there);
  });

  test('what could not be read sits below what must be acted on', async ({ page }) => {
    // A condition that clears on its own must never push the one item a founder is blocking down
    // the page. If the fixtures produce no failures there is nothing to place, which is also right.
    const strip = page.getByTestId('degraded-strip');
    if ((await strip.count()) === 0) return;

    const tops = await page.evaluate(() => {
      const y = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? el.getBoundingClientRect().top + window.scrollY : null;
      };
      return { strip: y('[data-testid="degraded-strip"]'), brief: y('[data-testid="blocker-banner"]') };
    });
    if (tops.brief !== null && tops.strip !== null) expect(tops.strip).toBeGreaterThan(tops.brief);
  });

  test('the head names the room, and says the venture once (FB-203, item 2)', async ({ page }) => {
    // The page was headed ARCA, which is the one thing a founder already knows: they chose the
    // venture to get here and the rail says it on every screen. The heading names where they are;
    // the venture, what it is and how it is doing sit above it in three words.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('The desk');
    // The meta sits on the heading's own baseline rather than under it. Signed in as Bruntsfield
    // rather than as ARCA's founder, so it names them — "Founder: you" is what their own founder
    // reads (FB-100, item 7: the studio does not introduce someone to themselves).
    const meta = page.getByTestId('board-founder');
    await expect(meta).toContainText('Founder: Founder');
    await expect(meta).toContainText('updated');
    await expect(meta.getByTestId('refresh')).toBeVisible();

    // The ACTIVE pill went with it. The eyebrow already says the status, and a pill repeating the
    // word beside it teaches a founder that the studio's pills carry nothing.
    // Scoped to the head. Other ACTIVE pills further down the page belong to rows about something
    // else, and those still earn their place — this is about the one that sat beside the title and
    // repeated the eyebrow directly above it.
    const pills = await page.locator('.desk-head .tag').allInnerTexts();
    expect(pills.filter((t) => /^active$/i.test(t.trim()))).toEqual([]);
    // And so did "Your team — AI working on this venture's own machine, around the clock."
    await expect(page.getByTestId('team-intro')).toHaveCount(0);
  });

  test('the summary opens with what the venture is (FB-203, item 3)', async ({ page }) => {
    // From the manifest, never invented: a description is a fact about the venture, and writing one
    // for a founder would be the studio telling them what their own company is. arca's manifest
    // carries one, so the sentence leads with it and then reaches the counts.
    await expect(page.getByTestId('desk-summary')).toContainText('ARCA gives collectors one place');
    await expect(page.getByTestId('desk-summary')).toContainText('wait on you');
  });

  test('“Decide now” lands on the work it just counted', async ({ page }) => {
    // The banner used to link to an anchor sitting above the external-approval cards alone. On a
    // venture whose waiting items are all open pull requests — the common case — a founder pressed
    // it and was scrolled past the office to an empty space.
    const banner = page.getByTestId('blocker-banner');
    if ((await banner.count()) === 0) return;
    // FB-203, item 4 made the whole banner the click target, so the href is on the banner and
    // "Decide now →" is the label pushed to its right rather than the only live part of the line.
    await expect(banner).toHaveAttribute('href', /#waiting-on-you$/);
    await expect(page.getByTestId('blocker-decide')).toBeVisible();

    const section = page.getByTestId('waiting-on-you');
    await expect(section).toBeVisible();
    // It holds the work, not an empty heading.
    const rows = section.getByTestId('waiting-queue').locator('li');
    const empty = section.getByTestId('waiting-queue-empty');
    expect((await rows.count()) + (await empty.count())).toBeGreaterThan(0);
  });

  test('the queue is an index, and admits what it is not showing (FB-203, item 10)', async ({ page }) => {
    const section = page.getByTestId('waiting-on-you');
    // A serif section heading, not an 11px uppercase label — the design reserves those for column
    // heads and eyebrows, and this is a section like "The office" above it.
    await expect(section.getByRole('heading', { level: 2 })).toHaveText('Waiting on you');
    await expect(section.getByTestId('waiting-all')).toBeVisible();

    const rows = section.getByTestId('waiting-queue').locator('li');
    const shown = await rows.count();
    expect(shown).toBeLessThanOrEqual(4);
    // A capped list that does not say it is capped quietly hides a founder's decisions.
    const more = section.getByTestId('waiting-queue-more');
    if (await more.count()) await expect(more).toContainText(/\d+ more waiting on you/);
  });

  test('both kinds of decision survive the cap (FB-203, item 10)', async ({ page }) => {
    // External sends lead the queue on purpose (FB-183: nothing leaves the company without one).
    // With a cap of four and six sends waiting, every piece of finished work fell off the desk —
    // including the pull requests the amber banner had just counted, on the screen the banner sends
    // a founder to. `deskQueue` reserves the last row; this asserts the result on a real page.
    const rows = page.getByTestId('waiting-queue').locator('li');
    const ids = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
    const sends = ids.filter((i) => i.startsWith('waiting-external-'));
    const work = ids.filter((i) => i && !i.startsWith('waiting-external-'));
    expect(sends.length, 'no external send on a desk that has them').toBeGreaterThan(0);
    expect(work.length, 'the founder’s finished work fell off the desk').toBeGreaterThan(0);
  });

  test('a waiting row is one target, and the arrow rides the wait (FB-203, item 10)', async ({ page }) => {
    const row = page.getByTestId('waiting-queue').locator('li').first();
    const link = row.locator('a');
    // One link, covering the row — not a sentence with a two-word link at the end of it.
    await expect(link).toHaveCount(1);
    await expect(row).not.toContainText('Decide →');
    await expect(row).toContainText(/waiting/);
  });

  test('a surface is a column, not a card (FB-203, item 11)', async ({ page }) => {
    const surfaces = page.getByTestId('dept-surfaces');
    await expect(surfaces.getByRole('heading', { level: 2 })).toHaveText('The company, by surface');
    // The ACTIVE pills are gone: three of them, all saying the same word, under an eyebrow that
    // already says ACTIVE.
    await expect(surfaces.locator('.tag')).toHaveCount(0);
    // And the provenance sentence is printed once at most, beside the one figure that needs it,
    // rather than once per surface.
    const provenance = (await surfaces.innerText()).split('Limit set in the studio').length - 1;
    expect(provenance).toBeLessThanOrEqual(1);
  });

  test('the studio marks state one way, everywhere (FB-210)', async ({ page }) => {
    // `⚠` and `●` survived on nine screens after FB-203 turned the desk's marks into squares, so the
    // studio marked state two ways depending on which screen you were on. An emoji is a different
    // typeface at a size nobody chose, and it does not take the tone colour — a `⚠` beside amber
    // text is whatever amber the vendor picked.
    for (const path of ['/venture/arca', '/venture/arca/activity', '/venture/arca/knowledge', '/venture/arca/tickets']) {
      await page.goto(path);
      const said = await page.locator('body').innerText();
      expect(said, `${path} still draws a glyph for a state`).not.toMatch(/[⚠●]/);
    }
  });

  test('a state mark carries its tone, and its word (FB-210)', async ({ page }) => {
    // Replacing the dot with a square and nothing else dropped `toneColor(item.tone)` on the feed,
    // and every square came out black — a record where a stopped run and a finished one looked
    // identical. Found by looking at it.
    await page.goto('/venture/arca/activity');
    const colours = await page.locator('.mark').evaluateAll((els) =>
      [...new Set(els.map((e) => getComputedStyle(e).backgroundColor))]);
    expect(colours.length, 'every state mark is the same colour').toBeGreaterThan(1);

    // And the word is still beside it. A state told only in colour is a state some readers never get.
    const rows = page.getByTestId('activity-item');
    await expect(rows.first()).toContainText(/Done|Running|Needs you|Stopped|Failed|Nothing to do|In progress/);
  });

  test('a prompt chip seeds the composer and files nothing', async ({ page }) => {
    await page.getByTestId('prompt-chip-0').click();
    await expect(page.getByTestId('prompt-bar-input')).toHaveValue('Break this document into tickets');

    await page.getByTestId('prompt-bar-send').click();
    await page.waitForURL(/\/composer/);
    // The words arrive already typed, and nothing has been filed: the composer's own gate is still
    // the only thing that turns them into work.
    await expect(page.getByTestId('composer-input')).toHaveValue('Break this document into tickets');
    await expect(page.getByTestId('composer-thread').getByTestId('composer-turn-0')).toHaveCount(0);
  });

  test('the office says it is not live rather than drawing an empty room', async ({ page }) => {
    // A frozen last-known scene would read as a team sitting still. FB-139 makes it live.
    // FB-139 replaced the placeholder with the live office. The fixture machine is reporting, so
    // this is the live plate — and the ledger beside it is the same events.
    await expect(page.getByTestId('office-live')).toBeVisible();
    await expect(page.getByTestId('office-ledger')).toBeVisible();
  });

  test('Scale says it is not connected, and counts what waits on it', async ({ page }) => {
    // FB-248: ARCA declares Meta for Scale, so the platform is no longer "tbd" — but no ad account
    // is linked, so "not connected" is still the truth and is still said.
    const scale = page.getByTestId('dept-scale-outcome');
    await expect(scale).toContainText('Meta ads · not connected yet');
    // No invented number: whatever it says is a count of real tickets.
    await expect(scale).toContainText(/(\d+ tickets? waiting on it|No tickets yet)/);
  });

  test('Scale opens the ads page, which says it is not connected before it shows anything', async ({ page }) => {
    // FB-248. The page shows a made-up example so a founder can see what connecting would give
    // them. The one unforgivable version of it is sample money read as theirs, so the "not
    // connected" line and the example's own label are both asserted, and nothing on it can spend.
    await page.getByTestId('dept-scale-ads').click();
    await page.waitForURL(/\/venture\/arca\/ads$/);
    await expect(page.getByTestId('ads-not-connected')).toContainText('Not connected');
    await expect(page.getByTestId('ads-example')).toContainText('made-up figures');
    await expect(page.getByTestId('ads-total-spend')).toHaveText('£1,149.89');
    await expect(page.getByTestId('ads-read-only')).toContainText('It only reads');
    await expect(page.getByTestId('ads-example').locator('button, form, input')).toHaveCount(0);
  });

  test('Sell says what went out, and never a number it does not have', async ({ page }) => {
    // FB-142: Sell is no longer silent — the studio holds every send it gated, so it can say what
    // went and when. What it cannot say is what happened NEXT: the ratified architecture sends from
    // the venture's own Workspace through `gmail.send`, which reports neither opens nor replies
    // without a read scope or a tracking pixel. So it says that, rather than printing a zero.
    const sell = page.getByTestId('dept-sell-outcome');
    await expect(sell).toContainText(/Last send|Nothing has been sent yet/);
    await expect(sell, 'a delivered/opened/replied count appeared from nowhere')
      .not.toContainText(/\d+ (delivered|opened|replied)/);
  });

  test('the outbox is a reference, and only to the venture’s own', async ({ page }) => {
    // The design's "Open your outbox ↗". The studio does not read the mailbox, so this is the one
    // place a founder can see the message itself.
    const outbox = page.getByTestId('sell-outbox');
    if (await outbox.count()) {
      await expect(outbox).toHaveAttribute('href', /^https:\/\/mail\.google\.com\/mail\/u\/[^/]+\/#sent$/);
      await expect(outbox).toHaveAttribute('rel', /noopener/);
    }
  });

  test('it fits a phone', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    await page.goto('/venture/arca');
    // The queue, not the desk summary: FB-160 stands the summary down on a phone, because the amber
    // banner beneath it already says what a founder is blocking. This line is a "the page has
    // rendered" signal, and it needs to be something the pocket studio actually carries.
    await expect(page.getByTestId('waiting-on-you')).toBeVisible();
    await expect(page.getByTestId('prompt-bar-input')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/20-mobile-desk.png`, fullPage: true });
  });
});

/**
 * FB-157 — the desk streams, and a fallback is not a place for controls.
 *
 * Putting the prompt bar in the Suspense fallback looked like a kindness: the founder could start
 * typing while the board loaded. They could not — a fallback is not hydrated — and for the moment
 * the boundary took to resolve there were TWO prompt bars in the document, one of them dead.
 */
test.describe('the desk streams (FB-157)', () => {
  test.beforeEach(async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
  });

  test('there is exactly one prompt bar, and it works', async ({ page }) => {
    await page.goto('/venture/arca');
    await expect(page.getByTestId('prompt-bar-input')).toHaveCount(1);
    await expect(page.getByTestId('prompt-chip-0')).toHaveCount(1);
    // Not just present — the one that is there is the live one.
    await page.getByTestId('prompt-chip-0').click();
    await expect(page.getByTestId('prompt-bar-input')).not.toHaveValue('');
  });

  test('the waiting shell is gone once the desk is in, not merely hidden', async ({ page }) => {
    await page.goto('/venture/arca');
    await expect(page.getByTestId('desk-summary')).toBeVisible();
    await expect(page.getByTestId('desk-waiting')).toHaveCount(0);
  });
});

/**
 * FB-139 — the office, live.
 *
 * The design's constraint is the whole ticket: *"The office is the feeling; this ledger is the
 * record. Same events, so they cannot disagree."*
 */
test.describe('the office (FB-139)', () => {
  test.beforeEach(async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
    await page.goto('/venture/arca');
  });

  test('every character on the plate has a row in the ledger, and the same state', async ({ page }) => {
    // Not two lists checked against each other — one list, mapped twice. This asserts that nothing
    // has grown a second one.
    const desks = await page.locator('[data-testid^="office-desk-"]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-testid')!.replace('office-desk-', '')));
    const rows = await page.locator('[data-testid^="office-row-"]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-testid')!.replace('office-row-', '')));
    expect(desks.length, 'the office is empty').toBeGreaterThan(0);
    expect(rows, 'the plate and the ledger draw different surfaces').toEqual(desks);
  });

  test('a raised hand means something is genuinely waiting on the founder', async ({ page }) => {
    // The hand must mean what the amber banner means. Every desk with a hand has a row saying so.
    const hands = await page.locator('[data-testid^="office-hand-"]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-testid')!.replace('office-hand-', '')));
    for (const id of hands) {
      await expect(page.getByTestId(`office-row-${id}`)).toHaveAttribute('data-state', 'waiting-on-you');
      await expect(page.getByTestId(`office-row-${id}`)).toContainText('waiting on you');
    }
  });

  test('the ledger stands beside the room, not under it (FB-203, item 7)', async ({ page }) => {
    // The pairing is the section's whole argument: the office is the feeling, the ledger is the
    // record. Run one under the other, a founder reads the room, scrolls, and meets the same three
    // surfaces again with nothing saying the second is an account of the first.
    //
    // At 1440 — the width CLAUDE.md rule 11 measures at — they share a row, so the ledger starts to
    // the right of the room rather than below it. The default project runs at 1280, where the pair
    // deliberately wraps and the ledger takes the full column: what decides this is whether the
    // ledger has room to be read, not what kind of device is asking. Both halves are asserted,
    // because the wrap is a decision and not a fallback.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(200);
    const room = await boxOf(page.getByTestId('office-plate'), 'the office');
    const ledger = await boxOf(page.getByTestId('office-ledger'), 'the ledger');
    expect(ledger.y, 'the ledger dropped below the room at desk width').toBeLessThan(room.y + room.height);
    expect(ledger.x, 'the ledger is not beside the room').toBeGreaterThan(room.x + room.width - 2);

    // Narrow the column and it stacks, full width, rather than squeezing the sentences.
    await page.setViewportSize({ width: 1100, height: 1000 });
    await page.waitForTimeout(200);
    const narrowRoom = await boxOf(page.getByTestId('office-plate'), 'the office');
    const narrowLedger = await boxOf(page.getByTestId('office-ledger'), 'the ledger');
    expect(narrowLedger.y).toBeGreaterThanOrEqual(narrowRoom.y + narrowRoom.height - 2);
    expect(narrowLedger.width).toBeGreaterThan(narrowRoom.width);
  });

  test('the ledger survives the real office loading (FB-203, item 7)', async ({ page }) => {
    // It used to live inside the plate, which is the FALLBACK. So on any venture whose real office
    // loaded, the ledger was not rendered at all — and the half of this pairing a screen-reader
    // user gets was the half that disappeared when the venture was healthiest. It is its own
    // component now, outside the fallback, which is what this asserts: the ledger is not a
    // descendant of the thing that gets replaced.
    await expect(page.getByTestId('office-plate').getByTestId('office-ledger')).toHaveCount(0);
    await expect(page.getByTestId('office-ledger')).toBeVisible();
  });

  test('“live from your machine” is never said over the stand-in (FB-203, item 7)', async ({ page }) => {
    // The first version put this label on the section heading, driven by whether the BOX is
    // reporting — a different question from whether the real room is on the screen. So it printed
    // "Live from your venture's own machine" directly above a drawing whose own note says "This is
    // a stand-in". A label that can be wrong about the thing beneath it is worse than none.
    const standIn = await page.getByTestId('office-plate').count();
    if (standIn > 0) await expect(page.getByTestId('office-live-label')).toHaveCount(0);
  });

  test('what your team did is its own section, with what it is (FB-203, item 9)', async ({ page }) => {
    const engine = page.getByTestId('lane-activity');
    await expect(engine.getByRole('heading', { level: 2 })).toHaveText('What your team did');
    // The promise that makes a four-row list trustworthy: what is missing is older, not hidden.
    await expect(engine).toContainText('nothing is swallowed');
    // Relative, not the recorded ISO string — and the footer says out loud why that stays honest.
    await expect(engine.getByTestId('lane-activity-more')).toContainText('re-reads itself once a minute');
    await expect(engine).not.toContainText('T00:00:00Z');
    // The card furniture the design objected to is gone: no repeat count, no venture tag.
    await expect(engine.locator('.tag')).toHaveCount(0);
  });

  test('every row says what its surface is doing — never a blank', async ({ page }) => {
    const rows = page.locator('[data-testid^="office-row-"]');
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      // FB-203, item 8: two columns, and the surface's name is the row's own header rather than a
      // cell. So the sentence is the row's only `td`, and "Since" is folded into it as a relative
      // span rather than being a third column of clock readings.
      await expect(rows.nth(i).locator('.ledger-doing')).not.toBeEmpty();
    }
  });

  test('the plate is drawn for the eye and the ledger is read aloud', async ({ page }) => {
    // Every state on the plate is written in words beside it; the pictures are hidden from a screen
    // reader because a picture is the feeling and the record is the half they get.
    const svg = page.locator('[data-testid^="pixel-agent-"]').first();
    await expect(svg).toHaveAttribute('aria-hidden', 'true');
    await expect(page.getByTestId('office-ledger')).toBeVisible();
  });
});

/**
 * FB-167 — one machine, one answer.
 *
 * The rail carried a placeholder reading *"Not live yet. Your team's desks appear here once this
 * venture's machine reports what they are doing"* three lines above its own engine line saying
 * *"Your team checked in 2 minutes ago"*. Two statements about the same machine, one screen apart,
 * contradicting each other on every venture page in production for weeks.
 *
 * Asserted at the level of the **page**, not either component, because neither component was wrong
 * on its own — that is exactly why it survived. The desk's office and the rail's engine were each
 * internally consistent and each told a different story about the same box.
 */
test.describe('the venture is alive, or it is not (FB-167)', () => {
  test.beforeEach(async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
  });

  for (const route of ['/venture/arca', '/venture/arca/tickets', '/venture/arca/knowledge']) {
    test(`${route} does not both claim and deny that the machine reports`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByTestId('rail')).toBeVisible();
      const text = await page.locator('body').innerText();

      const deniesItReports = /not live yet/i.test(text);
      const saysItReported = /checked in|is working|woke/i.test(text);
      expect(
        deniesItReports && saysItReported,
        `${route} says the machine is not live AND that it reported. One of them is wrong.`,
      ).toBe(false);
    });
  }

  test('the rail states the engine once, and nothing else in it answers the same question', async ({ page }) => {
    await page.goto('/venture/arca');
    const rail = page.getByTestId('rail');
    await expect(rail.getByTestId('rail-engine')).toHaveCount(1);
    // The placeholder that used to sit above it is gone, not merely reworded.
    await expect(rail).not.toContainText('Not live yet');
  });
});

/**
 * FB-178 — the desk is a page you read, not a page you scroll.
 *
 * Measured against the design at 1440×1000: the design's desk is ~1,900px; the live one was
 * **9,908px**, because it rendered a four-column board of every ticket on every surface — on ARCA
 * 73 of them, **37 already finished** — taking 4,634px, plus twenty run rows at 2,621px where the
 * design shows four.
 *
 * Asserted as a HEIGHT, because nothing else catches it. Every section was present, in the right
 * order, with correct data — `the sections run in the design's order` above passes either way. The
 * page was right and unusable, which is the FB-124 family, and only a measurement sees it.
 */
test.describe('the desk fits on a desk (FB-178)', () => {
  test.beforeEach(async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
    await page.goto('/venture/arca');
    await expect(page.getByTestId('desk-summary')).toBeVisible();
  });

  test('no finished ticket is rendered on the desk', async ({ page }) => {
    // The clearest symptom, and the clearest rule. Done work answers none of the desk's questions.
    await expect(page.getByTestId('col-done')).toHaveCount(0);
    await expect(page.locator('[data-testid^="col-"]'), 'the ticket board is back on the desk')
      .toHaveCount(0);
  });

  test('each surface still says what is in it, and where to go', async ({ page }) => {
    // Removing the board must not remove the SIGNAL. A founder still has to be able to see that a
    // surface exists, roughly how much is in it, and get to it in one press.
    const links = page.locator('[data-testid^="lane-open-"]');
    expect(await links.count(), 'no surface offers a way through to its queue').toBeGreaterThan(0);
    await expect(links.first()).toHaveAttribute('href', /\/venture\/arca\/tickets/);
  });

  test('a read failure is still stated — that signal was inside the block that went', async ({ page }) => {
    // `lane-error` lived in the removed markup. If the fixtures produce no failure there is nothing
    // to assert, which is also right; what must not happen is the element ceasing to exist.
    const errors = page.getByTestId('lane-error');
    if (await errors.count()) await expect(errors.first()).toBeVisible();
  });

  test('the whole page is a readable length', async ({ page }) => {
    // A RATCHET, not a design target. The desk measures 2,165px here against the design's ~1,900.
    //
    // The structural assertions above are the real guard; this one exists because the defect was a
    // page that grew without bound as a venture aged, and only a measurement sees that. Returning
    // the board would add about 4,600px and fail this immediately.
    //
    // This fixture holds SIX tickets, so what it cannot tell you is whether the desk stays this
    // length over a venture that has done real work — and a cap of four over six items renders the
    // same screen as no cap at all. `e2e/desk-at-scale.spec.ts` is the reading that answers that
    // (73 tickets, 1,773 run reports: 2,230px, sixty-five pixels more than this).
    // At 1440x1000, which is the viewport FB-178 and FB-186 both state their targets at. The
    // project's default is 1280x720, and a narrower viewport wraps more and measures TALLER -- so
    // the old reading was answering a question neither ticket asked.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/venture/arca');
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(h, `the desk is ${h}px at 1440x1000; it was 9,908px on production before FB-178`)
      .toBeLessThan(2_300);
  });
});

/**
 * Claude Design's rulings on the desk, 2026-09-02 (FB-182).
 *
 * Three of the five were implementable at once; the fourth needs a place to approve an external
 * send that is not the desk, and the fifth changes the ticket schema. Both are filed.
 */
test.describe('the desk answers Claude Design (FB-182)', () => {
  test.beforeEach(async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
    await page.goto('/venture/arca');
    await expect(page.getByTestId('desk-summary')).toBeVisible();
  });

  test('finished business is off the desk (FB-207)', async ({ page }) => {
    // FB-207: this property moved, and this test moved with it — which is what the version of this
    // comment written before the move insisted on. The desk's "Decided" section was the only place a
    // founder could see whether a completed approval's signature was genuine, forged, or made
    // against a proposal that changed afterwards (FB-046), and that is why two earlier instructions
    // to delete it were refused.
    //
    // What happened carries it now. The section is gone from the desk, and the assertion that it
    // does not simply vanish lives in `e2e/venture-activity.spec.ts` against its new home.
    await expect(page.getByTestId('approvals-decided'), 'the desk is carrying finished business again')
      .toHaveCount(0);
    await expect(page.getByTestId('approvals-attention')).toHaveCount(0);
  });

  test('the office says it is a stand-in, because it is one', async ({ page }) => {
    // Claude Design confirmed the room is the pixel-agents embed and allowed three figures as an
    // interim "ONLY if labelled as placeholder". Unlabelled, a founder cannot tell that what they
    // are looking at is a stand-in for something much richer.
    await expect(page.getByTestId('office-placeholder-note')).toContainText('stand-in');
  });

  test('a surface states a count and a door, not a breakdown of the queue', async ({ page }) => {
    // "20 waiting to be picked up · 14 being worked" restates the queue, which the banner and the
    // Tickets summary already count. The design's line is "14 tickets".
    //
    // FB-186 widened this from the door's own line to the whole card. Scoped to the line, it passed
    // while the card carried "4 waiting for your OK · 14 in progress" two lines above it — the rule
    // was being applied to one line and not to the thing it is a rule about.
    const card = page.getByTestId('dept-build');
    await expect(card).toContainText(/\d+ tickets?/);
    await expect(card, 'the card is restating the queue again').not.toContainText('waiting to be picked up');
    await expect(card, 'the card is restating the queue again').not.toContainText('waiting for your OK');
    await expect(card.getByTestId('lane-open-arca')).toBeVisible();
  });

  test('a surface says how much is in it exactly once', async ({ page }) => {
    // FB-186: the desk stated each surface twice as two blocks, and then each card stated its own
    // ticket count twice — once in the outcome sentence and again beside the door.
    const text = await page.getByTestId('dept-build').innerText();
    const counts = text.match(/\d+ tickets?/g) ?? [];
    expect(counts.length, `the count appears ${counts.length} times: ${counts.join(', ')}`).toBe(1);
  });
});

/**
 * FB-188 — the column beside the rail is the width the design draws into.
 *
 * The studio spent a month rendering a 1,080px design into a 766px column, because the 68rem
 * measure was set on the element that holds the rail as well as the content. Every screen with a
 * rail was taller than its design, and it read as too much content when it was partly too little
 * width.
 *
 * Pinned because it is invisible: nothing failed, every figure on every screen was correct, and the
 * only symptom was heights that no test asserts.
 */
test.describe('the reading column (FB-188)', () => {
  test('is the width the design draws into, not the rail plus the content', async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/venture/arca');
    const width = await page.evaluate(() => {
      // The reading column, which is `.venture-pane` since FB-203 rebuilt the shell as a grid. It
      // used to be a second <main> nested inside the page's own — two landmarks on every venture
      // page, and a column with no padding, so the desk began at the rail's edge.
      const pane = document.querySelector('.venture-pane');
      return pane ? Math.round(pane.getBoundingClientRect().width) : 0;
    });
    // The design's own block measures 1,080px at this viewport. 5% either way.
    expect(width, `the column is ${width}px; the design draws into 1,080px`).toBeGreaterThan(1026);
    expect(width, `the column is ${width}px; the design draws into 1,080px`).toBeLessThan(1134);
  });
});

/**
 * FB-149 — on a phone the rail is hidden, and the header's "Needs you" is the only one a founder sees.
 * It counted finished work across ventures and led to `/attention`, so ARCA's founder read 4 there
 * and 10 on the desk. A founder has one venture, so it is now that venture's number and list.
 */
test.describe('the header’s "Needs you" (FB-149)', () => {
  test('states the desk’s number on a phone, and leads to the list that holds it', async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
    // The desk's sentence stands down on a phone (FB-160), so it is read at desk width first.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/venture/arca');
    const summary = (await page.getByTestId('desk-summary').textContent()) ?? '';
    const onDesk = summary.match(/(\d+)\s+decisions?\s+waits?\s+on you/)?.[1];
    expect(onDesk, `the desk's sentence states no count: "${summary}"`).toBeDefined();

    await page.setViewportSize({ width: 393, height: 851 });
    await page.goto('/venture/arca');
    await expect(page.getByTestId('nav-attention-badge')).toHaveText(onDesk!);
    await page.getByTestId('topnav').getByRole('link', { name: /Needs you/ }).click();
    await expect(page).toHaveURL(/\/venture\/arca\/tickets\?filter=needs$/);
    const there = ((await page.getByTestId('tickets-filter-needs').textContent()) ?? '').match(/(\d+)/)?.[1];
    expect(there).toBe(onDesk);
  });

  test('a narrow window is unaffected — nothing binds below the measure', async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.goto('/venture/arca');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
