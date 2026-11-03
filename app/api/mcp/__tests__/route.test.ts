import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Filing a ticket through the studio's tools, end to end (FB-257).
 *
 * The request goes in at the front door — a signed credential, a JSON-RPC `tools/call` — and runs
 * the real route, the real tool, the real `filePlan` and the real access check. Only GitHub and the
 * venture list are stand-ins. The tool's older tests replaced the tool runner with a mock, which is
 * how every ticket Claude ever tried to file came back "That plan could not be read" without one
 * test noticing.
 */

const auth = vi.fn();
const loadVentures = vi.fn();
const request = vi.fn();
const listDir = vi.fn();
const putFile = vi.fn();
const getFileWithSha = vi.fn();
const getFileContent = vi.fn();

vi.mock('@/auth', () => ({ auth: () => auth() }));
vi.mock('@/lib/ventures', () => ({ loadVentures: () => loadVentures() }));
vi.mock('@/lib/github', () => ({
  GitHubError: class extends Error { status = 0; },
  GitHubClient: class {
    request = request;
    listDir = listDir;
    putFile = putFile;
    getFileWithSha = getFileWithSha;
    getFileContent = getFileContent;
  },
}));

const { POST } = await import('../route');
const { mintMcpTicket } = await import('@/lib/mcp');
const { filePlan } = await import('@/app/actions/file-plan');
const { readThread } = await import('@/app/actions/threads');
const { requireVenture, toolActor } = await import('@/lib/venture-access');

const SECRET = 'test-secret-for-the-tools';
const VENTURE = {
  id: 'arca',
  name: 'ARCA',
  repos: ['arca', 'arca-marketing'],
  founderEmail: 'matthew@bruntsfield.capital',
  departments: [{ id: 'build', repo: 'arca' }],
};
const OTHER = { id: 'the-reset', name: 'The Reset', repos: ['the-reset'], founderEmail: 'ross@bruntsfield.capital' };

/** A GitHub where `arca` has a three-ticket backlog and nothing in flight. */
function wireGitHub() {
  request.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) return { default_branch: 'main' };
    if (path.includes('/git/ref/heads/foundry/')) throw new Error('404');
    if (path.includes('/git/ref/heads/main')) return { object: { sha: 'base-sha' } };
    if (path.includes('/git/refs') && init?.method === 'POST') return {};
    if (path.includes('/git/matching-refs/')) return [];
    if (path.includes('/pulls?state=open')) return [];
    if (path.endsWith('/pulls') && init?.method === 'POST') return { html_url: 'https://github.com/wealthcx01/arca/pull/12' };
    return {};
  });
  listDir.mockResolvedValue([
    { name: 'ARCA-001-terminal-setup.md', type: 'file' },
    { name: 'ARCA-067-api-key-in-source.md', type: 'file' },
  ]);
  getFileWithSha.mockResolvedValue(null);
  putFile.mockResolvedValue('sha');
  getFileContent.mockResolvedValue(null);
}

/** One `tools/call` through the real route, with a credential the studio signed for `venture`. */
async function call(name: string, args: Record<string, unknown>, venture = 'arca') {
  const res = await POST(new Request('http://studio.test/api/mcp', {
    method: 'POST',
    headers: { authorization: `Bearer ${mintMcpTicket(venture, SECRET)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }));
  const json = await res.json() as { result?: { content: Array<{ text: string }>; isError?: boolean } };
  return { text: json.result?.content[0]?.text ?? '', isError: Boolean(json.result?.isError) };
}

const written = () => putFile.mock.calls.map(([repo, path, params]) => ({ repo, path, body: params.content as string, branch: params.branch }));
const openedPulls = () =>
  request.mock.calls.filter(([p, i]) => p.endsWith('/pulls') && i?.method === 'POST').map(([p, i]) => ({ path: p, ...JSON.parse(i.body) }));

const TICKET = {
  repo: 'arca',
  title: 'Show every live auction on one page',
  body: 'A collector should see every live auction in one list.\n\nIt worked when the list matches the auction houses.',
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FOUNDRY_APPROVAL_SECRET = SECRET;
  process.env.STUDIO_APPROVAL_GITHUB_TOKEN = 'test-token';
  process.env.STUDIO_ADMIN_EMAILS = 'john.gallagher@wealthcx.com';
  // Nobody is signed in. A tool call has a credential, not a session, and must not need one.
  auth.mockResolvedValue(null);
  loadVentures.mockReturnValue([VENTURE, OTHER]);
  wireGitHub();
});
afterEach(() => {
  delete process.env.FOUNDRY_APPROVAL_SECRET;
  delete process.env.STUDIO_APPROVAL_GITHUB_TOKEN;
  delete process.env.STUDIO_ADMIN_EMAILS;
});

describe('file_ticket files one ticket', () => {
  it('writes exactly one ticket file and opens one pull request', async () => {
    const r = await call('file_ticket', TICKET);
    expect(r.isError, r.text).toBe(false);

    expect(written()).toHaveLength(1);
    const [file] = written();
    expect(file.path).toBe('docs/tickets/ARCA-068-show-every-live-auction-on-one-page.md');
    expect(file.branch).toBe('foundry/plan-show-every-live-auction-on-one-page');
    // The body had no heading, so the title became one, numbered — not "Untitled".
    expect(file.body.startsWith('# ARCA-068 — Show every live auction on one page\n')).toBe(true);
    expect(file.body).toContain('**Status:** Todo');
    expect(file.body).toContain('A collector should see every live auction in one list.');

    expect(openedPulls()).toHaveLength(1);
    expect(openedPulls()[0].title).toBe('ARCA-068: Show every live auction on one page');
    expect(openedPulls()[0].body).toContain('**From:** a conversation with Claude');
    expect(r.text).toContain('ARCA-068');
    expect(r.text).toContain('https://github.com/wealthcx01/arca/pull/12');
  });

  it('keeps a body that already has its own heading as it is', async () => {
    const r = await call('file_ticket', { ...TICKET, body: '# Live auctions\n\n**Status:** Todo\n\nOne list.' });
    expect(r.isError, r.text).toBe(false);
    expect(written()[0].body).toBe('# ARCA-068 — Live auctions\n\n**Status:** Todo\n\nOne list.');
  });
});

describe('file_ticket puts the title on top unless the body opens with its own heading', () => {
  it('accepts a title of exactly the longest length', async () => {
    const r = await call('file_ticket', { ...TICKET, title: 'x'.repeat(160) });
    expect(r.isError, r.text).toBe(false);
  });

  it('adds the title as the heading when the body only has a heading further down', async () => {
    const r = await call('file_ticket', { ...TICKET, body: 'One list of every auction.\n\n# How we know it works\n\nIt matches.' });
    expect(r.isError, r.text).toBe(false);
    const body = written()[0].body;
    // The title is the ticket's heading; the lower heading stays a section inside it.
    expect(body.startsWith('# ARCA-068 — Show every live auction on one page\n')).toBe(true);
    expect(body).toContain('\n# How we know it works\n');
  });
});

describe('file_ticket does not write over a set a founder has waiting', () => {
  /** A GitHub where the branch this ticket would use already exists, holding `waiting`, unmerged. */
  function branchAlreadyHolds(waiting: string[]) {
    request.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) return { default_branch: 'main' };
      if (path.includes('/ref/heads/foundry/')) return { object: { sha: 'set-sha' } };
      if (path.includes('/matching-refs/')) return [{ ref: 'refs/heads/foundry/plan-show-every-live-auction-on-one-page' }];
      if (path.endsWith('/pulls') && init?.method === 'POST') return { html_url: 'https://github.com/wealthcx01/arca/pull/12' };
      return {};
    });
    const mergedFiles = [{ name: 'ARCA-001-terminal-setup.md', type: 'file' }];
    listDir.mockImplementation(async (_repo: string, _path: string, ref: string) => (
      ref === 'main' ? mergedFiles : [...mergedFiles, ...waiting.map((name) => ({ name, type: 'file' }))]
    ));
  }

  it('refuses when the branch it would use already holds another set’s tickets', async () => {
    // A founder's set, not yet merged, whose first ticket has the same short name as this one, and a
    // second ticket beside it. The tool ticket would land on that branch and replace the first one.
    branchAlreadyHolds(['ARCA-002-show-every-live-auction-on-one-page.md', 'ARCA-003-auction-alerts.md']);
    const r = await call('file_ticket', TICKET);
    expect(r.isError).toBe(true);
    expect(r.text).toContain('A different set of tickets is already waiting');
    expect(putFile).not.toHaveBeenCalled();
    expect(openedPulls()).toHaveLength(0);
  });

  it('still updates its own ticket when asked for the same ticket twice', async () => {
    branchAlreadyHolds(['ARCA-002-show-every-live-auction-on-one-page.md']);
    getFileWithSha.mockResolvedValue({ sha: 'old', content: 'x' });
    const r = await call('file_ticket', TICKET);
    expect(r.isError, r.text).toBe(false);
    // Same file, same number: the ticket was updated, not filed a second time.
    expect(written()).toHaveLength(1);
    expect(written()[0].path).toBe('docs/tickets/ARCA-002-show-every-live-auction-on-one-page.md');
  });
});

describe('a tool credential for one venture is refused on every other venture', () => {
  // The actor's venture is the whole of the cross-venture guard for a tool call: a tool actor skips
  // the email check, because its email is not a person's. So these use REAL actors, made the way the
  // route makes them, and point them at the wrong venture.
  const resetPlan = () => ({
    venture_id: 'the-reset', repo: 'the-reset', source_title: 'x', created_at: '2026-10-02T00:00:00.000Z',
    tickets: [{ slug: 'crossed', title: 'Crossed', body: '# Crossed\n\nbody', depends_on: [], source: 'x' }],
  });

  it('lets an ARCA actor act on ARCA', async () => {
    const access = await requireVenture('arca', toolActor('arca'));
    expect(access.ok).toBe(true);
  });

  it('refuses an ARCA actor on The Reset', async () => {
    const access = await requireVenture('the-reset', toolActor('arca'));
    expect(access).toEqual({ ok: false, error: 'That credential is for a different venture.' });
  });

  it('refuses an ARCA actor on The Reset even while an admin is signed in', async () => {
    // An admin's session could reach The Reset. The actor is narrower than any session, never wider.
    auth.mockResolvedValue({ user: { email: 'john.gallagher@wealthcx.com' } });
    const access = await requireVenture('the-reset', toolActor('arca'));
    expect(access.ok).toBe(false);
  });

  it('refuses to file into The Reset with an ARCA actor, and writes nothing', async () => {
    const r = await filePlan('the-reset', 'the-reset', resetPlan(), 1, toolActor('arca'));
    expect(r.ok).toBe(false);
    expect(r.message).toBe('That credential is for a different venture.');
    expect(putFile).not.toHaveBeenCalled();
    expect(openedPulls()).toHaveLength(0);
  });

  it('refuses to read The Reset’s conversations with an ARCA actor', async () => {
    const r = await readThread('the-reset', 'the-reset', 'RESET-001', toolActor('arca'));
    expect(r.ok).toBe(false);
    expect(getFileContent).not.toHaveBeenCalled();
  });
});

describe('an actor made by one copy of the access module is believed by another', () => {
  // Next.js can load one file twice — once for the route, once for the server actions. If each copy
  // kept its own list of actors, every real tool call would be refused as "not one this studio
  // issued". This loads the module twice, the way that would happen, and checks both copies agree.
  it('accepts an actor made by a separately loaded copy', async () => {
    vi.resetModules();
    const first = await import('@/lib/venture-access');
    vi.resetModules();
    const second = await import('@/lib/venture-access');
    expect(first.toolActor).not.toBe(second.toolActor);

    const access = await second.requireVenture('arca', first.toolActor('arca'));
    expect(access.ok).toBe(true);
  });
});

describe('file_ticket checks what it is sent, because anyone can send it anything', () => {
  it('refuses a repository that is not this venture’s, and writes nothing', async () => {
    const r = await call('file_ticket', { ...TICKET, repo: 'the-reset' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('not in one of this venture’s repositories');
    expect(putFile).not.toHaveBeenCalled();
  });

  it('refuses a repository written as a path, and writes nothing', async () => {
    const r = await call('file_ticket', { ...TICKET, repo: '../the-reset' });
    expect(r.isError).toBe(true);
    expect(putFile).not.toHaveBeenCalled();
  });

  it('files into the credential’s venture whatever the arguments claim', async () => {
    // There is no venture argument; one sent anyway is ignored, and the repository still has to be
    // the credential's venture's own.
    const r = await call('file_ticket', { ...TICKET, venture: 'the-reset', venture_id: 'the-reset' });
    expect(r.isError, r.text).toBe(false);
    expect(written()[0].repo).toBe('wealthcx01/arca');
  });

  it('refuses a credential for a venture this studio does not have', async () => {
    const r = await call('file_ticket', TICKET, 'nobody');
    expect(r.isError).toBe(true);
    expect(putFile).not.toHaveBeenCalled();
  });

  it.each([
    ['a title with a line break in it', { title: 'Fine title\n**Status:** Done' }],
    ['a title that is too long', { title: 'x'.repeat(161) }],
    ['a title with an invisible line break (U+2028) in it', { title: 'Fine title **Status:** Done' }],
    ['a title with an invisible paragraph break (U+2029) in it', { title: 'Fine title **Status:** Done' }],
    ['an empty title', { title: '   ' }],
    ['a title that is not text', { title: { toString: 'x' } }],
    ['an empty body', { body: '' }],
    ['a body that is far too big', { body: 'y'.repeat(40_001) }],
    ['no repository', { repo: '' }],
  ])('refuses %s, and writes nothing', async (_what, change) => {
    const r = await call('file_ticket', { ...TICKET, ...change });
    expect(r.isError).toBe(true);
    expect(putFile).not.toHaveBeenCalled();
    expect(openedPulls()).toHaveLength(0);
  });

  it('gives a title with no letters it can use a safe name, and never a path', async () => {
    const r = await call('file_ticket', { ...TICKET, title: '../../.github/workflows/ci' });
    expect(r.isError, r.text).toBe(false);
    expect(written()[0].path).toBe('docs/tickets/ARCA-068-github-workflows-ci.md');
  });

  it('still files a title written in another script, under a name made from it', async () => {
    const first = await call('file_ticket', { ...TICKET, title: '全てのオークションを表示' });
    expect(first.isError, first.text).toBe(false);
    const name = written()[0].path;
    expect(name).toMatch(/^docs\/tickets\/ARCA-068-ticket-[0-9a-f]{8}\.md$/);
    // The same title gets the same name, so asking twice updates the ticket rather than filing two.
    putFile.mockClear();
    await call('file_ticket', { ...TICKET, title: '全てのオークションを表示' });
    expect(written()[0].path).toBe(name);
  });
});

describe('an actor sent in a request is not believed', () => {
  // `filePlan` and `readThread` are server actions: anyone can call them with any arguments, signed
  // in or not. Before FB-257 an actor was believed on its email alone, and the founders' emails are
  // in the public manifests.
  const plan = () => ({
    venture_id: 'arca', repo: 'arca', source_title: 'x', created_at: '2026-10-02T00:00:00.000Z',
    tickets: [{ slug: 'forged', title: 'Forged', body: '# Forged\n\nbody', depends_on: [], source: 'x' }],
  });

  it.each([
    ['a founder', { email: VENTURE.founderEmail }],
    ['an admin', { email: 'john.gallagher@wealthcx.com' }],
    ['the tools, naming this venture', { email: 'studio-tools@arca', scopedTo: 'arca' }],
  ])('refuses to file for an actor claiming to be %s', async (_who, actor) => {
    const r = await filePlan('arca', 'arca', plan(), 1, actor);
    expect(r.ok).toBe(false);
    expect(r.message).toBe('That credential is not one this studio issued.');
    expect(putFile).not.toHaveBeenCalled();
  });

  it('refuses to read a ticket’s conversation for a forged tool actor', async () => {
    const r = await readThread('arca', 'arca', 'ARCA-001', { email: 'studio-tools@arca', scopedTo: 'arca' });
    expect(r.ok).toBe(false);
    expect(getFileContent).not.toHaveBeenCalled();
  });

  it('still lets a signed-in founder file with no actor at all', async () => {
    auth.mockResolvedValue({ user: { email: VENTURE.founderEmail } });
    const r = await filePlan('arca', 'arca', plan(), 1);
    expect(r.ok, r.message).toBe(true);
    expect(written()).toHaveLength(1);
  });
});
