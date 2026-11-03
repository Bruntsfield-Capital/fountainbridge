import { test, expect } from '@playwright/test';
import { boxOf, inTopDownOrder } from './helpers';

// FB-092: the email+password door, end to end against a real production build. The account is
// ARCA's founder (FB-090), so this also proves the property that matters most: WHICH door you
// come through changes nothing about what you may see — scoping is lib/authz on the email,
// server-side, same as Google.

const SHOTS = 'e2e/__screenshots__';
const EMAIL = 'matthew@bruntsfield.capital';
const PASSWORD = 'e2e-founder-password-not-for-production';

test('the login page offers the password form when accounts are configured', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByTestId('password-email')).toBeVisible();
  await expect(page.getByTestId('password-password')).toBeVisible();
  // Google stays the primary door, above it.
  await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/15-password-login-form.png`, fullPage: true });
});

test('a wrong password fails with one generic message and no session', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('password-email').fill(EMAIL);
  await page.getByTestId('password-password').fill('not-the-password');
  await page.getByTestId('password-submit').click();
  await page.waitForURL(/\/login\?error=password/);
  await expect(page.getByTestId('password-error')).toBeVisible();
  // Still signed out: the studio serves no venture data.
  await page.goto('/venture/arca');
  await page.waitForURL((url) => url.pathname.startsWith('/login'));
  await page.screenshot({ path: `${SHOTS}/16-password-login-refused.png`, fullPage: true });
});

test('ARCA’s founder signs in with a password and is scoped exactly as with Google', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('password-email').fill(EMAIL);
  await page.getByTestId('password-password').fill(PASSWORD);
  await page.getByTestId('password-submit').click();
  // A founder with one venture is taken straight into it (FB-066).
  await page.waitForURL(/\/venture\/arca$/);
  await page.screenshot({ path: `${SHOTS}/17-password-login-founder.png`, fullPage: true });

  // The isolation property, asserted through THIS door: another venture is refused server-side.
  await page.goto('/venture/the-reset');
  await expect(page.getByTestId('venture-forbidden')).toBeVisible();
});

test('an email that is not in the allowlist cannot sign in, even with a used password', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('password-email').fill('stranger@example.com');
  await page.getByTestId('password-password').fill(PASSWORD);
  await page.getByTestId('password-submit').click();
  await page.waitForURL(/\/login\?error=password/);
  await expect(page.getByTestId('password-error')).toBeVisible();
});

/**
 * FB-135 — the front door, restyled.
 *
 * A restyle of the one screen where a cosmetic change locks a founder out of everything. These are
 * the properties the design asks for, and the ones a careless restyle would take away.
 */
test.describe('the sign-in screen (FB-135)', () => {
  test('it says both doors in one sentence, before either of them', async ({ page }) => {
    // A founder holding an email login was once told, by the page offering it, that Google was the
    // way in (FB-100). The sentence covers whichever doors are actually open.
    await page.goto('/login');
    await expect(page.getByTestId('signin')).toContainText(
      'Sign in with your venture account: Google, or the email and password you were given.',
    );
  });

  test('the studio introduces itself once, not twice', async ({ page }) => {
    // The screen carries the wordmark, so the top bar's copy of it is hidden here. Two wordmarks on
    // the one screen whose job is to say who this is would be the studio not knowing its own name.
    await page.goto('/login');
    // Visible, not merely present: the top bar's wordmark is still in the document, hidden by
    // `body:has(.signin) .topbar`. What must be true is that the reader sees one.
    await expect(page.locator('.wordmark:visible')).toHaveCount(1);
    await expect(page.getByTestId('signin')).toContainText('Bruntsfield');
    await expect(page.getByTestId('signin-footer')).toHaveText('A Bruntsfield Capital venture · Edinburgh');
  });

  test('Google is above the password form, and both are still reachable', async ({ page }) => {
    await page.goto('/login');
    await inTopDownOrder([               // Google is the primary door and sits above
      ['the Google door', page.getByRole('button', { name: /continue with google/i })],
      ['the password door', page.getByTestId('password-submit')],
    ]);
  });

  test('the fields carry the studio’s own rule, not the browser’s border', async ({ page }) => {
    // FB-150: two design tokens that do not exist left inputs borderless — an undefined custom
    // property invalidates the whole declaration, silently.
    //
    // Asserting "has a border" is not enough, and this test was written that way first: every input
    // has a border from the browser, so it passed with the rule deleted. What must be true is that
    // the rule is OURS — the token, resolved.
    //
    // FB-189 moved it from a box to an underline, which is what the design draws on this screen, so
    // the rule to check is the bottom one. The width is checked too: an invalidated declaration
    // leaves a colour behind and no line, which is the exact failure FB-150 was written for.
    await page.goto('/login');
    const rule = await page.getByTestId('password-email').evaluate((e) => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--color-border-strong)';
      document.body.appendChild(probe);
      const token = getComputedStyle(probe).color;
      probe.remove();
      const cs = getComputedStyle(e);
      return { colour: cs.borderBottomColor, width: cs.borderBottomWidth, token };
    });
    expect(rule.colour, 'the field rule is the token, not a browser default').toBe(rule.token);
    expect(parseFloat(rule.width), 'the field has no rule at all').toBeGreaterThan(0);
  });

  test('it fits a phone', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    await page.goto('/login');
    await expect(page.getByTestId('password-submit')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

/**
 * FB-189 — the sign-in screen against its design.
 *
 * The FB-175 audit scored nine screens and said of this one: *"Sign in was never compared. It is the
 * one screen a founder sees before they trust anything, and it is not in this table because I did
 * not do it."* It has been compared now, and these are the parts of it worth holding.
 */
test.describe('sign in, against its design (FB-189)', () => {
  test('the wordmark leads and the verb does not shout over it', async ({ page }) => {
    await page.goto('/login');
    const sizes = await page.evaluate(() => {
      const px = (s: string | undefined) => parseFloat(s ?? '0');
      return {
        wordmark: px(getComputedStyle(document.querySelector('.signin .wordmark-name')!).fontSize),
        heading: px(getComputedStyle(document.querySelector('.signin h1')!).fontSize),
      };
    });
    // The design: wordmark 24px, heading 32px. Ours was 21.6px against 56px — the page shouted
    // "Sign in" and whispered whose studio it is.
    expect(sizes.heading, 'the heading is back at page-title size').toBeLessThan(40);
    expect(sizes.heading / sizes.wordmark, 'the heading dwarfs the wordmark').toBeLessThan(1.7);
  });

  test('one wordmark in the product, in the design’s form', async ({ page }) => {
    // The rail hard-codes BRUNTSFIELD; the top bar and this page rendered "Bruntsfield". The design
    // draws it in caps in all three places, so the product carried two wordmarks and the one a
    // founder meets first was the odd one out.
    await page.goto('/login');
    await expect(page.locator('.signin .wordmark-name')).toHaveCSS('text-transform', 'uppercase');
    await expect(page.locator('.signin .wordmark-name')).toHaveText('Bruntsfield');
  });

  test('the second door is a modest control, not a second primary button', async ({ page }) => {
    await page.goto('/login');
    const submit = await boxOf(page.getByTestId('password-submit'), 'the password door');
    const google = await boxOf(page.getByRole('button', { name: /continue with google/i }), 'the Google door');
    expect(submit.width, 'the password button is as wide as Google’s').toBeLessThan(google.width * 0.75);
  });
});
