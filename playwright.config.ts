import { mkdirSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
// The server's settings live in one place, shared with the factory's test copy (FB-272).
import { stateFolder, studioTestEnv } from './e2e/server-env.mjs';

// FB-005 UI-gate: builds the app and drives the three authorization cases against a real server.
// The server runs with E2E_TEST_LOGIN=1 so the credentials provider can sign in as any email
// (never enabled in production). Screenshots land in e2e/__screenshots__ and are uploaded as a CI
// artifact (the "gallery per PR"). Google client vars are dummies — e2e uses the test provider.
const PORT = 3100;

/**
 * FB-178: measure the desk against a backlog, not against six tickets.
 *
 * When `E2E_SCALE_FIXTURES` names a directory, the four sources that GROW with a venture are read
 * from it instead of from the committed fixture — 73 tickets and 1,773 run reports, ARCA's real
 * numbers. Everything else (health, the corpus, recurring work) stays pointed at the committed
 * fixture, because none of it grows with how much work a venture has done.
 *
 * Built by `scripts/make-scale-fixture.mjs` and run by `npm run test:e2e:scale`. Same shape as
 * `E2E_FAIL_READS` below: the fixture directory has to be chosen when the server starts, so it
 * cannot be a per-test decision.
 */
const SCALE = process.env.E2E_SCALE_FIXTURES?.trim();

/**
 * FB-272: run the specs against a studio that is already running, such as a test copy started with
 * `node scripts/test-copy.mjs start --port 3100`. When `E2E_BASE_URL` is set, Playwright builds and
 * starts nothing, and talks to that address instead.
 */
const RUNNING = process.env.E2E_BASE_URL?.trim();

/** FB-274: where the studio writes each press as one line, as a test copy does (`stateFolder`). */
const STATE = stateFolder();

mkdirSync(STATE, { recursive: true });

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: RUNNING || `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /(mobile|pocket)\.spec\.ts/ },
    // FB-009: the mobile UI-gate at phone size (~393×851). Pixel 5 is Chromium-based, so it runs on
    // the same browser CI installs (iPhone/WebKit would need a separate webkit install).
    { name: 'mobile', use: { ...devices['Pixel 5'] }, testMatch: /(mobile|pocket)\.spec\.ts/ },
  ],
  webServer: RUNNING ? undefined : {
    command: `npm run build && npm run start -- --port ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { ...studioTestEnv({ scale: SCALE, failReads: process.env.E2E_FAIL_READS ?? '', factoryBuilt: process.env.STUDIO_FACTORY_BUILT ?? '' }), FACTORY_RUNTIME_STATE: STATE },
  },
});
