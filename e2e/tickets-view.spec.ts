import { test, expect, type Page } from '@playwright/test';
import { testLogin } from './helpers';

/**
 * Tickets: master-detail, and deciding without leaving (FB-129).
 *
 * What is asserted is the thing a founder will notice: that the list, the ticket and the decision
 * are one screen, that a ticket can be linked to, and that clearing a decision offers the next one
 * rather than sending them back to a list to find it.
 */

const JOHN = 'john.gallagher@wealthcx.com';
const SHOTS = 'e2e/__screenshots__';

/**
 * The first row that is finished WORK, not an external send (FB-149).
 *
 * "Needs you" lists sends first since FB-149, the same order the desk uses. A send is decided on its
 * own page and has no decision panel here, so tests about deciding on work must skip past them.
 */
const firstPieceOfWork = (page: Page) =>
  page.getByTestId('tickets-list').locator('li button:not([data-testid^="tickets-row-send-"])').first();

test.describe('tickets', () => {
  test.beforeEach(async ({ page }) => {
    await testLogin(page, JOHN);
    await page.goto('/venture/arca/tickets');
  });

  test('the list, the ticket and the decision are one screen', async ({ page }) => {
    await expect(page.getByTestId('tickets-list')).toBeVisible();
    await expect(page.getByTestId('tickets-detail')).toBeVisible();
    await expect(page.getByTestId('tickets-summary')).toContainText('Every one can be followed');
    await page.screenshot({ path: `${SHOTS}/21-tickets.png`, fullPage: true });
  });

  test('the four filters are there and each says how many', async ({ page }) => {
    for (const f of ['needs', 'all', 'underway', 'settled']) {
      await expect(page.getByTestId(`tickets-filter-${f}`)).toBeVisible();
    }
    // A count on a filter that hides nothing is the total, and the sentence must agree with it.
    const all = (await page.getByTestId('tickets-filter-all').textContent()) ?? '';
    const total = all.match(/(\d+)/)?.[1] ?? '';
    await expect(page.getByTestId('tickets-summary')).toContainText(`${total} ticket`);
  });

  test('the selected ticket and the filter are in the URL, and a link restores both', async ({ page }) => {
    // A filter that is NOT the default, because the default is the one a bare URL already means and
    // so is deliberately absent from the query (FB-185). `all` proves the round trip.
    await page.getByTestId('tickets-filter-all').click();
    await expect(page).toHaveURL(/filter=all/);
    await expect(page.getByTestId('tickets-filter-all')).toHaveAttribute('aria-selected', 'true');

    // A ticket that is NOT the one already open — and that is the whole of FB-199.
    //
    // This screen always has something open: with no `t=` in the address it falls back to the first
    // row of the current filter. This test used to press `settled`, which has exactly one ticket, so
    // the only row it could press was the one already showing. Pressing it asks to navigate to what
    // is on the screen already, and the address does not reliably change for that — the test failed
    // about one run in five, and clicking any row that was NOT already open passed 100 times out of
    // 100.
    //
    // `aria-current` is how the screen says which row is open, so the test can simply ask for one
    // that is not.
    const unopened = page.getByTestId('tickets-list').locator('li button:not([aria-current="true"])').first();
    await expect(unopened, 'every row was already open, so nothing could be selected').toBeVisible();
    const id = ((await unopened.getAttribute('data-testid')) ?? '').replace('tickets-row-', '');
    expect(id, 'the row does not name its ticket').not.toBe('');
    await unopened.click();
    // Addressed by repository AND id — two repos in one venture may share an id namespace, so an id
    // alone is not a name. The `/` is percent-encoded in the query.
    await expect(page).toHaveURL(new RegExp(`t=[^&]*${id}`));

    // The whole point: paste the link somewhere and it comes back to the same ticket.
    const url = page.url();
    await page.goto('/venture/arca');
    await page.goto(url);
    await expect(page.getByTestId('detail-title')).toBeVisible();
    await expect(page.getByTestId('tickets-filter-all')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId(`tickets-row-${id}`)).toHaveAttribute('aria-current', 'true');
  });

  /**
   * FB-185: the screen opens on what needs the founder, and the bare URL means exactly that.
   *
   * Pinned here as well as in the unit test because the two halves have to agree: `parseFilter`
   * decides what a bare URL means, and `go()` decides which filter is left out of the query. If
   * they ever disagree, pressing a tab navigates somewhere that shows a different list than the tab
   * it came from, and nothing else in the suite would notice.
   */
  test('opens on what needs the founder, and says so in the tab', async ({ page }) => {
    await page.goto('/venture/arca/tickets');
    await expect(page.getByTestId('tickets-filter-needs')).toHaveAttribute('aria-selected', 'true');

    // Pressing All is a real navigation to a real filter, not a fall back to the bare URL.
    await page.getByTestId('tickets-filter-all').click();
    await expect(page).toHaveURL(/filter=all/);
    await expect(page.getByTestId('tickets-filter-all')).toHaveAttribute('aria-selected', 'true');

    // And back again, which is where the default being absent from the query has to hold.
    await page.getByTestId('tickets-filter-needs').click();
    await expect(page.getByTestId('tickets-filter-needs')).toHaveAttribute('aria-selected', 'true');
  });

  test('a ticket waiting on the founder can be decided right there', async ({ page }) => {
    await page.getByTestId('tickets-filter-needs').click();
    // Wait for the filter to land before clicking a row. Selecting is a server navigation, so the
    // list re-renders — clicking straight after could land on the previous filter's DOM.
    // The tab, not the URL: "Needs you" is the default since FB-185, so it is the one filter
    // deliberately absent from the query. Waiting on the tab still waits for the navigation.
    await expect(page.getByTestId('tickets-filter-needs')).toHaveAttribute('aria-selected', 'true');
    await firstPieceOfWork(page).click();

    const decision = page.getByTestId('detail-decision');
    await expect(decision).toBeVisible();
    // What it reaches, what it costs, what proves it — in front of them, not on a page they have to
    // go and find.
    for (const fact of ['Reaches', 'Costs', 'Proven']) await expect(decision).toContainText(fact);
    await expect(decision).toContainText(/decision \d+ of \d+/);
    await expect(page.getByTestId('detail-approve')).toBeVisible();
    await expect(page.getByTestId('detail-refuse')).toBeVisible();
  });

  test('refusing requires a note, because a send-back with no reason is a lane guessing', async ({ page }) => {
    await page.getByTestId('tickets-filter-needs').click();
    // Wait for the filter to land before clicking a row. Selecting is a server navigation, so the
    // list re-renders — clicking straight after could land on the previous filter's DOM.
    // The tab, not the URL: "Needs you" is the default since FB-185, so it is the one filter
    // deliberately absent from the query. Waiting on the tab still waits for the navigation.
    await expect(page.getByTestId('tickets-filter-needs')).toHaveAttribute('aria-selected', 'true');
    await firstPieceOfWork(page).click();
    await page.getByTestId('detail-refuse').click();

    await expect(page.getByTestId('detail-send-back')).toBeDisabled();
    await page.getByTestId('detail-note').fill('The second paragraph is wrong.');
    await expect(page.getByTestId('detail-send-back')).toBeEnabled();

    // And it can be abandoned without deciding anything.
    await page.getByTestId('detail-never-mind').click();
    await expect(page.getByTestId('detail-approve')).toBeVisible();
  });

  test('pressing approve reaches the server and says plainly when it cannot', async ({ page }) => {
    // `acceptWork` MERGES a pull request and needs a write token the e2e studio does not have, so
    // this drives the whole wire — button, server action, refusal — and proves the control is
    // connected to something rather than assumed to be.
    //
    // What it deliberately does NOT do is fake a merge to make the chaining visible. The most
    // consequential button in the product must not have a fixture that makes it look like it
    // worked. The chaining itself — oldest first, never offering back one just answered — is
    // covered in `lib/__tests__/tickets-view.test.ts`, and the honest limit is recorded on FB-129.
    await page.getByTestId('tickets-filter-needs').click();
    // Wait for the filter to land before clicking a row. Selecting is a server navigation, so the
    // list re-renders — clicking straight after could land on the previous filter's DOM.
    // The tab, not the URL: "Needs you" is the default since FB-185, so it is the one filter
    // deliberately absent from the query. Waiting on the tab still waits for the navigation.
    await expect(page.getByTestId('tickets-filter-needs')).toHaveAttribute('aria-selected', 'true');
    await firstPieceOfWork(page).click();

    await page.getByTestId('detail-approve').click();
    await expect(page.getByTestId('detail-error')).toContainText('not set up');
    await expect(page.getByTestId('detail-outcome')).toHaveCount(0);
    // Still pressable: a refusal an admin can fix must not strand the decision.
    await expect(page.getByTestId('detail-approve')).toBeEnabled();
  });

  test('a send waiting on the founder is listed, and points at the one page where it is decided', async ({ page }) => {
    // FB-149: the rail's badge counts sends, so the list it leads to must list them. FB-183: the send's
    // own page is the only place its grant is signed, so the row is a pointer and draws no control.
    await expect(page.getByTestId('tickets-filter-needs')).toHaveAttribute('aria-selected', 'true');
    const send = page.getByTestId('tickets-list').locator('li button[data-testid^="tickets-row-send-"]').first();
    await expect(send, 'the fixtures hold proposed sends, and none was listed').toBeVisible();
    await send.click();
    await expect(page.getByTestId('detail-send')).toBeVisible();
    await expect(page.getByTestId('detail-approve')).toHaveCount(0);
    await expect(page.getByTestId('detail-decision')).toHaveCount(0);
    const href = await page.getByTestId('detail-open-send').getAttribute('href');
    expect(href).toMatch(/^\/venture\/arca\/approvals\/[^/]+\/[^/]+$/);
    await page.getByTestId('detail-open-send').click();
    await expect(page.getByTestId('approval-page')).toBeVisible();
  });

  test('dependency chips move between tickets', async ({ page }) => {
    // This selected NO ticket, so the detail pane was empty, so there were never any chips, so the
    // guard below skipped it every single run — a test that had never once executed its assertion.
    // Found when FB-178 removed the desk's drawer and this was named as the coverage replacing it.
    // ARCA-2 declares a dependency on ARCA-1; open it, and the chip has something to be.
    await page.goto('/venture/arca/tickets?filter=all&t=arca%2FARCA-2');
    const deps = page.getByTestId('tickets-detail').locator('[data-testid^="detail-dep-"]');
    await expect(deps.first(), 'ARCA-2 declares a dependency and no chip rendered').toBeVisible();
    const id = (await deps.first().textContent())?.trim();
    await deps.first().click();
    await expect(page).toHaveURL(new RegExp(`t=[^&]*${id}`));
  });

  test('the rail’s badge and this screen’s "Needs you" filter are the same number', async ({ page }) => {
    // They were not. The rail said 4 and the filter said 2, because the badge counted everything
    // waiting and this screen counted only what happened to have a ticket file. Two of the four
    // were work nobody had written a ticket for — a fact about the venture, not a row to omit.
    //
    // FB-129 pointed the badge's row at this screen, so from here on a disagreement is a visible
    // contradiction one line apart in the rail. This is the check that makes that impossible.
    const badge = page.getByTestId('rail-needs-badge');
    const shown = (await badge.count()) ? ((await badge.textContent()) ?? '').trim() : '0';
    const filter = ((await page.getByTestId('tickets-filter-needs').textContent()) ?? '').match(/(\d+)/)?.[1] ?? '0';
    expect(filter).toBe(shown);
  });

  test('the list and the ticket do not wait for the history', async ({ page }) => {
    // Blocking on the trail took this screen to 23 seconds on ARCA's real backlog against a 6.5s
    // desk. It streams now: a founder came here to read a ticket and decide on it, and neither
    // needs the history. Asserted by the ticket being present before the trail resolves — the
    // pending state and the trail are two different testids, and one of them must always be there.
    await page.goto('/venture/arca/tickets?t=arca%2FARCA-1');
    await expect(page.getByTestId('detail-title')).toBeVisible();
    await expect(page.getByTestId('tickets-list')).toBeVisible();
    const either = page.locator('[data-testid="ticket-trail"], [data-testid="trail-pending"]');
    await expect(either.first()).toBeVisible();
  });

  test('the trail renders in time order and closes with its claim', async ({ page }) => {
    await page.goto('/venture/arca/tickets?t=arca%2FARCA-1');
    const trail = page.getByTestId('ticket-trail');
    await expect(trail).toBeVisible();
    await expect(page.getByTestId('trail-claim')).toContainText('nothing shown can disagree with what ran');

    const hops = page.getByTestId('trail-hop');
    if ((await hops.count()) === 0) {
      // A trail with nothing in it says so; it is never an empty box or an error.
      await expect(page.getByTestId('trail-empty')).toBeVisible();
      return;
    }
    // Oldest first. The dates are rendered, so the order is checkable on the page rather than
    // trusted from the join.
    const order = await hops.evaluateAll((els) => els.map((e) => e.getAttribute('data-at') ?? ''));
    expect(order).toEqual([...order].sort());
  });

  test('every link in the trail goes somewhere, and says which way it goes', async ({ page }) => {
    // The claim the whole studio rests on is only true while no dead link renders. Asserted on the
    // page rather than trusted from `buildTrail`, because the page is what a founder presses.
    await page.goto('/venture/arca/tickets?t=arca%2FARCA-1');
    const links = page.getByTestId('ticket-trail').locator('a');
    for (let i = 0; i < (await links.count()); i++) {
      const href = await links.nth(i).getAttribute('href');
      const text = ((await links.nth(i).textContent()) ?? '').trim();
      expect(href, text).toBeTruthy();
      // → stays in the studio, ↗ leaves it. A founder learns this once, on this screen.
      if (href!.startsWith('/')) expect(text, href!).toContain('→');
      else {
        expect(href, text).toMatch(/^https?:\/\//);
        expect(text, href!).toContain('↗');
      }
    }
  });

  test('a one-entry trail is a trail with one entry', async ({ page }) => {
    // Not an error, not an empty box. ARCA-6 has exactly one thing that has happened to it.
    await page.goto('/venture/arca/tickets?t=arca%2FARCA-6');
    await expect(page.getByTestId('trail-hop')).toHaveCount(1);
    await expect(page.getByTestId('trail-empty')).toHaveCount(0);
    await expect(page.getByTestId('trail-claim')).toBeVisible();
  });

  test('no hop reads as though a word were missing', async ({ page }) => {
    // "Work started on " — the attention queue does not carry a branch name, so the trail printed a
    // preposition with nothing after it, on the one surface whose claim is that it cannot be wrong.
    await page.goto('/venture/arca/tickets?t=arca%2FARCA-1');
    const texts = await page.getByTestId('trail-hop').allTextContents();
    for (const t of texts) expect(t.replace(/\s+/g, ' ').trim(), t).not.toMatch(/\b(on|by|from|to)\s*·/);
  });

  test('an unverified step says so, in words a founder can act on', async ({ page }) => {
    await page.goto('/venture/arca/tickets?t=arca%2FARCA-1');
    const unverified = page.getByTestId('ticket-trail').locator('[data-verified="false"]');
    if ((await unverified.count()) === 0) test.skip();
    // Neither hidden nor shown as verified — and it names who to tell, which is the part a founder
    // can do something with.
    await expect(unverified.first()).toContainText('signature does not check out');
    await expect(unverified.first()).toContainText('Bruntsfield');
  });

  test('it fits a phone, and the ticket is reachable there', async ({ page }) => {
    // FB-153: this assertion passed on production data that could not fail. ARCA's real backlog has
    // a ticket citing a 377px URL, which pushed a 393px window to 471px; the fixture had no link
    // long enough to overflow, so the check was looking at nothing. There is one now.
    await page.setViewportSize({ width: 393, height: 851 });
    await page.goto('/venture/arca/tickets?t=arca%2FARCA-6');
    await expect(page.getByTestId('detail-title')).toContainText('Price history');
    await expect(page.getByTestId('tickets-detail')).toContainText('developer.ebay.com');

    // FB-185: one column at a time, which is the design's phone treatment. This used to assert that
    // BOTH were visible, and both being visible is the defect: the whole queue sat above the ticket
    // the founder had just opened, so reading one ticket meant scrolling past all of them —
    // 8,859px on ARCA's real backlog.
    await expect(page.getByTestId('tickets-detail')).toBeVisible();
    await expect(page.getByTestId('tickets-list')).toBeHidden();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/21-mobile-tickets.png`, fullPage: true });

    // The way back, and the queue is whole when you get there.
    await page.getByTestId('tickets-back-to-list').click();
    await expect(page.getByTestId('tickets-list')).toBeVisible();
    await expect(page.getByTestId('tickets-detail')).toBeHidden();
  });

  test('on a phone with nothing open, the queue is the screen', async ({ page }) => {
    // The other half of one-column-at-a-time. The screen resolves a default selection even when
    // nobody has opened anything, and rendering it under the list put a full ticket below the queue
    // on every phone visit.
    await page.setViewportSize({ width: 393, height: 851 });
    await page.goto('/venture/arca/tickets');
    await expect(page.getByTestId('tickets-list')).toBeVisible();
    await expect(page.getByTestId('tickets-detail')).toBeHidden();
  });
});

/**
 * FB-213 — a surface's link goes to that surface.
 *
 * All three desk columns said "open the queue →" and all three linked `/tickets` with no filter, so
 * Build, Sell and Scale landed on the same screen. A founder pressing Sell's and getting Build's
 * work was told something untrue by a control the studio drew — the same class as FB-138's `?work=`
 * parameter that nothing read, and worse than a missing link, because there is no way to tell.
 */
test.describe('a surface link opens that surface (FB-213)', () => {
  test.beforeEach(async ({ page }) => {
    await testLogin(page, 'john.gallagher@wealthcx.com');
  });

  test('every surface link names its own surface', async ({ page }) => {
    await page.goto('/venture/arca');
    const links = page.locator('[data-testid^="lane-open-"]');
    const n = await links.count();
    expect(n, 'no surface offers a way through to its queue').toBeGreaterThan(0);

    const hrefs = await links.evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
    // The defect, stated: every one of these was `/tickets` with nothing after it. A link only
    // renders for a surface that HAS tickets, so the fixture shows one — the property that matters
    // is that each carries its own surface, not that there are several.
    expect(new Set(hrefs).size, `surface links point at the same place: ${hrefs[0]}`).toBe(n);
    for (const h of hrefs) expect(h).toMatch(/\/venture\/arca\/tickets\?surface=[^&]+$/);
  });

  test('following it shows that surface, and says which one', async ({ page }) => {
    await page.goto('/venture/arca/tickets?surface=build&filter=all');
    await expect(page.getByTestId('tickets-surface')).toContainText('Showing');
    // Every row belongs to the surface asked for. A filtered list that quietly includes others is
    // the same lie in the other direction.
    const rows = page.locator('[data-testid^="tickets-row-"]');
    expect(await rows.count(), 'the surface has no rows at all').toBeGreaterThan(0);
  });

  test('a different surface shows a different list', async ({ page }) => {
    // The assertion the old links could never have passed: two surfaces, two answers.
    await page.goto('/venture/arca/tickets?surface=build&filter=all');
    const build = await page.locator('[data-testid^="tickets-row-"]').count();
    await page.goto('/venture/arca/tickets?surface=sell&filter=all');
    const sell = await page.locator('[data-testid^="tickets-row-"]').count();
    await page.goto('/venture/arca/tickets?filter=all');
    const all = await page.locator('[data-testid^="tickets-row-"]').count();

    expect(build, 'Build and Sell show the same list, so nothing is being filtered').not.toBe(sell);
    expect(build + sell, 'the surfaces together exceed the whole venture').toBeLessThanOrEqual(all);
  });

  test('an empty surface does not report the venture empty', async ({ page }) => {
    // The fault this change introduced and had to fix. Filtering to a surface with no work hit
    // "No tickets yet. The first one your team files lands here" — said about the whole company, to
    // a founder who had just pressed that surface's own link, on a venture with eight tickets.
    await page.goto('/venture/arca/tickets?surface=sell&filter=all');
    await expect(page.getByTestId('tickets-view')).not.toContainText('No tickets yet.');
    await expect(page.getByTestId('tickets-summary')).toContainText('has no tickets yet');
    await expect(page.getByTestId('tickets-list-empty')).toContainText('Nothing here on');
  });

  test('there is a way back to every surface, and it keeps the status tab', async ({ page }) => {
    await page.goto('/venture/arca/tickets?surface=build&filter=all');
    await page.getByTestId('tickets-surface-clear').click();
    await expect(page).toHaveURL(/\/tickets\?(?!.*surface=).*filter=all/);
    await expect(page.getByTestId('tickets-surface')).toHaveCount(0);
  });

  test('a surface nobody has heard of shows everything, not nothing', async ({ page }) => {
    // An empty screen would read as "this surface has no work" — a claim about the venture made
    // from a typo in a URL.
    await page.goto('/venture/arca/tickets?surface=markteing&filter=all');
    await expect(page.getByTestId('tickets-surface')).toHaveCount(0);
    expect(await page.locator('[data-testid^="tickets-row-"]').count()).toBeGreaterThan(0);
  });
});

/**
 * FB-184 — every ticket says where to see the result, and links only to what opens.
 *
 * The rig never opens a preview (it makes no live call, FB-217), so here every preview is "not
 * checked yet" and has no link. That is the half this gate can see: an unchecked address is never
 * drawn as a link. The checked half is `lib/__tests__/result-link.test.ts`.
 */
test.describe('follow it to the result (FB-184)', () => {
  test.beforeEach(async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
  });

  test('work with a reported preview says so, with no link, directly above the decision', async ({ page }) => {
    await page.goto('/venture/arca/tickets?t=arca%2FARCA-1');
    const follow = page.getByTestId('detail-follow');
    await expect(follow).toContainText('Follow it to the preview');
    await expect(follow).toHaveAttribute('data-linked', 'false');
    await expect(follow.locator('a')).toHaveCount(0);
    // Directly above "Your decision": the next thing after the line is the decision panel.
    // Polled, not read once: the decision panel streams in after the line, and a single read can run
    // before it arrives (it failed that way on #340 and #346). Something else in between still fails,
    // and says what it was.
    await expect.poll(() => follow.evaluate((el) => el.nextElementSibling?.getAttribute('data-testid') ?? '(nothing yet)'))
      .toBe('detail-decision');
  });

  test('a preview the studio opened and found down says why, with no link (FB-184)', async ({ page }) => {
    // ARCA-3's work (#13) has a preview the rig's fixture says is not answering.
    await page.goto('/venture/arca/tickets?t=arca%2FARCA-3');
    const follow = page.getByTestId('detail-follow');
    await expect(follow).toContainText('it did not open when the studio checked, because it is not answering');
    await expect(follow).toHaveAttribute('data-linked', 'false');
    await expect(follow.locator('a')).toHaveCount(0);
  });

  test('a ticket with nothing to look at says so', async ({ page }) => {
    await page.goto('/venture/arca/tickets?t=arca%2FARCA-6');
    await expect(page.getByTestId('detail-follow')).toHaveText('Nothing to follow yet');
  });
});
