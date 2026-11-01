import { sendsAlreadyTried, sendsWaitingOnFounder } from '@/lib/needs-you';
import { Suspense } from 'react';
import { officeSocketUrl, officeWatchUrl } from '@/lib/office-embed';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { loadVentures, ventureChatUrl, type VentureSummary } from '@/lib/ventures';
import { authorizeVentures, canAccessVenture, parseAdminEmails } from '@/lib/authz';
import { loadVentureTickets, applyStatusInference } from '@/lib/tickets';
import { loadFiledForLanes, defaultBranchFileReader, type FiledTicket } from '@/lib/filed-tickets';
import { ticketsByRepoFrom } from '@/lib/venture-tickets-index';
import { loadVentureAttention } from '@/lib/attention';
import { loadVentureHealth, defaultNow } from '@/lib/health';
import { attachBudgetDisclosure, toSpends, type ActiveGraphApproval } from '@/lib/approvals';
import { boardState, type VentureWiring } from '@/lib/firstrun';
import { FirstRun, BoardUnreadable } from '@/components/FirstRun';
import { departmentBudgets, type BudgetDisclosure } from '@/lib/budgets';
import { ageRuns, engineState, type RunReport } from '@/lib/runreports';
import { ageMs, stampAgeMs } from '@/lib/when';
import { buildOffice } from '@/lib/office';
import { lastSend } from '@/lib/sends';
import { ventureApprovals, ventureRuns, type Runs } from '@/lib/venture-reads';
import { composeBrief, bucketRuns, type Brief } from '@/lib/brief';
import { blockerLine, degradedGroups, deskSummary, type ReadFailure } from '@/lib/desk';
import { loadEnvelopes } from '@/lib/budgets-load';
import { checkedDoor } from '@/lib/preview-check';
import type { PreviewCheck } from '@/lib/result-link';
import { VentureBoard } from '@/components/VentureBoard';
import { VentureForbidden } from '@/components/VentureForbidden';
import { DeskWaiting } from '@/components/DeskWaiting';
import { readiness } from '@/lib/readiness';
import { timed } from '@/lib/timing';
import { CARDS_UNREAD, ventureCardRows, viewerOf } from '@/lib/factory-work-load';
import { cardHref, metaLine, stuckNames, withoutCarded, type CardRow } from '@/lib/factory-work';
import type { WaitingItem } from '@/components/WaitingQueue';

// Venture lanes & tickets (FB-006). Scoping is enforced HERE, server-side: a session that can't
// access this venture never triggers a ticket fetch (CLAUDE.md #6 — isolation is not UI-only).
/**
 * The desk (FB-006, FB-128, streamed in FB-157).
 *
 * Authorization and the manifest are cheap and stay here — the refusal must be decided before a
 * single read leaves, and it is (CLAUDE.md #6). Everything that costs a network round trip is behind
 * the `<Suspense>` below, so the founder gets their desk and its prompt bar immediately and the
 * board fills in behind it.
 */
export default async function VenturePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ refresh?: string; full?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect('/login');

  const { id } = await params;
  const { refresh, full } = await searchParams;

  const ventures = loadVentures();
  const access = authorizeVentures(
    session.user.email,
    ventures,
    parseAdminEmails(process.env.STUDIO_ADMIN_EMAILS),
  );

  const venture = ventures.find((v) => v.id === id);
  // Deny BEFORE any data fetch. A signed-in but unauthorized user sees the refusal, not the data.
  // This is decided on the critical path deliberately: a refusal must never arrive after a shell
  // that implies there is something to see.
  if (!venture || !canAccessVenture(access, id)) {
    return <VentureForbidden ventureId={id} exists={Boolean(venture)} />;
  }

  return (
    <Suspense
      fallback={
        <DeskWaiting ventureName={venture.name} ventureStatus={venture.status} />
      }
    >
      <Desk venture={venture} access={access} email={session.user.email} refreshing={refresh === '1'} full={full === '1'} />
    </Suspense>
  );
}

/** The desk once its records are read. Everything below here costs a round trip. */
async function Desk({
  venture,
  access,
  email,
  refreshing,
  full,
}: {
  venture: VentureSummary;
  access: ReturnType<typeof authorizeVentures>;
  email: string;
  refreshing: boolean;
  /**
   * `?full=1` — show the whole desk on a phone (FB-160).
   *
   * A query parameter rather than client state, so the choice survives a reload and can be linked
   * to. Nothing is hidden from a wide screen either way; this only reaches the pocket studio.
   */
  full: boolean;
}) {

  // ---- The reads ---------------------------------------------------------------------------
  //
  // In three rounds, not nine (FB-128). This page took **9.1 seconds** on production, essentially
  // all of it before the first byte: every read was awaited on the line after the one before it,
  // although almost none of them depend on each other. FB-123 took it from ~41s by bounding the
  // run-report reads; this is the rest.
  //
  // The rounds are the real dependencies and nothing more:
  //
  //   1. everything that depends on nothing — tickets, the ticket index, health, approvals, runs;
  //   2. the attention queue (needs the ticket index) and the approval histories (need the
  //      approvals), which do not need each other;
  //   3. the filed tickets, which need the attention queue.
  //
  // `GITHUB_MAX_CONCURRENT` (8) still governs how many actually leave at once, so this is not a
  // burst — it is the difference between keeping that budget full and leaving it idle while one
  // request finishes.
  // Fixture sources for the UI gate + offline dev. Gated on E2E_TEST_LOGIN, not on the presence of
  // the directory alone: this is the external-action gate, and a stray env var must not be able to
  // swap a founder's real approval queue for files on disk. Keying off the same switch that already
  // enables test login means there is ONE well-known flag that turns the studio into a test rig,
  // rather than several — and a deployment with it set has bigger problems than this.
  // (NODE_ENV is not usable here: `next start` sets it to production for the UI gate too.)
  const testRig = process.env.E2E_TEST_LOGIN === '1';

  // The shape is `Runs` in lib/venture-reads, not a third hand-written copy of it. Two copies is how
  // adding one field to the read became a typecheck error in three files (FB-242).
  const noRuns: Runs = { reports: [], heartbeats: [], checkIns: [], total: 0, earliest: null, busiest: null };

  // FB-046: external-action approvals (the ActiveGraph gate). Most ventures have no foundry-approvals
  // ref yet — a read failure must never blank the board, so degrade to none.
  //
  // `runsDegraded` is tracked separately from "no reports": an unreadable state ref and a genuinely
  // idle venture look identical from here, and the brief must not compose a calm summary out of the
  // first.
  //
  // `ticketsByRepo` is deliberately NOT in this round. It wraps `loadVentureTickets`, and running
  // the two together means neither has finished when the other starts: both miss the per-venture
  // cache and the venture pays for two full backlog reads per repository, as a burst, against the
  // secondary rate limit FB-083 exists to avoid. The index is derived from the lanes instead.
  //
  // Each read is timed (FB-157). They run in parallel, so their sum is not the wall clock — what the
  // readings answer is WHICH of them the round is waiting on. FB-128 estimated this page's own work
  // at ~350 ms by subtracting one rail-bound number from another; it is ~4.8s, and guessing again
  // would be the fourth time in a row.
  // FB-184: each surface's door is opened before the desk draws it as a link. Started here so it
  // runs alongside the reads below rather than after them; awaited where the board is drawn.
  // Remembered for five minutes per address, so this is not one request per page view.
  const doorsRead: Promise<Record<string, PreviewCheck>> = Promise.all(
    venture.departments
      .filter((d) => d.provisioned && d.launch)
      .map(async (d) => [d.id, await checkedDoor(d.launch!.url)] as const),
  ).then((pairs) => Object.fromEntries(pairs));

  const [data, health, approvalsRead, runsRead, cardsRead] = await Promise.all([
    timed('desk: your backlog', () => loadVentureTickets(venture, { refresh: refreshing }), venture.id),
    timed('desk: repository health', () => loadVentureHealth(venture, { refresh: refreshing }), venture.id),
    // Shared with the rail around this page (FB-157). These were two full reads per request each,
    // queueing against each other for the same eight concurrent slots.
    timed('desk: your approvals', () => ventureApprovals(venture), venture.id)
      .catch((): ActiveGraphApproval[] => []),
    timed('desk: what your team did', () => ventureRuns(venture), venture.id)
      .then((r) => ({ runs: r, degraded: false }))
      .catch(() => ({ runs: noRuns, degraded: true })),
    // FB-277: the factory's cards, as this viewer may read them. Shared with the rail.
    timed('desk: the factory\'s cards', () => ventureCardRows(venture, viewerOf(email, venture)), venture.id),
  ]);
  const cardRows: CardRow[] = cardsRead.rows;
  const runs = runsRead.runs;
  const runsDegraded = runsRead.degraded;

  // FB-099: the tickets go IN. Without them a piece of work is only tied to its ticket when it names
  // the id outright, which the lane's own branches (`foundry/<slug>`) never do — which is how the
  // badge came to say 15 while every column said 0.
  //
  // FB-071: the ActiveGraph record — who asked, who agreed, what happened next, in order, on ground
  // the proposing lane cannot author. Read here rather than in the card because the card is a client
  // component and the verifying secret must never reach a browser. A venture with no history yet
  // reads as none, never as an error, so an un-provisioned ref cannot blank the board. Fanned out
  // rather than walked: it was a `for` loop awaiting one approval at a time, which on a venture with
  // a real queue was most of this page's time on its own.
  // FB-207: the ActiveGraph history is no longer read here.
  //
  // It was fanned out across every approval on the venture — one of this page's costlier reads —
  // and its only consumer was the two `ApprovalCard` sections the desk used to carry. Those are gone
  // (What happened states the attestation now), so this read had nothing left to feed.
  //
  // The record itself is not gone and is not read less carefully: the approval's own page loads the
  // history for the one approval a founder opened, which is the read that was always the right
  // shape. Fetching every venture's whole record to render a page that shows none of it is exactly
  // the cost FB-164 went looking for.
  const attention = await timed(
    'desk: open work',
    () => loadVentureAttention(venture, { refresh: refreshing, tickets: ticketsByRepoFrom(data.lanes) }),
    venture.id,
  );

  const inferred = data.lanes.map((lane) => applyStatusInference(lane, attention.ticketStatus));
  // FB-120: the work the founder approved minutes ago, which is not on the default branch yet.
  //
  // AFTER inference, deliberately. A filed ticket's own pull request is open, so inference would move
  // it to "Needs your OK" — the wrong sentence about work nobody has started, and the loss of exactly
  // the distinction this exists to draw.
  //
  // A read failure must not blank a board that was fine a moment ago, so it degrades to none: the
  // pull requests stay in the attention queue either way, which is where the founder was before.
  const filedByRepo = await timed(
    'desk: work you accepted, not live yet',
    () => loadFiledForLanes(inferred, attention.perRepo, defaultBranchFileReader()),
    venture.id,
  ).catch(() => new Map<string, FiledTicket[]>());

  const lanes = inferred.map((lane) => {
    const filed = filedByRepo.get(lane.repo);
    if (!filed?.length) return lane;
    return {
      ...lane,
      groups: { ...lane.groups, filed },
      total: lane.total + filed.length,
    };
  });
  // Staleness (FB-008): flag a lane whose repo has had no activity in N days — surfaced on the board.
  const staleRepos = health.repos.filter((r) => r.stale).map((r) => r.repo);
  const org = process.env.GITHUB_ORG ?? 'wealthcx01';

  // FB-054: limits come from the STUDIO repo (ventures/budgets/<id>.yaml), never from the venture ref
  // the proposing lane can write. Read once and threaded through, so the board and the cards are
  // computed from the same bytes.
  const { envelopes, error: budgetsError } = loadEnvelopes(venture.id);
  const knownDepartments = new Set(venture.departments.map((d) => d.id));
  // The repo's existing test clock seam (FB-032). Period windowing makes "now" load-bearing.
  const now = new Date(defaultNow());
  const approvals = attachBudgetDisclosure(approvalsRead, envelopes, knownDepartments, now);

  // FB-241: one clock for every time on the desk. The attention queue ages its pull requests when it
  // reads them, against the real clock and possibly minutes ago from cache; the engine sentence uses
  // `now` above. Under the pinned test clock those two said "10 minutes" and "79 days" about one
  // venture. Re-aged here, against the same `now`, so every age on this page shares one instant.
  //
  // FB-277: only the pull requests no factory card stands for. Where both are the same work, the
  // card's row is the one shown and counted, never both.
  const openPrs = withoutCarded(attention.approvals, cardRows);
  const queue = openPrs.map((a) => ({ ...a, ageMs: Math.max(0, ageMs(a.createdAt, now.getTime()) ?? a.ageMs) }));
  const waitingCards = cardRows.filter((c) => c.waits);
  const cardAgeMs = (c: CardRow) => Math.max(0, ageMs(c.at, now.getTime()) ?? 0);
  // The cards waiting on this viewer, as rows of "Waiting on you". Built here, on the server, so a
  // founder's page is never handed John's words.
  const surfaceName = (repo: string) => venture.departments.find((d) => d.repo === repo)?.name ?? null;
  const cardItems: WaitingItem[] = waitingCards.map((c) => ({
    key: `card ${c.key}`,
    testId: `card-${c.repo}-${c.number}`,
    ref: c.ref || c.key,
    title: c.title,
    meta: metaLine(c, surfaceName(c.repo) ?? 'Your venture'),
    waitingMs: cardAgeMs(c),
    href: cardHref(c),
    external: false,
  }));

  // Both lists (FB-139): a run report is a check-in, and heartbeats are only written when a wake
  // finds nothing to work — so heartbeats alone read a busy machine as one that never started.
  const engine = engineState(runs.checkIns, now);

  // FB-139: the office, from what the box already publishes. An in-flight run report IS "this agent
  // is working right now", the heartbeat is "the machine is alive", and the attention queue is the
  // raised hand — so the plate needs no new read, no new box-side file and no new credential. One
  // array; the plate and the ledger beside it are two mappings of it.
  const office = buildOffice({
    departments: venture.departments,
    runs: runs.reports,
    waiting: queue,
    now: now.getTime(),
    engine,
  });

  // Pure, unit-tested, and shared with the cards — the previous version lived inline here and was
  // reachable only through Playwright.
  const { budgets, orphanEnvelopes } = departmentBudgets(
    venture.departments.map((d) => d.id),
    envelopes,
    toSpends(approvals),
    now,
  );

  // FB-104: a stuck ticket reads by its name, not its number. The titles are already on the board —
  // this is the same parse the columns render from, so the brief cannot name a ticket differently
  // from the card the founder then goes and opens.
  // FB-105: the work waiting on each ticket, keyed the same way the status inference is — so the
  // drawer's Accept button and the column the card sits in cannot disagree about the same ticket.
  const openWork: Record<string, { repo: string; number: number }> = {};
  for (const pr of openPrs) {
    if (pr.linkedTicketId) openWork[`${pr.repo} ${pr.linkedTicketId}`] = { repo: pr.repo, number: pr.number };
  }

  const ticketTitles: Record<string, string> = {};
  for (const lane of lanes) {
    for (const group of Object.values(lane.groups)) {
      for (const t of group) ticketTitles[t.ticket.id] = t.ticket.title;
    }
  }

  // FB-099: everything with no CARD on this board — which is not the same as "no ticket id". A piece
  // of work titled "ARCA-5: deck sharing" whose ticket file does not exist has an id, matches
  // nothing on screen, and fell through exactly the same gap the badge/column mismatch fell through.
  const onBoard = new Set(Object.keys(ticketTitles));
  // FB-120: a filing now HAS a card, so it must stop being listed as work with nowhere to go. It is
  // keyed by pull request rather than ticket id because that is what the filing is — the ticket it
  // carries is the card, and listing both would show the same thing twice under two names.
  // FB-120: where each filed ticket actually LIVES. The drawer builds a GitHub file link from the
  // lane's ref, which for these is the default branch — the one branch the file is provably not on.
  // Without this the card a founder opens to re-read what they approved links to a 404.
  const filedRefs: Record<string, { branch: string; prNumber: number; prUrl: string }> = {};
  for (const [repo, fs] of filedByRepo) {
    for (const f of fs) {
      filedRefs[`${repo} ${f.ticket.id}`] = { branch: f.branch, prNumber: f.prNumber, prUrl: f.prUrl };
    }
  }

  const filedPrs = new Set(
    [...filedByRepo].flatMap(([repo, fs]) => fs.map((f) => `${repo} ${f.prNumber}`)),
  );
  const unmatchedWork: Record<string, Array<{ number: number; title: string }>> = {};
  for (const pr of openPrs) {
    if (pr.linkedTicketId && onBoard.has(pr.linkedTicketId)) continue;
    if (filedPrs.has(`${pr.repo} ${pr.number}`)) continue;
    (unmatchedWork[pr.repo] ??= []).push({ number: pr.number, title: pr.title });
  }

  const brief: Brief = composeBrief({
    ventureName: venture.name,
    awaitingApproval: sendsWaitingOnFounder(approvals).length,
    sendsAlreadyTried: sendsAlreadyTried(approvals),
    // The queue itself, not a count of it: the brief says how long the oldest has waited, and a
    // number cannot be asked that.
    openWork: [
      ...queue.map((a) => ({ ticketId: a.linkedTicketId, ageMs: a.ageMs })),
      ...waitingCards.map((c) => ({ ticketId: c.ref || null, ageMs: cardAgeMs(c) })),
    ],
    // FB-277: a stuck card joins the stuck line, beside the tickets the runs say are stuck.
    stuckCards: stuckNames(cardRows),
    runs: runs.reports,
    engine,
    ticketTitles,
    overBudget: venture.departments
      .map((d, i) => (budgets[i]?.overLimit ? d.name : null))
      .filter((n): n is string => !!n),
    // Any read that failed leaves the brief working from an incomplete picture, and it says so
    // rather than reassuring the founder from a partial one.
    degraded: runsDegraded || attention.errors.length > 0 || !!budgetsError,
    now: now.getTime(),
  });

  // FB-066: day one. A founder whose venture has produced nothing meets a welcome and ONE action,
  // not four well-written empty boxes that between them argue the product does nothing.
  //
  // Every read failure is collected first, because a welcome shown over an unreadable venture states
  // a fact we do not have: it tells the founder their venture is a blank page when the truth is that
  // the studio could not see it.
  //
  // Kept as structured entries as well as strings (FB-128). The desk's degraded strip groups by
  // cause and names which repository each affected, and reading the repository back out of a
  // sentence written somewhere else is a guess — so it travels as a field.
  const failures: ReadFailure[] = [
    ...lanes.filter((l) => l.error).map((l) => ({ where: l.repo, message: l.error as string })),
    ...health.repos.filter((r) => r.error).map((r) => ({ where: r.repo, message: r.error as string })),
    ...attention.errors.map((message) => ({ where: null, message })),
    ...(runsDegraded ? [{ where: null, message: 'The studio could not read what your team has been doing.' }] : []),
    ...(budgetsError ? [{ where: null, message: budgetsError }] : []),
    ...(cardsRead.unread ? [{ where: null, message: CARDS_UNREAD }] : []),
  ];
  const readFailures = failures.map((f) => f.message);

  // FB-128: the desk's own sentence, the amber banner, and the strip of what could not be read.
  //
  // All three from ONE count of what waits on this founder — the same `waitingOnFounder` the rail's
  // badge uses. Three renderings of one number is how a badge comes to say 15 over columns saying 0
  // (FB-099), and the acceptance criterion for this ticket is that they cannot.
  const waiting = {
    openWork: openPrs.length + waitingCards.length,
    awaitingApproval: sendsWaitingOnFounder(approvals).length,
    sendsAlreadyTried: sendsAlreadyTried(approvals),
  };
  const oldestMs = openPrs.length + waitingCards.length
    ? Math.max(...queue.map((a) => a.ageMs ?? 0), ...waitingCards.map(cardAgeMs))
    : null;
  // Work the engine is actually on, not work that has been filed. A ticket sitting in `todo` is not
  // a team "on" anything, and saying so would be the most flattering possible reading of an idle
  // venture.
  const movingTickets = lanes.reduce((n, l) => n + l.groups['in-progress'].length, 0);
  // One figure only when there IS one. `lib/budgets.ts` deliberately refuses to add up spend across
  // currencies per department, and summing them here would undo that: a venture with a GBP Build
  // envelope and a USD Sell envelope would get their arithmetic total, formatted in GBP — a number
  // wrong in both. Periods too: a quarterly envelope added to a monthly one covers no window that
  // can be named. When the departments disagree, the clause is simply not said.
  const declared = budgets.filter((b): b is NonNullable<typeof b> => b !== null && b.limitMinor > 0);
  const oneCurrency = declared.length > 0 && declared.every((b) => b.currency === declared[0].currency);
  const onePeriod = declared.length > 0 && declared.every((b) => b.period === declared[0].period);
  const comparable = oneCurrency && onePeriod;
  const summarySentence = deskSummary({
    ...waiting,
    description: venture.description,
    movingTickets,
    spentMinor: comparable ? declared.reduce((n, b) => n + b.reportedMinor, 0) : null,
    limitMinor: comparable ? declared.reduce((n, b) => n + b.limitMinor, 0) : null,
    queuedMinor: comparable ? declared.reduce((n, b) => n + b.queuedMinor, 0) : null,
    currency: comparable ? declared[0].currency : null,
    period: comparable ? declared[0].period : null,
    degraded: readFailures.length > 0,
  });
  const blocker = blockerLine({ ...waiting, oldestMs });
  const degraded = degradedGroups(failures);

  // FB-163, rebuilt in FB-198: the venture office, when this venture has one wired up.
  //
  // Both addresses read the SAME two environment variables — the box's hostname and the office
  // secret it shares with the studio — so a venture is either fully wired or has no office at all,
  // rather than being handed a frame that can never connect.
  // Two addresses on the venture's own box, each carrying a ticket this studio signed: the office's
  // page, and the socket the desk checks before it draws anything. See `officeWatchUrl`.
  const officeSrc = officeWatchUrl(venture.id, process.env);
  const officeSocket = officeSocketUrl(venture.id, process.env);

  const state = boardState({
    ticketCount: lanes.reduce((n, l) => n + l.total, 0),
    runCount: runs.total,
    approvalCount: approvals.length,
    // Anything a repo has already done — a commit, a merged PR, a build. A venture with a failing
    // build and nothing else is not brand new, and must not be greeted as though it were.
    historyCount: health.repos.reduce((n, r) => n + r.activity.length + (r.latestRun ? 1 : 0), 0) + cardRows.length,
    readFailures,
  });
  // FB-203, item 6 removed the desk's link to the box's own chat, so the URL is no longer rendered
  // — but whether the box HAS one is still what says the composer is wired (they are the same host).
  const hasComposer = ventureChatUrl(venture.vpsHost) !== null;
  // FB-087: the composer key lives only in the environment, so only the running process can tell
  // whether it is there. Shown to Bruntsfield, never to the founder — it names a variable and a
  // script, which is a fix for an admin and noise for anyone else. Computed here because
  // `process.env` must not cross into a client component.
  const wiringWarning = access.isAdmin && !readiness([venture], process.env).ok
    ? readiness([venture], process.env).ventures[0].problem
    : null;

  // FB-143: whether day one can offer its one action at all.
  //
  // `hasComposer` only ever asked whether the venture had a BOX. The failure the admin ledger warns
  // about is the other one — a machine with no key — and on day one that is a button that fails on
  // press, on the only screen a founder meets before they have any reason to trust the studio.
  const wired = readiness([venture], process.env).ventures[0];
  const wiring: VentureWiring = !wired?.host ? 'no-box' : wired.keySet ? 'ready' : 'no-key';

  if (state.kind === 'first-run') {
    return (
      <FirstRun
        ventureId={venture.id}
        ventureName={venture.name}
        founderName={venture.founderName}
        wiring={wiring}
      />
    );
  }
  if (state.kind === 'unreadable') {
    return <BoardUnreadable ventureId={venture.id} ventureName={venture.name} reasons={state.reasons} />;
  }

  return (
    <VentureBoard
      venture={{
        id: venture.id, name: venture.name, status: venture.status,
        founderName: venture.founderName, hasComposer,
        // FB-142: the venture's own Workspace, for the Sell surface's outbox reference.
        founderEmail: venture.founderEmail,
      }}
      wiringWarning={wiringWarning}
      lanes={lanes}
      departments={venture.departments}
      doors={await doorsRead}
      approvals={approvals}
      lastSendAgeMs={ageMs(lastSend(approvals)?.at, now.getTime())}
      budgets={budgets}
      budgetsError={budgetsError}
      orphanEnvelopes={orphanEnvelopes}
      staleRepos={staleRepos}
      totalWarnings={data.totalWarnings}
      openWork={openWork}
      filedRefs={filedRefs}
      unmatchedWork={unmatchedWork}
      viewerIsFounder={
        !!venture.founderEmail && venture.founderEmail.toLowerCase() === email.toLowerCase()
      }
      fetchedAgeMs={stampAgeMs(data.fetchedAt)}
      org={org}
      brief={brief}
      openWorkQueue={queue}
      cardItems={cardItems}
      cardsQuiet={cardsRead.quiet}
      summary={summarySentence}
      blocker={blocker}
      degraded={degraded}
      full={full}
      // FB-163: minted here, after the venture check above, and short-lived. The token names the
      // venture and nothing else — no host, no port, no secret of the box.
      officeSrc={officeSrc}
      officeSocket={officeSocket}
      runs={ageRuns(runs.reports, now.getTime())}
      runsTotal={runs.total}
      engine={engine}
      office={office}
    />
  );
}
