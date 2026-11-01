import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadVentures, type VentureSummary } from '../ventures';
import { loadRailData } from '../rail';
import { loadAccessibleNeedsYou } from '../needs-you-load';
import { cardStore } from '../card-store-live';
import { factoryCardsForJohn, ventureCardRows, viewerOf, workPageOff } from '../factory-work-load';
import { BUTTONS_OFF, QUIET_MS } from '../presses';
import { DEFAULT_BOX } from '../factory-door';
import { cardEvents, FACTORY_VENTURE } from '../factory-work';
import { storedCard } from './review-fixtures';

/**
 * FB-277: the factory's cards, read for the lists, against the same fixtures the UI gate runs on.
 *
 * The rig's card store holds ARCA's three cards (two finished, one stuck), THE RESET's one, a card
 * for a pull request GitHub also reads as open (arca#10, ARCA-1), and a finished card of the
 * factory's own. Every list is asked as ARCA's founder, as THE RESET's, and as John, and each must
 * hold only what that person may see, counted once.
 */

const JOHN = 'john.gallagher@wealthcx.com';
const FOUNDER = 'arca.founder@bruntsfield.capital';
const ROSS = 'ross@bruntsfield.capital';
const RIG = {
  E2E_TEST_LOGIN: '1',
  PRS_FIXTURE_DIR: 'e2e/fixtures/prs',
  APPROVALS_FIXTURE_DIR: 'e2e/fixtures/approvals',
  RUNREPORTS_FIXTURE_DIR: 'e2e/fixtures/runreports',
  FOUNDRY_APPROVAL_SECRET: 'e2e-approval-secret-not-for-production',
  STUDIO_ADMIN_EMAILS: JOHN,
};

let arca: VentureSummary;
let reset: VentureSummary;

beforeAll(async () => {
  Object.assign(process.env, RIG);
  delete process.env.DATABASE_URL;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('foundry-studio.rig-card-store')];
  arca = loadVentures().find((v) => v.id === 'arca')!;
  reset = loadVentures().find((v) => v.id === 'the-reset')!;
  const store = cardStore()!;
  for (const n of [20, 21, 22]) await store.putCard('arca', storedCard('arca', n));
  await store.putCard('the-reset', storedCard('thereset-platform', 5));
  // The same work twice: GitHub reads arca#10 (ARCA-1) as an open pull request, and the factory has
  // a card for it.
  await store.putCard('arca', { ...storedCard('arca', 21), number: 10, plain: { ...storedCard('arca', 21).plain, ref: 'ARCA-1', title: 'The terminal card renderer, from the factory' } });
  await store.putCard(FACTORY_VENTURE, { ...storedCard('cowgate', 40), repo: 'cowgate', state: 'finished' });
});

afterAll(() => {
  for (const k of Object.keys(RIG)) delete process.env[k];
});

describe("ARCA's founder", () => {
  it("lists ARCA's cards and nothing of THE RESET's or the factory's", async () => {
    const needs = await loadAccessibleNeedsYou(FOUNDER);
    expect(needs.cards.map((c) => `${c.ventureId} ${c.key}`).sort()).toEqual(['arca arca#10', 'arca arca#20', 'arca arca#21', 'arca arca#22']);
    expect(Object.keys(needs.perVenture)).toEqual(['arca']);
    const rows = (await ventureCardRows(arca, viewerOf(FOUNDER, arca))).rows;
    expect(rows.some((r) => r.ventureId !== 'arca' || r.repo === 'cowgate' || r.repo === 'thereset-platform')).toBe(false);
  });

  it('is never handed the factory\'s cards, even by a page that forgot to check', async () => {
    expect(await factoryCardsForJohn(viewerOf(FOUNDER, arca))).toEqual({ rows: [], cards: [], unread: false, quiet: null });
  });

  it('sees one row for arca#10, the card, and counts it once', async () => {
    const needs = await loadAccessibleNeedsYou(FOUNDER);
    expect(needs.work.some((p) => p.repo === 'arca' && p.number === 10)).toBe(false);
    expect(needs.cards.filter((c) => c.number === 10)).toHaveLength(1);
    // The rail, the desk's count and this page's are one number.
    expect(needs.perVenture.arca).toBe((await loadRailData(arca)).needsYou);
    expect(needs.count).toBe(needs.work.length + needs.cards.length + needs.sends.length);
  });

  it("reads ARCA's cards in plain words: no dollar figure, no next step, no Archon", async () => {
    const viewer = viewerOf(FOUNDER, arca);
    const read = await ventureCardRows(arca, viewer);
    const all = JSON.stringify([read.rows, read.cards.flatMap((c) => cardEvents(c, viewer, 'ARCA'))]);
    expect(all).not.toMatch(/\$\s?\d|what to do next|tell the lane|archon/i);
  });
});

describe("THE RESET's founder", () => {
  it("lists THE RESET's card alone", async () => {
    const needs = await loadAccessibleNeedsYou(ROSS);
    expect(needs.cards.map((c) => `${c.ventureId} ${c.key}`)).toEqual(['the-reset thereset-platform#5']);
    expect(Object.keys(needs.perVenture)).toEqual(['the-reset']);
    const rows = (await ventureCardRows(reset, viewerOf(ROSS, reset))).rows;
    expect(rows.map((r) => r.key)).toEqual(['thereset-platform#5']);
  });
});

describe('John', () => {
  it("lists every venture's waiting cards and the factory's own, with his parts", async () => {
    const needs = await loadAccessibleNeedsYou(JOHN);
    expect(needs.cards.map((c) => `${c.ventureId} ${c.key}`).sort()).toEqual([
      '_factory cowgate#40', 'arca arca#10', 'arca arca#20', 'arca arca#21', 'arca arca#22', 'the-reset thereset-platform#5',
    ]);
    expect(needs.cards.find((c) => c.key === 'arca#22')?.john?.cost).toBe('$6.80, of a $15 budget');
    expect(needs.perVenture[FACTORY_VENTURE]).toBe(1);
    expect(needs.ventureNames[FACTORY_VENTURE]).toBe('The factory');
    // The factory's card has no Review screen in a venture: nothing links into one.
    expect(needs.cards.find((c) => c.ventureId === FACTORY_VENTURE)?.href).toBeNull();
  });
});

describe('when the factory goes quiet (FB-278)', () => {
  const QUIET = /^The factory hasn't reported since (\d+ \w+, )?\d\d:\d\d\. These may be out of date\.$/;
  const beat = (msAgo: number) => cardStore()!.beat(DEFAULT_BOX, new Date(Date.now() - msAgo).toISOString());

  afterAll(() => beat(0));

  it('every list of cards says so, and the work page of a carded pull request switches its buttons off', async () => {
    await beat(QUIET_MS + 60_000);
    expect((await ventureCardRows(arca, viewerOf(FOUNDER, arca))).quiet).toMatch(QUIET);
    expect((await factoryCardsForJohn(viewerOf(JOHN, null))).quiet).toMatch(QUIET);
    expect((await loadAccessibleNeedsYou(FOUNDER)).cardsQuiet).toMatch(QUIET);
    expect(await workPageOff(arca, 'arca', 21)).toMatch(new RegExp(`These may be out of date\\. ${BUTTONS_OFF}$`));
    // Work no card stands for has nothing to do with the factory.
    expect(await workPageOff(arca, 'arca', 999)).toBeNull();
  });

  it('says nothing while the factory reports', async () => {
    await beat(60_000);
    expect((await ventureCardRows(arca, viewerOf(FOUNDER, arca))).quiet).toBeNull();
    expect((await loadAccessibleNeedsYou(JOHN)).cardsQuiet).toBeNull();
    expect(await workPageOff(arca, 'arca', 21)).toBeNull();
  });
});

describe('a manifest cannot claim the factory\'s cards', () => {
  it('is skipped when its id starts with _', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fb277-'));
    try {
      copyFileSync(join('ventures', 'arca.yaml'), join(dir, 'arca.yaml'));
      writeFileSync(join(dir, 'factory.yaml'), readFileSync(join('ventures', 'arca.yaml'), 'utf8').replace(/^id:\s*arca\s*$/m, 'id: _factory'));
      expect(loadVentures(dir).map((v) => v.id)).toEqual(['arca']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
