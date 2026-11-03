import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Filing a plan as a set (FB-127).
 *
 * Four things are under test, and they are the four acceptance criteria that can fail silently:
 * ONE branch and ONE pull request for N tickets, N distinct ids at the backlog's width, dependencies
 * that resolve across a set where nothing has merged, and nothing filed without the press.
 */

const auth = vi.fn();
const loadVentures = vi.fn();
const request = vi.fn();
const listDir = vi.fn();
const putFile = vi.fn();
const getFileWithSha = vi.fn();

vi.mock('@/auth', () => ({ auth: () => auth() }));
vi.mock('@/lib/ventures', () => ({ loadVentures: () => loadVentures() }));
vi.mock('@/lib/github', () => ({
  GitHubError: class extends Error { status = 0; },
  GitHubClient: class {
    request = request;
    listDir = listDir;
    putFile = putFile;
    getFileWithSha = getFileWithSha;
  },
}));

const { filePlan } = await import('../file-plan');
const { strikeTicket } = await import('@/lib/plan-draft');
import type { PlanDraft } from '@/lib/plan-draft';
import { MAP, PLAN } from '@/lib/__tests__/fixtures/founding-walk';

const VENTURE = {
  id: 'arca',
  name: 'ARCA',
  repos: ['arca', 'arca-marketing'],
  founderEmail: 'matthew@bruntsfield.capital',
  departments: [{ id: 'build', repo: 'arca' }],
};

/** ARCA's real backlog: filed by hand, three digits, up to 067. */
const BACKLOG = [
  { name: 'ARCA-001-terminal-setup.md', type: 'file' },
  { name: 'ARCA-066-e2e-smoke-in-ci.md', type: 'file' },
  { name: 'ARCA-067-api-key-in-source.md', type: 'file' },
];

const plan = (): PlanDraft => ({
  venture_id: 'arca',
  repo: 'arca',
  source_title: 'Auction aggregator PRD',
  created_at: '2026-08-28T09:00:00.000Z',
  tickets: [
    { slug: 'auction-source-research', title: 'Which auction houses publish a feed', body: '# Which auction houses publish a feed\n\n**Status:** Todo · **Area:** Research · **Depends on:** —\n\nbody', depends_on: [], source: '§1' },
    { slug: 'auction-feed-ingestion', title: 'Ingest auction feeds', body: '# Ingest auction feeds\n\n**Status:** Todo · **Area:** ETL · **Depends on:** —\n\nbody', depends_on: ['auction-source-research'], source: '§2' },
    { slug: 'auction-live-view', title: 'One page showing every live auction', body: '# One page showing every live auction\n\n**Status:** Todo · **Area:** Web · **Depends on:** —\n\nbody', depends_on: ['auction-feed-ingestion'], source: '§3' },
  ],
});

/** The GitHub calls the action makes, routed by path so a test can read what actually happened. */
function wireGitHub({ existingBranch = false }: { existingBranch?: boolean } = {}) {
  request.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) return { default_branch: 'main' };
    if (path.includes('/git/ref/heads/foundry/')) {
      if (!existingBranch) throw new Error('404');
      return { object: { sha: 'branch-sha' } };
    }
    if (path.includes('/git/ref/heads/main')) return { object: { sha: 'base-sha' } };
    if (path.includes('/git/refs') && init?.method === 'POST') return {};
    if (path.includes('/git/matching-refs/')) return [];
    if (path.includes('/pulls?state=open')) return [];
    if (path.endsWith('/pulls') && init?.method === 'POST') return { html_url: 'https://github.com/wealthcx01/arca/pull/9' };
    return {};
  });
  listDir.mockResolvedValue(BACKLOG);
  getFileWithSha.mockResolvedValue(null);
  putFile.mockResolvedValue('sha');
}

/**
 * The state after a first press: the branch exists, the pull request is open, and the set's own
 * tickets are on that branch and therefore in the in-flight union.
 */
function pressedOnce({
  filed = ['ARCA-068-auction-source-research.md', 'ARCA-069-auction-feed-ingestion.md', 'ARCA-070-auction-live-view.md'],
  merged = BACKLOG,
}: { filed?: string[]; merged?: Array<{ name: string; type: string }> } = {}) {
  const branch = 'foundry/plan-auction-source-research';
  request.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) return { default_branch: 'main' };
    if (path.includes('/git/ref/heads/foundry/')) return { object: { sha: 'branch-sha' } };
    if (path.includes('/git/matching-refs/')) return [{ ref: `refs/heads/${branch}` }];
    if (path.includes('/pulls?state=open')) return [{ html_url: 'https://github.com/wealthcx01/arca/pull/9' }];
    return {};
  });
  listDir.mockImplementation(async (_r: string, _p: string, ref: string) =>
    ref === 'main' ? merged : filed.map((name) => ({ name, type: 'file' })));
  getFileWithSha.mockImplementation(async (_r: string, path: string) =>
    filed.some((f) => path.endsWith(f)) ? { text: '', sha: 'old' } : null);
}

/** Every file the action wrote, as `{ path, body }`. */
const written = () => putFile.mock.calls.map(([, path, params]) => ({ path, body: params.content, branch: params.branch }));
const createdBranches = () =>
  request.mock.calls.filter(([p, i]) => p.includes('/git/refs') && i?.method === 'POST').map(([, i]) => JSON.parse(i.body).ref);
const openedPulls = () =>
  request.mock.calls.filter(([p, i]) => p.endsWith('/pulls') && i?.method === 'POST').map(([, i]) => JSON.parse(i.body));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STUDIO_APPROVAL_GITHUB_TOKEN = 'test-token';
  process.env.STUDIO_ADMIN_EMAILS = 'john.gallagher@wealthcx.com';
  auth.mockResolvedValue({ user: { email: VENTURE.founderEmail } });
  loadVentures.mockReturnValue([VENTURE]);
  wireGitHub();
});
afterEach(() => {
  delete process.env.STUDIO_APPROVAL_GITHUB_TOKEN;
  delete process.env.STUDIO_ADMIN_EMAILS;
});

describe('one press, one branch, one pull request', () => {
  it('files three tickets on one branch', async () => {
    const r = await filePlan('arca', 'arca', plan(), 3);
    expect(r.ok, r.message).toBe(true);
    expect(written()).toHaveLength(3);
    expect(new Set(written().map((w) => w.branch)).size).toBe(1);
    expect(createdBranches()).toEqual(['refs/heads/foundry/plan-auction-source-research']);
  });

  it('opens exactly one pull request for the set', async () => {
    // The 2026-08-23 run produced five. A set is one decision and lands as one.
    const r = await filePlan('arca', 'arca', plan(), 3);
    expect(openedPulls()).toHaveLength(1);
    expect(r.url).toBe('https://github.com/wealthcx01/arca/pull/9');
  });

  it('names every ticket in the pull request body, so the set is readable before it is opened', async () => {
    await filePlan('arca', 'arca', plan(), 3);
    const body = openedPulls()[0].body as string;
    for (const id of ['ARCA-068', 'ARCA-069', 'ARCA-070']) expect(body).toContain(id);
    expect(body).toContain('Auction aggregator PRD');
  });

  it('updates the same branch and reuses the pull request when pressed twice', async () => {
    pressedOnce();
    const r = await filePlan('arca', 'arca', plan(), 3);
    expect(r.ok, r.message).toBe(true);
    expect(openedPulls()).toHaveLength(0);
    expect(createdBranches()).toEqual([]);
  });

  it('a second press updates the set rather than doubling it', async () => {
    // Pressing twice is ordinary — a founder who is not sure the first press landed presses again.
    // Without this the first press's tickets are on the branch, the union counts them, the allocator
    // steps past them, and the branch carries every ticket twice under two sets of numbers.
    pressedOnce();
    await filePlan('arca', 'arca', plan(), 3);
    expect(written().map((w) => w.path)).toEqual([
      'docs/tickets/ARCA-068-auction-source-research.md',
      'docs/tickets/ARCA-069-auction-feed-ingestion.md',
      'docs/tickets/ARCA-070-auction-live-view.md',
    ]);
  });

  it('gives a line added after the first press a fresh number, and leaves the others alone', async () => {
    pressedOnce({ filed: ['ARCA-068-auction-source-research.md', 'ARCA-069-auction-feed-ingestion.md'] });
    await filePlan('arca', 'arca', plan(), 3);
    expect(written().map((w) => w.path)).toEqual([
      'docs/tickets/ARCA-068-auction-source-research.md',
      'docs/tickets/ARCA-069-auction-feed-ingestion.md',
      'docs/tickets/ARCA-070-auction-live-view.md',
    ]);
  });
});

describe('the ids the set is filed under', () => {
  it('gives three tickets three different numbers, at the backlog’s width', async () => {
    await filePlan('arca', 'arca', plan(), 3);
    const paths = written().map((w) => w.path);
    expect(paths).toEqual([
      'docs/tickets/ARCA-068-auction-source-research.md',
      'docs/tickets/ARCA-069-auction-feed-ingestion.md',
      'docs/tickets/ARCA-070-auction-live-view.md',
    ]);
  });

  it('counts tickets already waiting on other branches, not just what has merged', async () => {
    // FB-117: each filing writes to its own branch and the default branch never sees it.
    request.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) return { default_branch: 'main' };
      if (path.includes('/git/ref/heads/foundry/')) throw new Error('404');
      if (path.includes('/git/ref/heads/main')) return { object: { sha: 'base-sha' } };
      if (path.includes('/git/refs') && init?.method === 'POST') return {};
      if (path.includes('/git/matching-refs/')) return [{ ref: 'refs/heads/foundry/price-freshness' }];
      if (path.includes('/pulls?state=open')) return [];
      if (path.endsWith('/pulls') && init?.method === 'POST') return { html_url: 'https://x/9' };
      return {};
    });
    listDir.mockImplementation(async (_r: string, _p: string, ref: string) =>
      ref === 'main' ? BACKLOG : [{ name: 'ARCA-068-price-freshness.md', type: 'file' }]);

    await filePlan('arca', 'arca', plan(), 3);
    expect(written().map((w) => w.path)[0]).toBe('docs/tickets/ARCA-069-auction-source-research.md');
  });

  it('writes the id into the ticket’s own heading, not only its filename', async () => {
    await filePlan('arca', 'arca', plan(), 3);
    expect(written()[0].body).toContain('# ARCA-068 — Which auction houses publish a feed');
  });

  it('reads the prefix off the backlog rather than assuming the repo name', async () => {
    listDir.mockResolvedValue([{ name: 'PKMN-004-x.md', type: 'file' }]);
    await filePlan('arca', 'arca', plan(), 3);
    expect(written().map((w) => w.path)[0]).toBe('docs/tickets/PKMN-005-auction-source-research.md');
  });
});

describe('dependencies that resolve while nothing has merged', () => {
  it('writes real ids into every Depends on line', async () => {
    await filePlan('arca', 'arca', plan(), 3);
    const [research, ingestion, view] = written();
    expect(research.body).toContain('**Depends on:** —');
    expect(ingestion.body).toContain('**Depends on:** ARCA-068');
    expect(view.body).toContain('**Depends on:** ARCA-069');
  });

  it('files everything a ticket depends on before the ticket', async () => {
    await filePlan('arca', 'arca', plan(), 3);
    expect(written().map((w) => w.path.match(/ARCA-(\d+)/)?.[1])).toEqual(['068', '069', '070']);
  });

  it('re-points a dependency around a struck line instead of leaving it dangling', async () => {
    // Strike ingestion: the view still needs the research ingestion needed.
    const struck = strikeTicket(plan(), 'auction-feed-ingestion', true);
    const r = await filePlan('arca', 'arca', struck, 2);
    expect(r.ok, r.message).toBe(true);
    expect(written()).toHaveLength(2);
    expect(written()[1].body).toContain('**Depends on:** ARCA-068');
  });

  it('never writes a slug where an id belongs', async () => {
    await filePlan('arca', 'arca', plan(), 3);
    for (const w of written()) expect(w.body).not.toContain('**Depends on:** auction-');
  });
});

describe('the struck line is gone, not hidden', () => {
  it('does not file it and does not reserve it a number', async () => {
    const struck = strikeTicket(plan(), 'auction-live-view', true);
    await filePlan('arca', 'arca', struck, 2);
    const paths = written().map((w) => w.path);
    expect(paths).toEqual([
      'docs/tickets/ARCA-068-auction-source-research.md',
      'docs/tickets/ARCA-069-auction-feed-ingestion.md',
    ]);
  });
});

describe('nothing files without the press', () => {
  it('refuses a count that does not match what the founder was shown', async () => {
    // A strike that landed between the render and the press changes the number. Filing three to a
    // founder who read two is the failure this exists to prevent.
    const r = await filePlan('arca', 'arca', plan(), 2);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Nothing was filed');
    expect(putFile).not.toHaveBeenCalled();
  });

  it('refuses a plan with a loop in it, and names the tickets', async () => {
    const looped = plan();
    looped.tickets[0].depends_on = ['auction-live-view'];
    const r = await filePlan('arca', 'arca', looped, 3);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/loop/i);
    expect(putFile).not.toHaveBeenCalled();
  });

  it('refuses a plan with every line struck', async () => {
    let all = plan();
    for (const t of plan().tickets) all = strikeTicket(all, t.slug, true);
    const r = await filePlan('arca', 'arca', all, 0);
    expect(r.ok).toBe(false);
    expect(putFile).not.toHaveBeenCalled();
  });
});

describe('the plan is untrusted input, because it comes from a browser', () => {
  it('refuses a slug that would climb out of docs/tickets', async () => {
    // The finding that mattered. `ticketPath` builds `docs/tickets/<id>-<slug>.md`, `encodeURI`
    // leaves every `/` and `.` in it, and the URL normalises the dot segments away — so this slug
    // writes into `.github/workflows/` with the studio's token, which is far more privileged than
    // the founder holding it. The client validated slugs; the server did not.
    //
    // Deliberately the LAST ticket, which nothing depends on: rename one in the middle and the set
    // is refused for a dangling dependency instead, which would make this test pass without the
    // guard it exists to prove. It was written that way first.
    const evil = plan();
    evil.tickets[2].slug = '../../../../.github/workflows/pwn';
    const r = await filePlan('arca', 'arca', evil, 3);
    expect(r.ok).toBe(false);
    expect(putFile).not.toHaveBeenCalled();
  });

  it('refuses every other shape the surface would have refused', async () => {
    for (const broken of [
      { ...plan(), tickets: [] },
      { ...plan(), tickets: [{ ...plan().tickets[0], body: '' }] },
      { ...plan(), tickets: [{ ...plan().tickets[0], source: '' }] },
      { ...plan(), tickets: [{ ...plan().tickets[0], depends_on: ['../etc'] }] },
      { ...plan(), tickets: [plan().tickets[0], plan().tickets[0]] },
    ] as PlanDraft[]) {
      const r = await filePlan('arca', 'arca', broken, broken.tickets.length);
      expect(r.ok, JSON.stringify(broken).slice(0, 50)).toBe(false);
    }
    expect(putFile).not.toHaveBeenCalled();
  });

  it('never writes outside docs/tickets, whatever it is handed', async () => {
    await filePlan('arca', 'arca', plan(), 3);
    for (const w of written()) expect(w.path).toMatch(/^docs\/tickets\/[A-Za-z0-9-]+\.md$/);
  });
});

describe('never writing over work that already exists', () => {
  it('refuses a plan whose slug is already in the backlog, and names it', async () => {
    // The branch is cut from the default branch on a first press, so everything merged is on it. A
    // matching slug read as "already filed" and the reuse path replaced a real ticket's whole body
    // — status, notes, ticked criteria — while reporting the set as filed.
    listDir.mockResolvedValue([...BACKLOG, { name: 'ARCA-042-auction-live-view.md', type: 'file' }]);
    const r = await filePlan('arca', 'arca', plan(), 3);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('One page showing every live auction');
    expect(r.message).toContain('Nothing was filed');
    expect(putFile).not.toHaveBeenCalled();
  });

  it('reuses an id from the plan’s own branch even when the prefix has a hyphen', async () => {
    // `existingTicketFile`'s `[A-Za-z]+` cannot cross the hyphen in THE-RESET, so the second-press
    // guarantee quietly did not hold on the launch venture (FB-146).
    pressedOnce({ filed: ['THE-RESET-068-auction-source-research.md'], merged: [{ name: 'THE-RESET-067-x.md', type: 'file' }] });
    await filePlan('arca', 'arca', plan(), 3);
    expect(written().map((w) => w.path)[0]).toBe('docs/tickets/THE-RESET-068-auction-source-research.md');
  });
});

describe('who may file into a venture’s backlog', () => {
  it('refuses a signed-out visitor', async () => {
    auth.mockResolvedValue(null);
    const r = await filePlan('arca', 'arca', plan(), 3);
    expect(r.ok).toBe(false);
    expect(putFile).not.toHaveBeenCalled();
  });

  it('refuses a founder scoped to a different venture', async () => {
    auth.mockResolvedValue({ user: { email: 'someone.else@bruntsfield.capital' } });
    const r = await filePlan('arca', 'arca', plan(), 3);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/access/i);
    expect(putFile).not.toHaveBeenCalled();
  });

  it('refuses a repo that is not this venture’s, whatever the client says', async () => {
    const r = await filePlan('arca', 'grassmarket', { ...plan(), repo: 'grassmarket' }, 3);
    expect(r.ok).toBe(false);
    expect(putFile).not.toHaveBeenCalled();
  });

  it('refuses a plan drafted for somewhere else', async () => {
    const elsewhere = { ...plan(), venture_id: 'the-reset' };
    const r = await filePlan('arca', 'arca', elsewhere, 3);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/somewhere else/i);
    expect(putFile).not.toHaveBeenCalled();
  });

  it('says so plainly when the studio has no write token', async () => {
    delete process.env.STUDIO_APPROVAL_GITHUB_TOKEN;
    const r = await filePlan('arca', 'arca', plan(), 3);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not set up/i);
    expect(putFile).not.toHaveBeenCalled();
  });
});

describe('finding the pull request that is already open', () => {
  it('looks it up under the repository’s own owner, not the studio’s default org', async () => {
    // `fullRepoName` passes an already-qualified `owner/slug` through untouched, so a head filter
    // built from GITHUB_ORG matches nothing — the open pull request is missed and an ordinary
    // second press becomes "something went wrong".
    loadVentures.mockReturnValue([{ ...VENTURE, repos: ['someoneelse/arca'] }]);
    pressedOnce();
    await filePlan('arca', 'someoneelse/arca', { ...plan(), repo: 'someoneelse/arca' }, 3);
    const lookups = request.mock.calls.map(([p]) => p).filter((p: string) => p.includes('/pulls?state=open'));
    expect(lookups[0]).toContain(encodeURIComponent('someoneelse:foundry/plan-auction-source-research'));
  });
});

describe('when it goes wrong', () => {
  it('never reports a half-filed set as filed, and says what to do about it', async () => {
    // A founder whose set half-filed must not be told it filed, and must not be left guessing
    // whether pressing again would double it. The branch name goes to the log, where someone who
    // can act on it will look — it is not a sentence a founder can do anything with.
    putFile.mockRejectedValueOnce(new Error('boom'));
    const r = await filePlan('arca', 'arca', plan(), 3);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/may already be filed/i);
    expect(r.message).toMatch(/pressing again/i);
    expect(r.message).not.toMatch(/branch|foundry\//i);
  });
});

describe('a founding set files its map with it (FB-236)', () => {
  // A venture that does not exist yet: no tickets, no context, an empty repository.
  const KILN_VENTURE = { id: 'kiln', name: 'Kiln', repos: ['kiln'], founderEmail: 'kiln.founder@bruntsfield.capital', departments: [{ id: 'build', repo: 'kiln' }] };
  const MAP_PATH = 'context/general/founding-map.md';

  beforeEach(() => {
    auth.mockResolvedValue({ user: { email: KILN_VENTURE.founderEmail } });
    loadVentures.mockReturnValue([VENTURE, KILN_VENTURE]);
    listDir.mockResolvedValue([]);
  });

  it('writes the five tickets and then the map, on one branch, in one pull request', async () => {
    const r = await filePlan('kiln', 'kiln', PLAN, 5, undefined, MAP);
    expect(r.ok, r.message).toBe(true);
    const paths = written().map((w) => w.path);
    expect(paths).toHaveLength(6);
    expect(paths.at(-1)).toBe(MAP_PATH);
    expect(paths.slice(0, 5).every((p) => p.startsWith('docs/tickets/KILN-'))).toBe(true);
    expect(new Set(written().map((w) => w.branch)).size).toBe(1);
    expect(openedPulls()).toHaveLength(1);
    expect(openedPulls()[0].body).toContain(MAP_PATH);
  });

  it('the saved map names each ticket by the id it was actually given', async () => {
    await filePlan('kiln', 'kiln', PLAN, 5, undefined, MAP);
    const map = written().find((w) => w.path === MAP_PATH)?.body as string;
    const ids = written().filter((w) => w.path.startsWith('docs/tickets/')).map((w) => w.path.match(/(KILN-\d+)/)?.[1]);
    expect(ids).toHaveLength(5);
    for (const id of ids) expect(map).toContain(`**${id}**`);
    expect(map).toContain(MAP.idea);
  });

  it('an ordinary plan writes no map', async () => {
    auth.mockResolvedValue({ user: { email: VENTURE.founderEmail } });
    listDir.mockResolvedValue(BACKLOG);
    const r = await filePlan('arca', 'arca', plan(), 3);
    expect(r.ok, r.message).toBe(true);
    expect(written().map((w) => w.path)).not.toContain(MAP_PATH);
  });

  it('refuses a founding set that arrives without its map, and writes nothing', async () => {
    // Without this, the set would file as an ordinary plan: no map saved, the unknown-unknowns check
    // never run, and nobody told.
    const r = await filePlan('kiln', 'kiln', PLAN, 5);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('the map itself did not come with them');
    expect(putFile).not.toHaveBeenCalled();
    expect(createdBranches()).toEqual([]);
  });

  it('refuses a map that stopped before the unknown unknowns, and writes nothing', async () => {
    const body = MAP.body.split('## Unknown unknowns')[0];
    const r = await filePlan('kiln', 'kiln', PLAN, 5, undefined, { ...MAP, body });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/stops before the unknown unknowns/);
    expect(putFile).not.toHaveBeenCalled();
    expect(createdBranches()).toEqual([]);
  });

  it('refuses a ticket that does not say which part of the map it came from', async () => {
    const untraced = { ...PLAN, tickets: PLAN.tickets.map((t, i) => (i === 0 ? { ...t, source: 'A good idea' } : t)) };
    const r = await filePlan('kiln', 'kiln', untraced, 5, undefined, MAP);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Find out why the last two studio booking tools closed');
    expect(putFile).not.toHaveBeenCalled();
  });

  it('refuses a map drafted for another venture', async () => {
    const r = await filePlan('kiln', 'kiln', PLAN, 5, undefined, { ...MAP, venture_id: 'arca' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('somewhere else');
    expect(putFile).not.toHaveBeenCalled();
  });

  it('never writes over a founding map that has already merged', async () => {
    getFileWithSha.mockImplementation(async (_r: string, path: string, ref: string) =>
      path === MAP_PATH && ref === 'main' ? { text: '# The founding map', sha: 'merged' } : null);
    const r = await filePlan('kiln', 'kiln', PLAN, 5, undefined, MAP);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('already has a founding map');
    expect(putFile).not.toHaveBeenCalled();
    expect(createdBranches()).toEqual([]);
  });

  it('a second press updates the map it wrote, rather than failing', async () => {
    getFileWithSha.mockImplementation(async (_r: string, path: string, ref: string) =>
      path === MAP_PATH && ref !== 'main' ? { text: 'first press', sha: 'on-branch' } : null);
    const r = await filePlan('kiln', 'kiln', PLAN, 5, undefined, MAP);
    expect(r.ok, r.message).toBe(true);
    const call = putFile.mock.calls.find(([, path]) => path === MAP_PATH);
    expect(call?.[2].sha).toBe('on-branch');
  });
});
