import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * FB-274, FB-276: Accept and Send back on a finished card, in a test copy.
 *
 * A press on a factory card is recorded in the press store for the planning box to collect, and
 * never reaches GitHub. In a test copy it is also written as one line to the copy's state folder.
 * These tests use the real card store (the rig's, in memory, filled as the door fills it: FB-275)
 * and the real record; only the sign-in and GitHub are stand-ins, so they can show that nothing was
 * merged or written there.
 */

const auth = vi.fn();
const mergePullRequest = vi.fn();
const commentOnPullRequest = vi.fn();
const loadWork = vi.fn();

vi.mock('@/auth', () => ({ auth: () => auth() }));
vi.mock('@/lib/github', () => ({
  GitHubClient: class {
    mergePullRequest = mergePullRequest;
    commentOnPullRequest = commentOnPullRequest;
  },
  GitHubError: class extends Error {
    status = 0;
  },
}));
vi.mock('@/lib/work-load', () => ({
  loadWork: (...a: unknown[]) => loadWork(...a),
  githubWorkSource: () => ({}),
}));

const { acceptWork, sendBackWork } = await import('../work');
const { OUT_OF_DATE } = await import('@/lib/review');
const { cardStore } = await import('@/lib/card-store-live');
const { putTestCards } = await import('@/lib/__tests__/review-fixtures');

const JOHN = 'john.gallagher@wealthcx.com';
const FOUNDER = 'matthew@bruntsfield.capital';
const ROSS = 'ross@bruntsfield.capital';

let state: string;
const lines = () => {
  const file = join(state, 'presses.jsonl');
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const as = (email: string) => auth.mockResolvedValue({ user: { email } });

beforeEach(async () => {
  vi.clearAllMocks();
  state = mkdtempSync(join(tmpdir(), 'fb274-'));
  Object.assign(process.env, {
    E2E_TEST_LOGIN: '1',
    FACTORY_RUNTIME_STATE: state,
    STUDIO_ADMIN_EMAILS: JOHN,
    STUDIO_APPROVAL_GITHUB_TOKEN: 'test-token',
  });
  delete process.env.DATABASE_URL;
  // A new rig store for each test, so no test sees another's presses.
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('foundry-studio.rig-card-store')];
  await putTestCards(cardStore()!);
});

afterEach(() => {
  rmSync(state, { recursive: true, force: true });
  for (const k of ['E2E_TEST_LOGIN', 'FACTORY_RUNTIME_STATE', 'STUDIO_ADMIN_EMAILS', 'STUDIO_APPROVAL_GITHUB_TOKEN']) {
    delete process.env[k];
  }
});

describe('a press on a finished card, in a test copy', () => {
  it("a founder's Send back is recorded once, with the note, and nothing reaches GitHub", async () => {
    as(FOUNDER);
    const note = '1. On the "after" picture, on a phone, 80% across and 40% down: The button is cut off here';
    const r = await sendBackWork('arca', 'arca', 20, note);
    expect(r.ok).toBe(true);
    expect(lines()).toEqual([expect.objectContaining({ repo: 'arca', number: 20, by: FOUNDER, decision: 'sent-back', note })]);
    expect(commentOnPullRequest).not.toHaveBeenCalled();
    expect(mergePullRequest).not.toHaveBeenCalled();
  });

  it("a founder's Accept is their sign-off: recorded, merging nothing", async () => {
    as(FOUNDER);
    const r = await acceptWork('arca', 'arca', 21, 'sha-arca-21', 'About the whole thing: lovely.');
    expect(r).toMatchObject({ ok: true, signedOff: true });
    expect(lines()).toEqual([expect.objectContaining({ decision: 'signed-off', by: FOUNDER, note: 'About the whole thing: lovely.', seen: 'sha-arca-21' })]);
    expect(mergePullRequest).not.toHaveBeenCalled();
  });

  it("a second sign-off by the same founder records nothing more", async () => {
    as(FOUNDER);
    await acceptWork('arca', 'arca', 21, 'sha-arca-21');
    const again = await acceptWork('arca', 'arca', 21, 'sha-arca-21');
    expect(again).toMatchObject({ ok: true, signedOff: true });
    expect(lines()).toHaveLength(1);
  });

  it("John's Accept after the sign-off is the approval", async () => {
    as(FOUNDER);
    await acceptWork('arca', 'arca', 21, 'sha-arca-21');
    as(JOHN);
    const r = await acceptWork('arca', 'arca', 21, 'sha-arca-21');
    expect(r.ok).toBe(true);
    expect(r.signedOff).toBeUndefined();
    expect(lines().map((l) => l.decision)).toEqual(['signed-off', 'approved']);
    expect(mergePullRequest).not.toHaveBeenCalled();
  });

  it('a press on a card that is settled is out of date, and records nothing', async () => {
    as(JOHN);
    await acceptWork('arca', 'arca', 21, 'sha-arca-21');
    const r = await acceptWork('arca', 'arca', 21, 'sha-arca-21');
    expect(r).toEqual({ ok: false, message: OUT_OF_DATE });
    as(FOUNDER);
    expect(await sendBackWork('arca', 'arca', 21, 'Wait')).toEqual({ ok: false, message: OUT_OF_DATE });
    expect(lines()).toHaveLength(1);
  });

  it('a press on a version the person was not shown is refused', async () => {
    as(FOUNDER);
    const r = await acceptWork('arca', 'arca', 21, 'sha-something-else');
    expect(r.ok).toBe(false);
    expect(lines()).toHaveLength(0);
  });

  it("another venture's founder cannot press ARCA's card, by any address", async () => {
    as(ROSS);
    expect((await acceptWork('arca', 'arca', 20, 'sha-arca-20')).ok).toBe(false);
    expect((await sendBackWork('arca', 'arca', 20, 'no')).ok).toBe(false);
    // Through their own venture, naming ARCA's place: not part of their venture.
    expect((await sendBackWork('the-reset', 'arca', 20, 'no')).ok).toBe(false);
    expect(lines()).toHaveLength(0);
  });

  it('work that is not a card goes the way it always did, and is not recorded here', async () => {
    as(FOUNDER);
    loadWork.mockResolvedValue({ repo: 'arca', number: 10, title: 'x', headSha: 'sha-arca-10', checks: 'success', mergeable: true, merged: false, state: 'open' });
    commentOnPullRequest.mockResolvedValue({});
    const r = await acceptWork('arca', 'arca', 10, 'sha-arca-10');
    expect(r).toMatchObject({ ok: true, signedOff: true });
    expect(commentOnPullRequest).toHaveBeenCalledTimes(1);
    expect(lines()).toHaveLength(0);
  });

  it('outside a test copy nothing is recorded, even with the card files present', async () => {
    delete process.env.E2E_TEST_LOGIN;
    as(FOUNDER);
    loadWork.mockResolvedValue(null);
    const r = await acceptWork('arca', 'arca', 20, 'sha-arca-20');
    expect(r.ok).toBe(false);
    expect(lines()).toHaveLength(0);
  });
});

describe('notes with an Accept, outside a test copy', () => {
  beforeEach(() => {
    delete process.env.E2E_TEST_LOGIN;
    loadWork.mockResolvedValue({ repo: 'arca', number: 7, title: 'A change', headSha: '0123456789abcdef', checks: 'success', mergeable: true, merged: false, state: 'open' });
    commentOnPullRequest.mockResolvedValue({});
    mergePullRequest.mockResolvedValue({ merged: true });
  });

  it("a founder's notes are written beside their sign-off", async () => {
    as(FOUNDER);
    await acceptWork('arca', 'arca', 7, '0123456789abcdef', 'Make the button bigger.');
    const body = commentOnPullRequest.mock.calls[0][2] as string;
    expect(body).toContain(`Signed off by ${FOUNDER}, waiting for John`);
    expect(body).toContain('Make the button bigger.');
  });

  it("John's notes are written before it merges", async () => {
    as(JOHN);
    await acceptWork('arca', 'arca', 7, '0123456789abcdef', 'Ship it, then tidy the copy.');
    expect(commentOnPullRequest).toHaveBeenCalledTimes(1);
    expect(commentOnPullRequest.mock.invocationCallOrder[0]).toBeLessThan(mergePullRequest.mock.invocationCallOrder[0]);
  });

  it("if John's notes cannot be written, nothing merges", async () => {
    as(JOHN);
    commentOnPullRequest.mockRejectedValue(new Error('down'));
    const r = await acceptWork('arca', 'arca', 7, '0123456789abcdef', 'Notes.');
    expect(r.ok).toBe(false);
    expect(mergePullRequest).not.toHaveBeenCalled();
  });
});

describe("the factory's own cards can never be pressed or opened from the studio (FB-277)", () => {
  it('by a founder or by John, by any address', async () => {
    const { pressFactoryCard } = await import('../press');
    const { loadReview } = await import('@/lib/review-load');
    const { storedCard } = await import('@/lib/__tests__/review-fixtures');
    const store = cardStore()!;
    await store.putCard('_factory', { ...storedCard('cowgate', 40), repo: 'cowgate', state: 'finished' });
    for (const who of [FOUNDER, JOHN]) {
      as(who);
      for (const action of ['stop', 'accept', 'approve']) {
        expect((await pressFactoryCard('_factory', 'cowgate', 40, action)).ok).toBe(false);
        // Through a venture of theirs, naming cowgate: not one of that venture's repositories.
        expect((await pressFactoryCard('arca', 'cowgate', 40, action)).ok).toBe(false);
      }
      expect((await acceptWork('_factory', 'cowgate', 40, 'sha-cowgate-40')).ok).toBe(false);
      expect((await sendBackWork('_factory', 'cowgate', 40, 'no')).ok).toBe(false);
    }
    // The Review screen's loader, handed ARCA with cowgate added to its repositories: the database
    // scope still hands nothing over.
    const arca = { id: 'arca', name: 'ARCA', repos: ['arca', 'cowgate'], departments: [], founderEmail: FOUNDER } as never;
    expect(await loadReview(arca, 'cowgate', 40, { email: FOUNDER, isJohn: false, admins: [JOHN] }, store, { E2E_TEST_LOGIN: '1' })).toBeNull();
    expect(await store.presses('_factory', 'cowgate', 40)).toEqual([]);
    expect(lines()).toHaveLength(0);
  });
});
