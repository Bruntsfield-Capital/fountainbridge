import { test, expect } from '@playwright/test';
import { testLogin } from './helpers';

/**
 * The approval card's provenance render (FB-058).
 *
 * This is the only place the sentence "the studio cannot verify this approval" reaches a human, and
 * until this file existed it was deletable without failing a single test — `app/` was outside the
 * unit glob and no e2e touched the card. The most consequential surface in the product was the least
 * covered one.
 *
 * The fixtures behind these tests are adversarial on purpose (`_adversarial` in the grant file keeps
 * `make sign-approval-fixtures` from quietly repairing them):
 *   forged-grant      — a grant.json with a bogus attestation, of the kind a lane could write
 *   changed-proposal  — a genuinely studio-signed grant, pinned to a proposal that then changed
 */
test.describe('what the studio can prove about an approval', () => {
  // FB-183: a send awaiting the gate is a ROW on the desk and a decision on its own page. These
  // assertions follow the provenance render to where it now lives; the desk keeps the alarm, which
  // is asserted separately below.
  const decisionPage = (id: string) => `/venture/arca/approvals/arca/${id}`;

  test.beforeEach(async ({ page }) => {
    await testLogin(page, 'john.gallagher@wealthcx.com');
  });

  test('a forged grant is never shown as an approval', async ({ page }) => {
    await page.goto(decisionPage('forged-grant'));
    const card = page.getByTestId('approval-arca/forged-grant');
    await expect(card).toBeVisible();
    const prov = page.getByTestId('approval-arca/forged-grant-provenance');
    await expect(prov).toHaveAttribute('data-grant-provenance', 'unattested');
    // It stays awaiting the gate — a grant that does not verify is not an approval.
    await expect(page.getByTestId('approval-arca/forged-grant-approve')).toBeVisible();
  });

  test('the warning says what to do about it, not just that something is wrong', async ({ page }) => {
    await page.goto(decisionPage('forged-grant'));
    const prov = page.getByTestId('approval-arca/forged-grant-provenance');
    await expect(prov).toContainText('Next step');
    // A bad signature is an incident, not a re-approve.
    await expect(prov).toContainText(/Tell Bruntsfield|incident/i);
  });

  test('the warning is announced, not only coloured', async ({ page }) => {
    // A state carried by colour alone is a state a screen-reader user does not get.
    await page.goto(decisionPage('forged-grant'));
    const prov = page.getByTestId('approval-arca/forged-grant-provenance');
    await expect(prov).toContainText('Warning:');
    await expect(prov).toHaveCSS('color', 'rgb(138, 32, 32)'); // --color-error
  });

  test('a proposal that changed after approval reads as unverified, with a re-approve', async ({ page }) => {
    await page.goto(decisionPage('changed-proposal'));
    const prov = page.getByTestId('approval-arca/changed-proposal-provenance');
    await expect(prov).toHaveAttribute('data-grant-provenance', 'unattested');
    // This one IS a re-approve — the signature is genuine, the document moved.
    await expect(prov).toContainText(/changed|re-approve|read it again/i);
  });

  /**
   * The alarm survives becoming a row (FB-183).
   *
   * This is the assertion that would have caught the regression writing that ticket introduced: the
   * card carried the "cannot verify" warning, and the first version of the row carried only a title,
   * so a forged grant would have read as an ordinary line in a list.
   */
  test('the desk itself still shouts about a grant it cannot verify', async ({ page }) => {
    await page.goto('/venture/arca');
    const warning = page.getByTestId('waiting-external-arca-forged-grant-unverified');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('cannot verify');
    await expect(warning).toContainText('Warning:');
    await expect(warning).toHaveCSS('color', 'rgb(138, 32, 32)');
  });

  test('the row is a pointer, and the decision is on the page it opens', async ({ page }) => {
    await page.goto('/venture/arca');
    // No approve control anywhere on the desk — the whole point of the ticket.
    await expect(page.locator('[data-testid$="-approve"]')).toHaveCount(0);
    await page.getByTestId('waiting-decide-external-arca-forged-grant').click();
    await expect(page).toHaveURL(/\/venture\/arca\/approvals\/arca\/forged-grant$/);
    await expect(page.getByTestId('approval-arca/forged-grant-approve')).toBeVisible();
    await expect(page.getByTestId('approval-arca/forged-grant-refuse')).toBeVisible();
  });

  test('a genuinely attested grant reads as approved, naming the human', async ({ page }) => {
    // The counterweight: if everything rendered as unverified the tests above would pass for the
    // wrong reason.
    //
    // FB-207 moved this off the desk. It was asserted against `approvals-decided`, which is gone;
    // the property is the same and its home is now the approval's own page, where the full
    // provenance sentence lives.
    await page.goto(decisionPage('past-send'));
    const prov = page.getByTestId('approval-arca/past-send-provenance');
    await expect(prov).toHaveAttribute('data-grant-provenance', 'attested');
    await expect(prov).toContainText('john.gallagher@wealthcx.com');
  });

  test('an approved action stays visible instead of disappearing', async ({ page }) => {
    // Found by writing the test above: `granted` rendered NOWHERE. A founder clicked Approve on
    // something irreversible and the card vanished, returning only if it later failed. Every
    // approval now appears somewhere with its state on it.
    //
    // FB-207: that somewhere is What happened, which is the screen whose job is the record. The desk
    // is what happens next, and a granted send is not that. The property is unchanged and is the
    // reason the desk's section was defended twice before this could ship — the approval had to keep
    // being visible SOMEWHERE, with its state on it, and now it is here.
    await page.goto('/venture/arca/activity');
    const decisions = page.getByTestId('activity-item').filter({ hasText: 'approved:' });
    expect(await decisions.count(), 'an approved send vanished from the studio').toBeGreaterThan(0);
    await expect(decisions.first()).toContainText('john.gallagher@wealthcx.com');
    // And the desk is not carrying it any more, which is the other half of the move.
    await page.goto('/venture/arca');
    await expect(page.getByTestId('approvals-decided')).toHaveCount(0);
  });

  test('two approvals in different repos do not collide in the DOM', async ({ page }) => {
    await page.goto('/venture/arca/approvals/arca/past-send');
    // Since FB-045 an approval id is unique only within its department's repo. Repo-qualified test
    // ids are what keeps Playwright's strict mode from failing the moment two departments share a
    // ticket name.
    for (const id of ['past-send', 'forged-grant', 'changed-proposal']) {
      await page.goto(`/venture/arca/approvals/arca/${id}`);
      await expect(page.getByTestId(`approval-arca/${id}`)).toHaveCount(1);
    }
  });
});

/**
 * FB-214 — a price the studio could not read is not a price of nothing.
 *
 * `priceUnreadable` has existed on the approval since FB-054, precisely to keep "free" and "we could
 * not read it" apart. Nothing rendered it. So a malformed price produced no sentence at all, and on
 * the one screen where somebody approves money leaving their company, silence reads as free.
 */
test.describe('a price the studio could not read (FB-214)', () => {
  test.beforeEach(async ({ page }) => {
    await testLogin(page, 'matthew@bruntsfield.capital');
    await page.goto('/venture/arca/approvals/arca/unreadable-price');
  });

  test('says so, rather than saying nothing', async ({ page }) => {
    const said = page.getByTestId('approval-arca/unreadable-price-price-unreadable');
    await expect(said).toBeVisible();
    await expect(said).toContainText('could not read');
    // The half that matters: it names the difference, because a founder reading "no cost shown"
    // will supply "free" themselves.
    await expect(said).toContainText('not the same as free');
  });

  test('does not also print a cost it does not have', async ({ page }) => {
    // The two are exclusive. A card claiming both a figure and an unreadable price would be worse
    // than either.
    await expect(page.getByTestId('approval-arca/unreadable-price-budget')).toHaveCount(0);
  });

  test('an action with a readable price still states it, and says nothing about reading', async ({ page }) => {
    await page.goto('/venture/arca/approvals/arca/over-budget-send');
    await expect(page.getByTestId('approval-arca/over-budget-send-budget')).toContainText('This one costs');
    await expect(page.getByTestId('approval-arca/over-budget-send-price-unreadable')).toHaveCount(0);
  });

  test('a genuinely free action stays silent, because free is a real answer', async ({ page }) => {
    // The counterweight. If every action without a figure shouted, the shout would mean nothing —
    // and `free-post` states no price at all, which is different from stating an unreadable one.
    await page.goto('/venture/arca/approvals/arca/free-post');
    await expect(page.getByTestId('approval-arca/free-post-price-unreadable')).toHaveCount(0);
    await expect(page.getByTestId('approval-arca/free-post-budget')).toHaveCount(0);
  });
});
