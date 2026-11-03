/**
 * The settings the studio runs with when it is being tested (FB-272).
 *
 * Two things start a studio for testing, and both read this one list so they cannot drift apart:
 *
 *   - Playwright's own server, in `playwright.config.ts` (the UI gate).
 *   - The test copy, `scripts/test-copy.mjs`, which the factory starts for each run. It adds its own
 *     throwaway database (`DATABASE_URL`) and its commit (`BUILD_COMMIT_SHA`) on top of these.
 *
 * Every value here is a test value. Nothing in this file is a real key, a real password or a real
 * founder's data, which is why it is safe in a public repository.
 *
 * Plain JavaScript, not TypeScript, because the test copy is started with plain `node`.
 */

import { resolve } from 'node:path';

/**
 * FB-178: when `scale` names a directory, the four sources that GROW with a venture (tickets, pull
 * requests, run reports, work) are read from it instead of from the committed fixture.
 * @param {string | undefined} scale
 * @param {string} source
 * @param {string} committed
 */
const backlog = (scale, source, committed) => (scale ? `${scale}/${source}` : committed);

/**
 * @param {{ scale?: string, failReads?: string }} [options]
 *   `scale`: the directory `E2E_SCALE_FIXTURES` names, if any (FB-178).
 *   `failReads`: which reads to fail on purpose (FB-137); empty by default.
 * @returns {Record<string, string>}
 */
export function studioTestEnv({ scale, failReads = '' } = {}) {
  return {
    E2E_TEST_LOGIN: '1',
    E2E_TEST_LOGIN_SECRET: 'e2e-playwright-shared-secret',
    TICKETS_FIXTURE_DIR: backlog(scale, 'tickets', 'e2e/fixtures/tickets'),
    PRS_FIXTURE_DIR: backlog(scale, 'prs', 'e2e/fixtures/prs'),
    HEALTH_FIXTURE_DIR: 'e2e/fixtures/health',
    APPROVALS_FIXTURE_DIR: 'e2e/fixtures/approvals',
    // FB-042. The heartbeat fixture is dated relative to E2E_NOW below, so the engine reads as
    // running rather than as stalled-for-six-months every time the real clock moves on.
    RUNREPORTS_FIXTURE_DIR: backlog(scale, 'runreports', 'e2e/fixtures/runreports'),
    // FB-064. Gated on E2E_TEST_LOGIN at the call site as well — this surface can MERGE.
    WORK_FIXTURE_DIR: backlog(scale, 'work', 'e2e/fixtures/work'),
    // FB-275: the planning box's door. The tests put the Review screen's cards and pictures in
    // through it, signed with this (`e2e/review-cards.ts`), as the box will with its own secret.
    // A test value only: production and staging each get their own, set by John.
    FACTORY_DOOR_SECRET: 'e2e-factory-door-secret-not-for-production',
    // FB-106: the venture's corpus, offline.
    KNOWLEDGE_FIXTURE_DIR: 'e2e/fixtures/knowledge',
    READINGS_FIXTURE_DIR: 'e2e/fixtures/readings',
    // FB-206: each venture box's credential scan record, read by the admin ledger only. ARCA's
    // has two findings, modernisation-engine's is clean but three weeks old, the-reset has none.
    BOXSCAN_FIXTURE_DIR: 'e2e/fixtures/boxscan',
    // FB-169: whether the team can find every document. ARCA's machine cannot find the one filed
    // under library/build/ — the real fault, in miniature. No other venture has a record.
    BRAINCORPUS_FIXTURE_DIR: 'e2e/fixtures/brain-corpus',
    // FB-137: which reads to fail on purpose, so the degraded half of every screen can be
    // checked by eye and in CI rather than only when a code host is having a bad day. Empty by
    // default; `e2e/degraded.spec.ts` runs a second server with it set.
    E2E_FAIL_READS: failReads,
    // FB-133: the recurring work shown under the corpus on the Memory screen. Without this the
    // gate would reach GitHub for it, which is both slow and a network dependency the UI gate is
    // built to avoid — and it would render the "could not be read" state on every run.
    ROUTINES_FIXTURE_DIR: 'e2e/fixtures/routines',
    // FB-239: the monthly budgets for temporary machines, drawn without a database. Gated on
    // E2E_TEST_LOGIN at the call site. John's address is the budget approver here, as in production.
    MACHINE_BUDGETS_FIXTURE: 'e2e/fixtures/machine-budgets/overview.json',
    BUDGET_APPROVER_EMAIL: 'john.gallagher@wealthcx.com',
    // FB-235: the Sell pipeline. Invented people only — this repository is public.
    CRM_FIXTURE_DIR: 'e2e/fixtures/crm',
    // FB-065. A recorded stream off the real ARCA box, including the inconsistent tool-call
    // indices the engine actually sends — so the UI gate proves the surface against what the
    // engine does, not against what its format says it should do.
    COMPOSER_FIXTURE: 'e2e/fixtures/composer/stream.sse',
    // The gate's shared secret. Without it every fixture grant reads `unattested` and a granted
    // spend silently reverts to "awaiting your OK" — which is the correct product behaviour
    // (FB-051) but means the e2e would never exercise the attested path at all. The fixture
    // grants are signed with THIS value; regenerate them with `make sign-approval-fixtures`.
    FOUNDRY_APPROVAL_SECRET: 'e2e-approval-secret-not-for-production',
    // FB-184: what the rig says each preview check found. The rig never opens an address; this
    // lets the gate see a checked link drawn and a failed one withheld, not only "not checked".
    PREVIEW_CHECK_FIXTURE: 'e2e/fixtures/preview-checks.json',
    // Pin "now" so staleness is deterministic against the fixed-date health fixtures (FB-032).
    // arca's last activity is 2026-07-21 → active; thereset-platform's is 2026-01-10 → stale.
    E2E_NOW: '2026-07-22T00:00:00Z',
    STUDIO_ADMIN_EMAILS: 'john.gallagher@wealthcx.com',
    // FB-141: lets the notification card be drawn on a rig that has no database, so the browser
    // test can see it. The public key is a throwaway point with no private half anywhere; the
    // "private key" is a placeholder that could sign nothing. Pressing "Turn on" here fails, as it
    // should, because there is nowhere to keep the phone.
    PUSH_FIXTURE: '1',
    VAPID_PUBLIC_KEY: 'BJgmT8afelTGKjHrRNGo0VPeq-GUZd3SFeqroUB_RTUuAqOIbhOvwphnEFlsaMyP6BoIpS65obJhfKKFhfOmRVc',
    VAPID_PRIVATE_KEY: 'e2e-placeholder-not-a-key',
    // FB-173: the test transcriber, so the record button is drawn and a voice note goes through
    // without sending audio anywhere. It answers with a fixed sentence that says what it is.
    TRANSCRIBER: 'test-double',
    // FB-092: the email+password door, driven end to end by password-login.spec.ts. The hash is
    // for 'e2e-founder-password-not-for-production' — minted with scripts/mint-password-login.mjs
    // and safe to commit precisely because it is a hash of a test-only password.
    STUDIO_PASSWORD_LOGINS:
      'matthew@bruntsfield.capital=scrypt:16384:8:1:WOJHurNFM0_Pg9TJPpclNA:9hY2bijcoZlJ0eYUaNDtoQg-KLQ9v7ZyWjuX21SPIB8',
    AUTH_SECRET: 'e2e-test-secret-not-for-production',
    AUTH_TRUST_HOST: 'true',
    GOOGLE_CLIENT_ID: 'e2e-dummy',
    GOOGLE_CLIENT_SECRET: 'e2e-dummy',
  };
}

/**
 * FB-274: the state folder of the studio under test, where it writes each press as one line.
 *
 * Playwright's own server is given `e2e/__state__`; a test copy prints its own, and the specs read
 * it from FACTORY_RUNTIME_STATE when they run against that copy (`E2E_BASE_URL`).
 * @param {Record<string, string | undefined>} [env]
 */
export function stateFolder(env = process.env) {
  return resolve(env.FACTORY_RUNTIME_STATE?.trim() || 'e2e/__state__');
}
