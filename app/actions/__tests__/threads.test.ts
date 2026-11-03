import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The thread server actions (FB-126).
 *
 * What is under test is the REFUSALS and their order — venture isolation, the repo allowlist, and
 * what happens when a read fails. The write itself is one `putFile`; who is allowed to reach it, and
 * what a founder is told when it does not work, is the whole question.
 */

const auth = vi.fn();
const loadVentures = vi.fn();
const getFileContent = vi.fn();
const putFile = vi.fn();

vi.mock('@/auth', () => ({ auth: () => auth() }));
vi.mock('@/lib/ventures', () => ({ loadVentures: () => loadVentures() }));
vi.mock('@/lib/github', () => ({
  GitHubClient: class {
    getFileContent = getFileContent;
    putFile = putFile;
  },
}));

const { readThread, appendToThread } = await import('../threads');

const VENTURE = {
  id: 'arca',
  name: 'ARCA',
  repos: ['arca', 'arca-marketing'],
  founderEmail: 'matthew@bruntsfield.capital',
  departments: [{ id: 'build', repo: 'arca' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STUDIO_APPROVAL_GITHUB_TOKEN = 'test-token';
  process.env.STUDIO_ADMIN_EMAILS = 'john.gallagher@wealthcx.com';
  auth.mockResolvedValue({ user: { email: VENTURE.founderEmail } });
  loadVentures.mockReturnValue([VENTURE]);
  getFileContent.mockResolvedValue(null);
  putFile.mockResolvedValue(undefined);
});
afterEach(() => {
  delete process.env.STUDIO_APPROVAL_GITHUB_TOKEN;
  delete process.env.STUDIO_ADMIN_EMAILS;
});

describe('who may reach a conversation', () => {
  it('gives the founder an empty thread when none exists', async () => {
    const r = await readThread('arca', 'arca', 'ARCA-068');
    expect(r.ok).toBe(true);
    expect(r.thread?.messages).toEqual([]);
  });

  it('refuses someone not signed in', async () => {
    auth.mockResolvedValue(null);
    expect((await readThread('arca', 'arca', 'ARCA-068')).ok).toBe(false);
    expect((await appendToThread('arca', 'arca', 'ARCA-068', 'founder', 'x')).ok).toBe(false);
    expect(putFile).not.toHaveBeenCalled();
  });

  it('refuses a venture this person cannot reach', async () => {
    auth.mockResolvedValue({ user: { email: 'someone.else@bruntsfield.capital' } });
    expect((await readThread('arca', 'arca', 'ARCA-068')).ok).toBe(false);
    expect(putFile).not.toHaveBeenCalled();
  });

  it('refuses a repo the venture does not declare, even for its founder', async () => {
    // A thread written into a repo nobody scoped this founder to is their own words in someone
    // else's venture.
    const r = await appendToThread('arca', 'some-other-repo', 'ARCA-068', 'founder', 'x');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('repositories');
    expect(putFile).not.toHaveBeenCalled();
  });

  it('refuses a ticket id that could escape the directory', async () => {
    const r = await appendToThread('arca', 'arca', '../../etc/passwd', 'founder', 'x');
    expect(r.ok).toBe(false);
    expect(putFile).not.toHaveBeenCalled();
  });
});

describe('what a founder is told when it does not work', () => {
  it('a failed read is not shown as an empty conversation', async () => {
    // The dangerous one: showing an empty thread would tell a founder their conversation is gone.
    getFileContent.mockRejectedValue(new Error('502'));
    const r = await readThread('arca', 'arca', 'ARCA-068');
    expect(r.ok).toBe(false);
    expect(r.thread).toBeUndefined();
  });

  it('a stored-but-unreadable thread is reported, not written over', async () => {
    getFileContent.mockResolvedValue('{ not json');
    const r = await readThread('arca', 'arca', 'ARCA-068');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/could not be read/i);
    expect(putFile).not.toHaveBeenCalled();
  });

  it('a failed write says so rather than showing the message as saved', async () => {
    putFile.mockRejectedValue(new Error('403'));
    const r = await appendToThread('arca', 'arca', 'ARCA-068', 'founder', 'the second line is wrong');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/could not save/i);
  });

  it('says plainly when the studio has no write token', async () => {
    delete process.env.STUDIO_APPROVAL_GITHUB_TOKEN;
    const r = await appendToThread('arca', 'arca', 'ARCA-068', 'founder', 'x');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not set up/i);
  });
});

describe('what appending is, and is not', () => {
  it('writes to the state ref, beside the other machine-written venture state', async () => {
    await appendToThread('arca', 'arca', 'ARCA-068', 'founder', 'the second line is wrong');
    expect(putFile).toHaveBeenCalledTimes(1);
    const [repo, path, opts] = putFile.mock.calls[0];
    expect(repo).toContain('arca');
    expect(path).toBe('threads/arca/ARCA-068.json');
    expect(opts).toMatchObject({ branch: 'foundry-state' });
  });

  it('files nothing — a conversation is not a filing', async () => {
    // FB-119's two shapes hold here. Adding to a thread opens no pull request, changes no ticket and
    // tells no lane to do anything; only an explicit filing does that.
    await appendToThread('arca', 'arca', 'ARCA-068', 'founder', 'x');
    const paths = putFile.mock.calls.map((c) => c[1] as string);
    expect(paths.every((p) => p.startsWith('threads/'))).toBe(true);
    expect(paths.some((p) => p.startsWith('docs/tickets/'))).toBe(false);
  });

  it('does not write an empty turn', async () => {
    expect((await appendToThread('arca', 'arca', 'ARCA-068', 'founder', '   ')).ok).toBe(false);
    expect(putFile).not.toHaveBeenCalled();
  });
});
