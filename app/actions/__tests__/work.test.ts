import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Only John's Approve merges (FB-272, CLAUDE.md rule 2).
 *
 * Before FB-272 a founder's "Accept" merged their venture's work. Now it is their sign-off: it is
 * written on the pull request as "Signed off by <founder>, waiting for John", and nothing is merged.
 * John's Accept still merges, exactly as before.
 *
 * GitHub is replaced by a stand-in here, so the test can see whether a merge was asked for at all.
 */

const auth = vi.fn();
const loadVentures = vi.fn();
const mergePullRequest = vi.fn();
const commentOnPullRequest = vi.fn();
const loadWork = vi.fn();
const acceptability = vi.fn();

vi.mock('@/auth', () => ({ auth: () => auth() }));
vi.mock('@/lib/ventures', () => ({ loadVentures: () => loadVentures() }));
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
vi.mock('@/lib/work', () => ({ acceptability: (...a: unknown[]) => acceptability(...a) }));

const { acceptWork } = await import('../work');

const JOHN = 'john.gallagher@wealthcx.com';
const FOUNDER = 'matthew@bruntsfield.capital';
const VENTURE = { id: 'arca', name: 'ARCA', repos: ['arca'], founderEmail: FOUNDER };
const OTHER = { id: 'the-reset', name: 'THE RESET', repos: ['the-reset'], founderEmail: 'ross@bruntsfield.capital' };
const WORK = { repo: 'arca', number: 7, title: 'A change', headSha: '0123456789abcdef' };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STUDIO_APPROVAL_GITHUB_TOKEN = 'test-token';
  process.env.STUDIO_ADMIN_EMAILS = JOHN;
  loadVentures.mockReturnValue([VENTURE, OTHER]);
  loadWork.mockResolvedValue(WORK);
  acceptability.mockReturnValue({ ok: true, text: '' });
  mergePullRequest.mockResolvedValue({ merged: true });
  commentOnPullRequest.mockResolvedValue({ html_url: 'https://example.invalid/c/1' });
});

afterEach(() => {
  delete process.env.STUDIO_APPROVAL_GITHUB_TOKEN;
  delete process.env.STUDIO_ADMIN_EMAILS;
});

describe("a founder's Accept", () => {
  beforeEach(() => auth.mockResolvedValue({ user: { email: FOUNDER } }));

  it('merges nothing', async () => {
    const r = await acceptWork('arca', 'arca', 7, WORK.headSha);
    expect(mergePullRequest).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    expect(r.signedOff).toBe(true);
  });

  it('is written on the work as their sign-off, waiting for John', async () => {
    await acceptWork('arca', 'arca', 7, WORK.headSha);
    expect(commentOnPullRequest).toHaveBeenCalledTimes(1);
    const [repo, number, body] = commentOnPullRequest.mock.calls[0];
    expect(repo).toBe('wealthcx01/arca');
    expect(number).toBe(7);
    expect(body).toContain(`Signed off by ${FOUNDER}, waiting for John`);
    // The commit they read, so John knows exactly what was signed off.
    expect(body).toContain('0123456');
  });

  it('tells the founder it is waiting for John, and does not say it was merged', async () => {
    const r = await acceptWork('arca', 'arca', 7, WORK.headSha);
    expect(r.message).toMatch(/waiting for John/);
    expect(r.message).not.toMatch(/now part of your product/);
  });

  it('is refused, and nothing is written, when the work changed since they read it', async () => {
    acceptability.mockReturnValue({ ok: false, text: 'This work changed while you were reading it.' });
    const r = await acceptWork('arca', 'arca', 7, 'an-older-commit');
    expect(r.ok).toBe(false);
    expect(commentOnPullRequest).not.toHaveBeenCalled();
    expect(mergePullRequest).not.toHaveBeenCalled();
  });

  it("is refused for another founder's venture, and nothing is read or written", async () => {
    const r = await acceptWork('the-reset', 'the-reset', 7);
    expect(r.ok).toBe(false);
    expect(loadWork).not.toHaveBeenCalled();
    expect(commentOnPullRequest).not.toHaveBeenCalled();
    expect(mergePullRequest).not.toHaveBeenCalled();
  });
});

describe("John's Accept", () => {
  beforeEach(() => auth.mockResolvedValue({ user: { email: JOHN } }));

  it('still merges, pinned to the commit that was read', async () => {
    const r = await acceptWork('arca', 'arca', 7, WORK.headSha);
    expect(mergePullRequest).toHaveBeenCalledTimes(1);
    expect(mergePullRequest).toHaveBeenCalledWith('wealthcx01/arca', 7, { sha: WORK.headSha, method: 'squash', title: WORK.title });
    expect(r).toMatchObject({ ok: true, message: 'Accepted. It is now part of your product.' });
    expect(r.signedOff).toBeFalsy();
    expect(commentOnPullRequest).not.toHaveBeenCalled();
  });

  it('matches the admin list whatever the case of the address', async () => {
    auth.mockResolvedValue({ user: { email: 'John.Gallagher@WealthCX.com' } });
    await acceptWork('arca', 'arca', 7, WORK.headSha);
    expect(mergePullRequest).toHaveBeenCalledTimes(1);
  });
});

describe('who counts as John', () => {
  it('is whoever STUDIO_ADMIN_EMAILS names, and nobody else: the same address as a founder merges nothing', async () => {
    process.env.STUDIO_ADMIN_EMAILS = '';
    auth.mockResolvedValue({ user: { email: JOHN } });
    loadVentures.mockReturnValue([{ ...VENTURE, founderEmail: JOHN }]);
    const r = await acceptWork('arca', 'arca', 7, WORK.headSha);
    expect(mergePullRequest).not.toHaveBeenCalled();
    expect(r.signedOff).toBe(true);
  });
});
