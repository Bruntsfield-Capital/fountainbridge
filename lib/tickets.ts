/**
 * Ticket loading service (FB-006). The data path per D2 (git is the source of truth):
 *   manifest (FB-003) → GitHub contents API (lib/github) → parser (FB-004) → Ticket[], grouped
 *   by status per repo, cached ~2 min with a manual-refresh bypass.
 *
 * The fetch source is injectable (`RepoTicketFetcher`) so the grouping/caching logic is unit-tested
 * without network, and Playwright/dev can run against local fixtures (`TICKETS_FIXTURE_DIR`) instead
 * of live GitHub. Venture SCOPING is enforced by the caller (server component) before this runs —
 * this module never decides access, it only fetches for a repo it's told to.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { failIfFaulted } from './read-faults';
import { join } from 'node:path';
import { parseTicket, looksLikeTicket, type Ticket, type ParseWarning } from '../tools/ticket-parser/src/index';
import type { VentureSummary } from './ventures';
import { GitHubClient, GitHubError } from './github';
import { inferenceKey } from './attention';

/**
 * `filed` is a ticket the founder approved in the composer whose pull request has not merged yet
 * (FB-120). It is deliberately FIRST: it is the earliest thing that can be true of a piece of work,
 * before anyone has agreed to start it.
 *
 * It is not a status a ticket file can declare. Every filed ticket says `**Status:** Todo` in its own
 * markdown, because that is what it will be once it lands. `filed` is a fact about WHERE the ticket
 * is (on a branch, not on the default branch), which only the studio can see.
 */
export type TicketStatusGroup = 'filed' | 'todo' | 'in-progress' | 'pr-open' | 'done';
export const STATUS_GROUPS: readonly TicketStatusGroup[] = ['filed', 'todo', 'in-progress', 'pr-open', 'done'];

/**
 * Why a lane couldn't be read (FB-021). A bare GitHub 404 means BOTH "repo doesn't exist" and
 * "the token can't see this private repo" — so we split by what we actually know:
 *  - `no-credentials`: the studio has no GitHub auth at all → every private repo 404s. A *setup*
 *    state ("not connected yet"), not a broken one.
 *  - `unreadable`: auth IS configured but the repo still 404s → it's missing OR the GitHub App
 *    isn't installed on it (with contents:read). An *access* problem, not "not provisioned".
 *  - `rate-limit`: GitHub is throttling — transient.
 *  - `error`: any other GitHub error.
 * An empty backlog (repo reachable, no tickets) is NOT an error — it's `error: null, total: 0`.
 */
export type LaneErrorKind = 'no-credentials' | 'unreadable' | 'rate-limit' | 'error';

export interface TicketWithMeta {
  ticket: Ticket;
  warnings: ParseWarning[];
  /** Its status says the work was stopped, not finished (FB-296). It is grouped `done`. */
  stopped?: true;
}

export interface LaneTickets {
  repo: string;
  /** The repo's default branch (arca is `master`, not `main`) — for correct GitHub file links. */
  ref: string;
  groups: Record<TicketStatusGroup, TicketWithMeta[]>;
  total: number;
  /** `.md` files in docs/tickets that don't look like tickets (e.g. a README) — surfaced, not shown as cards. */
  skipped: number;
  /** Non-null when the repo couldn't be read (unreachable / rate-limited) — surfaced, not hidden. */
  error: string | null;
  /** Machine-readable reason behind `error` (FB-021), so the board can surface each state distinctly. */
  errorKind: LaneErrorKind | null;
}

export interface VentureTickets {
  ventureId: string;
  lanes: LaneTickets[];
  fetchedAt: number;
  totalWarnings: number;
}

export interface RepoTicketFiles {
  files: Array<{ path: string; content: string }>;
  /** Set when the repo itself is unreachable (vs. simply having no tickets). */
  error: string | null;
  /** Machine-readable reason behind `error` (FB-021). */
  errorKind?: LaneErrorKind | null;
  /** Default branch the files were read from (for GitHub links). Defaults to 'main'. */
  ref?: string;
}

export type RepoTicketFetcher = (repo: string) => Promise<RepoTicketFiles>;

function emptyGroups(): Record<TicketStatusGroup, TicketWithMeta[]> {
  return { filed: [], todo: [], 'in-progress': [], 'pr-open': [], done: [] };
}

/** Parse a repo's ticket files into status-grouped lanes. Pure — the heart of the service. */
export function groupRepoTickets(repo: string, fetched: RepoTicketFiles): LaneTickets {
  const groups = emptyGroups();
  let total = 0;
  let skipped = 0;
  for (const file of fetched.files) {
    const result = parseTicket(file.content, { repo, path: file.path });
    // A file that isn't a ticket (e.g. a stray README) is counted as skipped, not rendered as a
    // bogus card — surfaced via the count, never masquerading as a ticket.
    if (!looksLikeTicket(result)) {
      skipped += 1;
      continue;
    }
    groups[result.ticket.status].push(result.stopped
      ? { ticket: result.ticket, warnings: result.warnings, stopped: true }
      : { ticket: result.ticket, warnings: result.warnings });
    total += 1;
  }
  for (const g of STATUS_GROUPS) {
    groups[g].sort((a, b) => a.ticket.id.localeCompare(b.ticket.id, undefined, { numeric: true }));
  }
  return { repo, ref: fetched.ref ?? 'main', groups, total, skipped, error: fetched.error, errorKind: fetched.errorKind ?? null };
}

/**
 * Re-group a lane's tickets by PR-derived status (FB-007): an open PR referencing a ticket moves it
 * to `pr-open`, a merged PR to `done`. Git's markdown status is the default; PR state overrides it.
 * The map is keyed by `"<repo> <id>"` (see lib/attention `inferenceKey`) so a PR only regroups a
 * ticket in its OWN repo — two repos in a venture may share an id namespace.
 */
export function applyStatusInference(
  lane: LaneTickets,
  /**
   * Deliberately narrower than `TicketStatusGroup`: inference can only ever conclude `pr-open` or
   * `done`, because both come from the state of a pull request. `filed` is not inferable — it is a
   * fact about a ticket that is NOT on the default branch, and every ticket reaching this function
   * already is (FB-120).
   */
  statusMap: ReadonlyMap<string, 'pr-open' | 'done'>,
): LaneTickets {
  const groups = emptyGroups();
  for (const g of STATUS_GROUPS) {
    for (const item of lane.groups[g]) {
      const inferred = statusMap.get(inferenceKey(lane.repo, item.ticket.id));
      if (inferred && inferred !== item.ticket.status) {
        groups[inferred].push({ ...item, ticket: { ...item.ticket, status: inferred } });
      } else {
        groups[item.ticket.status].push(item);
      }
    }
  }
  for (const g of STATUS_GROUPS) {
    groups[g].sort((a, b) => a.ticket.id.localeCompare(b.ticket.id, undefined, { numeric: true }));
  }
  return { ...lane, groups };
}

// --- fetchers -------------------------------------------------------------------------------

/**
 * Classify a read failure into a founder-facing lane state (FB-021). Both a 404 and a *permission*
 * 403 ("Resource not accessible by integration" — the credential lacks `contents: read`) mean the
 * same thing to a founder: the studio can't see the repo. Only a genuine rate limit (429, or 403
 * with `x-ratelimit-remaining: 0` — `GitHubError.rateLimited`) is transient. Anything unexpected
 * (including a non-GitHubError, e.g. a malformed App key throwing in the token mint) degrades THIS
 * lane to a visible error — it must never reject and blank the whole board.
 */
function classifyFetchError(e: unknown, fullName: string, hasCreds: boolean, ref: string): RepoTicketFiles {
  if (e instanceof GitHubError && e.rateLimited) {
    return { files: [], error: 'GitHub rate limit hit — try refresh shortly.', errorKind: 'rate-limit', ref };
  }
  if (e instanceof GitHubError && (e.status === 404 || e.status === 403)) {
    // No usable auth → every private repo 404s: surface "not connected" so a founder doesn't read
    // the misleading "not provisioned yet?". With auth, it's missing OR an access/scope gap.
    return hasCreds
      ? {
          files: [],
          error: `Can't read ${fullName}. Either it doesn't exist, or the studio's GitHub credentials don't have read access to it (install or scope the Foundry GitHub App, or the read token).`,
          errorKind: 'unreadable',
          ref,
        }
      : {
          files: [],
          error: `The studio isn't connected to GitHub yet, so it can't read ${fullName}.`,
          errorKind: 'no-credentials',
          ref,
        };
  }
  const status = e instanceof GitHubError ? ` ${e.status}` : '';
  return { files: [], error: `Couldn't read ${fullName} (unexpected GitHub error${status}).`, errorKind: 'error', ref };
}

/**
 * One query for a venture's whole backlog (FB-083).
 *
 * The default branch, every filename in `docs/tickets`, and every file's text — in a single
 * request. The REST version needed one call for the repository, one to list the directory, and one
 * **per ticket**: 51 requests for ARCA's 49 tickets, which was the bulk of the 87 a board cost.
 *
 * `isTruncated` matters: GraphQL declines to inline a blob past roughly 512KB, and a ticket that
 * came back truncated would silently parse as a shorter ticket. It is refetched over REST rather
 * than trusted — rare enough to cost nothing, wrong enough to matter if ignored.
 */
const BACKLOG_QUERY = `query($owner: String!, $name: String!, $expr: String!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name }
    object(expression: $expr) {
      ... on Tree { entries { name type object { ... on Blob { text isTruncated } } } }
    }
  }
}`;

interface BacklogResult {
  repository: {
    defaultBranchRef: { name: string } | null;
    object: {
      entries?: Array<{ name: string; type: string; object?: { text?: string; isTruncated?: boolean } | null }>;
    } | null;
  } | null;
}

/**
 * The last backlog read per repository, keyed by the commit it was read at.
 *
 * A GraphQL query is a POST, so it cannot be answered with a free `304` the way the REST reads can
 * (FB-077). Measured, that made the trade a bad one: total requests fell from 87 to 49, but the
 * *paid* warm cost ROSE from 28 to 47, because 49 previously-free conditional reads became 3 paid
 * queries and the saving all landed on the cold path.
 *
 * A commit sha fixes it. If the branch head has not moved, the backlog cannot have changed — and the
 * sha comes from a GET, which IS conditional, so checking costs nothing when nothing happened.
 */
const backlogByCommit = new Map<string, { sha: string; files: Array<{ path: string; content: string }>; ref: string }>();

/** Live GitHub source: distinguishes "repo unreachable" from "no docs/tickets" (empty queue). */
export function githubTicketFetcher(client: GitHubClient, org: string): RepoTicketFetcher {
  return async (repo) => {
    const fullName = repo.includes('/') ? repo : `${org}/${repo}`;
    const [owner, name] = fullName.split('/');
    const hasCreds = client.hasCredentials();
    let ref = 'main';

    // Has anything changed? One conditional GET, free when the answer is no.
    let head: string | null = null;
    try {
      const commits = await client.request<Array<{ sha: string }>>(`/repos/${fullName}/commits?per_page=1`);
      head = Array.isArray(commits) && commits[0]?.sha ? commits[0].sha : null;
      const cached = head ? backlogByCommit.get(fullName) : null;
      if (cached && cached.sha === head) return { files: cached.files, error: null, ref: cached.ref };
    } catch {
      // Unreadable head is not itself a failure — fall through and let the real read decide.
    }

    try {
      const data = await client.graphql<BacklogResult>(BACKLOG_QUERY, {
        owner, name, expr: 'HEAD:docs/tickets',
      });
      // A null repository means the query resolved but the repo is not there. GraphQL reports that
      // as an error we already turn into a 404, so this is the belt to that braces — an empty
      // backlog and a missing repository must never look the same to a founder (FB-021).
      if (!data.repository) return classifyFetchError(new GitHubError('not found', 404, false), fullName, hasCreds, ref);
      ref = data.repository.defaultBranchRef?.name ?? ref;

      // `object: null` is the honest empty case: the repository is readable and has no
      // `docs/tickets` directory yet.
      const entries = data.repository.object?.entries ?? [];
      const md = entries.filter((e) => e.type === 'blob' && e.name.endsWith('.md'));

      const files = await Promise.all(md.map(async (e) => {
        const path = `docs/tickets/${e.name}`;
        if (e.object?.isTruncated || typeof e.object?.text !== 'string') {
          // Too large to inline, or a binary blob GraphQL would not give text for. Fall back rather
          // than treat it as empty — an empty ticket parses as a ticket with nothing in it.
          return { path, content: (await client.getFileContent(fullName, path, ref)) ?? '' };
        }
        return { path, content: e.object.text };
      }));

      if (head) backlogByCommit.set(fullName, { sha: head, files, ref });
      return { files, error: null, ref };
    } catch (e) {
      // Same degradation as before: this lane becomes an error row, and the board still renders.
      // A permission failure must read as unreadable rather than as a false "empty backlog".
      return classifyFetchError(e, fullName, hasCreds, ref);
    }
  };
}

/** Offline fixture source (dev / Playwright): reads `<dir>/<repo>/*.md`. */
export function fixtureTicketFetcher(dir: string): RepoTicketFetcher {
  return async (repo) => {
    // FB-137: fail at READ time, where a real read fails — inside whatever the loader catches.
    failIfFaulted('tickets');
    const repoDir = join(dir, repo);
    try {
      const names = readdirSync(repoDir).filter((n) => n.endsWith('.md'));
      const files = names.map((n) => ({
        path: `docs/tickets/${n}`,
        content: readFileSync(join(repoDir, n), 'utf8'),
      }));
      return { files, error: null };
    } catch {
      return { files: [], error: null }; // no fixtures for this repo → empty queue
    }
  };
}

/** Pick the configured source: fixtures if `TICKETS_FIXTURE_DIR` is set, else live GitHub. */
export function defaultFetcher(): RepoTicketFetcher {
  const fixtureDir = process.env.TICKETS_FIXTURE_DIR;
  if (fixtureDir) return fixtureTicketFetcher(fixtureDir);
  const org = process.env.GITHUB_ORG ?? 'wealthcx01';
  return githubTicketFetcher(new GitHubClient(), org);
}

// --- cache + top-level load -----------------------------------------------------------------

const CACHE_TTL_MS = 2 * 60 * 1000;
const cache = new Map<string, VentureTickets>();

export function clearTicketCache(): void {
  cache.clear();
}

/**
 * Load a venture's tickets (all its repos), grouped by status, cached ~2 min. `refresh: true`
 * bypasses the cache. `now`/`fetcher` are injectable for tests.
 */
export async function loadVentureTickets(
  venture: VentureSummary,
  opts: { fetcher?: RepoTicketFetcher; refresh?: boolean; now?: () => number } = {},
): Promise<VentureTickets> {
  const now = opts.now ?? Date.now;
  const cached = cache.get(venture.id);
  if (!opts.refresh && cached && now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }
  const fetcher = opts.fetcher ?? defaultFetcher();
  const repos = venture.repos.length > 0 ? venture.repos : [];
  // A fetcher that THROWS must not take the page with it (FB-137).
  //
  // The contract says a fetcher returns `{ files, error }`, and both shipped ones do — so this
  // guard reads like belt and braces until you remember what it is protecting: a rate limit, a
  // socket reset, a bug in a fetcher nobody has written yet. When one threw, `Promise.all` rejected,
  // `loadVentureTickets` threw, and every screen that reads a backlog rendered NOTHING. Measured:
  // the desk blank, the tickets screen a 500.
  //
  // A repo that could not be read becomes a lane that says so, which is the shape every consumer
  // already handles — and one unreadable repo stops costing the founder the other two.
  const lanes = await Promise.all(
    repos.map(async (repo) => {
      try {
        return groupRepoTickets(repo, await fetcher(repo));
      } catch {
        return groupRepoTickets(repo, {
          files: [],
          error: `The studio could not read ${repo} just now.`,
          errorKind: 'unreadable',
        });
      }
    }),
  );
  const totalWarnings = lanes.reduce(
    (sum, lane) => sum + STATUS_GROUPS.reduce((s, g) => s + lane.groups[g].reduce((w, t) => w + t.warnings.length, 0), 0),
    0,
  );
  const result: VentureTickets = { ventureId: venture.id, lanes, fetchedAt: now(), totalWarnings };
  cache.set(venture.id, result);
  return result;
}
