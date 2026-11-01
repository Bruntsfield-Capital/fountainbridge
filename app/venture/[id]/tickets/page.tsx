import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { loadVentures } from '@/lib/ventures';
import { authorizeVentures, canAccessVenture, parseAdminEmails } from '@/lib/authz';
import { loadVentureTickets, applyStatusInference, STATUS_GROUPS } from '@/lib/tickets';
import { loadFiledForLanes, defaultBranchFileReader, type FiledTicket } from '@/lib/filed-tickets';
import { ticketsByRepoFrom } from '@/lib/venture-tickets-index';
import { loadVentureAttention, type PrCiStatus } from '@/lib/attention';
import { VentureForbidden } from '@/components/VentureForbidden';
import { TicketsView } from '@/components/TicketsView';
import { TicketTrail } from '@/components/TicketTrail';
import type { VentureSummary } from '@/lib/ventures';
import { filterTickets, parseFilter, resolveSelected, rowKey, type TicketRow, onSurface, resolveSurface } from '@/lib/tickets-view';
import { type ActiveGraphApproval } from '@/lib/approvals';
import { engineState, type RunReport } from '@/lib/runreports';
import { ticketProgress } from '@/lib/ticket-progress';
import { sendRows, sendSurface } from '@/lib/needs-you';

/** An empty runs shape, so a failed read costs the progress column and never the ticket list. */
const NO_RUNS_FOR_PROGRESS = {
  reports: [] as RunReport[], heartbeats: [] as RunReport[], checkIns: [] as RunReport[], total: 0,
};
import { ventureApprovals, ventureRuns } from '@/lib/venture-reads';
import { GitHubClient } from '@/lib/github';
import { trailSources, workForTicket } from '@/lib/trail-sources';
import { checkedPreview } from '@/lib/preview-check';
import { followLine, sendForTicket } from '@/lib/result-link';
import { FollowIt } from '@/components/FollowIt';
import { loadTrail } from '@/lib/trail-load';
import { ageMs, studioNow } from '@/lib/when';
import { CARDS_UNREAD, ventureCardRows, viewerOf } from '@/lib/factory-work-load';
import { cardGroup, cardSentence, cardTicketId, withoutCarded } from '@/lib/factory-work';

/**
 * Tickets (FB-129) — the list, the ticket, and the decision, on one screen.
 *
 * A founder used to read a ticket in a drawer and decide about it on a different page, with nothing
 * on either saying the other existed. This is where both live.
 *
 * ## The selection is in the URL, deliberately
 *
 * Not component state. "Discuss in the composer →" leaves this screen and the founder comes back;
 * dependency chips link ticket to ticket; "Next decision →" is a navigation. All three break if a
 * ticket cannot be addressed — and it is also what makes a ticket linkable at all, from the desk's
 * queue, from a run report, from a message.
 */
export default async function TicketsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ filter?: string; t?: string; refresh?: string; surface?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect('/login');

  const { id } = await params;
  const { filter, t, refresh, surface } = await searchParams;

  const ventures = loadVentures();
  const access = authorizeVentures(session.user.email, ventures, parseAdminEmails(process.env.STUDIO_ADMIN_EMAILS));
  const venture = ventures.find((v) => v.id === id);
  // Denied BEFORE any data fetch, the same as the desk: an unauthorized session sees the refusal.
  if (!venture || !canAccessVenture(access, id)) {
    return <VentureForbidden ventureId={id} exists={Boolean(venture)} />;
  }

  const refreshing = refresh === '1';
  const viewer = viewerOf(session.user.email, venture);
  // FB-277: the factory's cards, read beside the backlog. Shared with the rail, once per request.
  const cardsRead = ventureCardRows(venture, viewer);
  const data = await loadVentureTickets(venture, { refresh: refreshing });
  const attention = await loadVentureAttention(venture, {
    refresh: refreshing,
    tickets: ticketsByRepoFrom(data.lanes),
  });

  const inferred = data.lanes.map((lane) => applyStatusInference(lane, attention.ticketStatus));
  const cards = await cardsRead;
  // One row per piece of work (FB-277): a pull request a card stands for is listed as the card.
  const openPrs = withoutCarded(attention.approvals, cards.rows);
  // FB-120: work filed minutes ago is not on the default branch yet, and a founder who just pressed
  // "File all" must find it here. Degrades to none rather than blanking a list that was fine.
  const filedByRepo = await loadFiledForLanes(inferred, attention.perRepo, defaultBranchFileReader())
    .catch(() => new Map<string, FiledTicket[]>());

  // What is actually waiting, keyed the same way the board keys it, so this screen and the desk
  // cannot disagree about which tickets need the founder.
  //
  // The OLDEST per ticket, not the last one seen. A ticket can carry more than one open pull request
  // — a lane retries, or files a revision — and a `Map` that took whichever came last would drop the
  // other from the list while the rail's badge went on counting it. Every waiting item is still
  // counted; they are just gathered under the ticket they belong to.
  const waitingFor = new Map<string, { repo: string; number: number; ageMs: number; also: number; headSha: string | null; ciStatus: PrCiStatus | null }>();
  for (const pr of openPrs) {
    if (!pr.linkedTicketId) continue;
    const key = `${pr.repo} ${pr.linkedTicketId}`;
    const held = waitingFor.get(key);
    if (!held) waitingFor.set(key, { repo: pr.repo, number: pr.number, ageMs: pr.ageMs, also: 0, headSha: pr.headSha, ciStatus: pr.ciStatus });
    else if (pr.ageMs > held.ageMs) waitingFor.set(key, { repo: pr.repo, number: pr.number, ageMs: pr.ageMs, also: held.also + 1, headSha: pr.headSha, ciStatus: pr.ciStatus });
    else held.also += 1;
  }
  const surfaceOf = new Map((venture.departments ?? []).map((d) => [d.repo, d.name]));

  // FB-120: a ticket the composer just filed arrives as a pull request on a `foundry/<slug>` branch
  // whose title carries no ticket id, so it links to nothing — and would be appended below as work
  // "not tied to anything you asked for", beside the very ticket it carries.
  //
  // ATTACHED to its own row rather than dropped. A filing is genuinely waiting on the founder — the
  // ticket does not join the backlog until it is merged (CLAUDE.md #2) — and the rail's badge counts
  // it. Excluding it here would have fixed the duplicate row and reopened the badge/filter
  // disagreement in the same change.
  const ageOfPr = new Map(openPrs.map((pr) => [`${pr.repo}#${pr.number}`, pr.ageMs]));
  const shaOfPr = new Map(attention.approvals.map((pr) => [`${pr.repo}#${pr.number}`, pr.headSha]));
  const ciOfPr = new Map(attention.approvals.map((pr) => [`${pr.repo}#${pr.number}`, pr.ciStatus]));
  const filedPrs = new Set(
    [...filedByRepo].flatMap(([repo, fs]) => fs.map((f) => `${repo}#${f.prNumber}`)),
  );
  for (const [repo, fs] of filedByRepo) {
    for (const f of fs) {
      const age = ageOfPr.get(`${repo}#${f.prNumber}`);
      if (age === undefined) continue;   // its pull request is not open, so nothing waits
      waitingFor.set(`${repo} ${f.ticket.id}`, { repo, number: f.prNumber, ageMs: age, also: 0, headSha: shaOfPr.get(`${repo}#${f.prNumber}`) ?? null, ciStatus: ciOfPr.get(`${repo}#${f.prNumber}`) ?? null });
    }
  }
  // Where a filed ticket actually LIVES — its own branch, not the default one. Without this the
  // "see where this is written down" link points at the one branch the file is provably not on.
  const filedBranch = new Map(
    [...filedByRepo].flatMap(([repo, fs]) => fs.map((f) => [`${repo} ${f.ticket.id}`, f.branch] as const)),
  );

  // FB-178: the desk's board carried "what is happening to this ticket" and the desk no longer has
  // a board, so it comes here — the only list of tickets a founder now has. `ventureRuns` is cached
  // per request (FB-157), so the ticket detail below reading it again costs nothing.
  const runsForProgress = await ventureRuns(venture).catch(() => NO_RUNS_FOR_PROGRESS);
  const engineForProgress = engineState(runsForProgress.checkIns);
  const nowForProgress = studioNow();

  const rows: TicketRow[] = [];
  for (const lane of inferred) {
    const filed = filedByRepo.get(lane.repo) ?? [];
    const groups = filed.length ? { ...lane.groups, filed } : lane.groups;
    for (const group of STATUS_GROUPS) {
      for (const item of groups[group] ?? []) {
        rows.push({
          id: item.ticket.id,
          title: item.ticket.title,
          repo: lane.repo,
          group,
          item,
          waiting: waitingFor.get(`${lane.repo} ${item.ticket.id}`) ?? null,
          surface: surfaceOf.get(lane.repo) ?? null,
          progress: ticketProgress({
            ticketId: item.ticket.id,
            ventureId: venture.id,
            group,
            runs: runsForProgress.reports,
            engine: { state: engineForProgress.state, ageMinutes: engineForProgress.ageMinutes },
            waiting: waitingFor.get(`${lane.repo} ${item.ticket.id}`) ?? null,
            now: nowForProgress,
          }),
        });
      }
    }
  }

  // Finished work tied to no ticket at all (FB-099's gap, and FB-129's version of it). It still
  // waits on the founder, so it is a row. Leaving it out is how the rail came to say "Needs you 4"
  // over a filter showing 2: the badge counted what was waiting, the screen counted what happened
  // to have a ticket file.
  const onBoard = new Set(rows.map((r) => `${r.repo} ${r.id}`));
  for (const pr of openPrs) {
    if (pr.linkedTicketId && onBoard.has(`${pr.repo} ${pr.linkedTicketId}`)) continue;
    if (filedPrs.has(`${pr.repo}#${pr.number}`)) continue;
    rows.push({
      id: `${pr.repo}#${pr.number}`,
      title: pr.ticketTitle ?? pr.title,
      repo: pr.repo,
      group: 'pr-open',
      item: null,
      // No ticket file, so there is no ticket for progress to be about. The row still belongs here
      // — it waits on the founder — but "what is happening to this ticket" has no subject.
      progress: null,
      waiting: { repo: pr.repo, number: pr.number, ageMs: pr.ageMs, headSha: pr.headSha, ciStatus: pr.ciStatus },
      surface: surfaceOf.get(pr.repo) ?? null,
    });
  }

  // FB-277: the factory's cards. A card for a ticket the venture has is that ticket's row; any other
  // card is a row of its own, under its ticket's name or its pull request's. Built here, on the
  // server, so John's words reach John alone.
  const nowMs = studioNow();
  for (const c of cards.rows) {
    const id = cardTicketId(c);
    const card = {
      waits: c.waits, standing: c.standing, words: c.words, sentence: cardSentence(c, viewer.isJohn),
      ageMs: Math.max(0, ageMs(c.at, nowMs) ?? 0), href: c.href,
      cost: c.john?.cost ?? null, nextStep: c.john?.nextStep ?? null, quiet: cards.quiet,
    };
    const own = rows.find((r) => r.repo === c.repo && r.id === id && !r.card);
    if (own) {
      own.card = card;
      continue;
    }
    rows.push({
      id, title: c.title, repo: c.repo, group: cardGroup(c), item: null, progress: null, waiting: null,
      surface: surfaceOf.get(c.repo) ?? null, card,
    });
  }

  // FB-149: external sends waiting on the founder are rows too. The rail's "Needs you" badge counts
  // them and leads here, so a list without them is a badge saying 8 over a filter saying 4. Each row
  // points at the send's own page, which is the only place it can be decided (FB-183).
  //
  // Shared with the rail around this page (FB-157), so this is not a second read. A failed read is
  // said out loud rather than shown as "no sends", which would be a claim the studio cannot make.
  const approvalsRead = await ventureApprovals(venture).then(
    (a) => ({ approvals: a, error: null as string | null }),
    () => ({
      approvals: [] as ActiveGraphApproval[],
      error: 'The studio could not read what is waiting to leave your company, so sends are missing from this list.',
    }),
  );
  rows.unshift(...sendRows(approvalsRead.approvals, venture.id, (a) => sendSurface(venture.departments ?? [], a)));

  const refs = new Map(inferred.map((lane) => [lane.repo, lane.ref]));

  // FB-213: which part of the company, before which state its work is in. The desk's three surface
  // columns each said "open the queue →" and all three landed here unfiltered, so pressing Sell's
  // showed Build's work — a control the studio drew, telling a founder something untrue.
  //
  // An unresolvable surface falls back to everything rather than to nothing: an empty screen would
  // read as "this surface has no work", which is a claim about the venture made from a typo.
  const askedSurface = resolveSurface(
    surface,
    // A department can be declared with no repository yet — Scale, before it is connected. It has
    // no queue to open, so it is not a surface anybody can be sent to.
    (venture.departments ?? [])
      .filter((d): d is typeof d & { repo: string } => typeof d.repo === 'string' && d.repo.length > 0)
      .map((d) => ({ id: d.id, repo: d.repo })),
    [...new Set(rows.map((r) => r.repo))],
  );
  const surfaceRows = onSurface(rows, askedSurface);
  const surfaceName = askedSurface
    ? (venture.departments ?? []).find((d) => d.repo === askedSurface)?.name ?? askedSurface
    : null;

  const activeFilter = parseFilter(filter);
  const selected = resolveSelected(surfaceRows, filterTickets(surfaceRows, activeFilter), typeof t === 'string' ? t : null);

  return (
    <TicketsView
      ventureId={venture.id}
      ventureName={venture.name}
      rows={surfaceRows}
      surfaceName={surfaceName}
      surfaceKey={surface ?? null}
      filter={activeFilter}
      // The RESOLVED key, not the raw query. The client used to resolve it again with different
      // fallbacks, so the trail loaded here could belong to a different ticket than the one rendered.
      selectedId={selected ? rowKey(selected) : null}
      // FB-185: did the founder OPEN a ticket, or is the screen just showing the first row?
      //
      // `selectedId` cannot answer that — it falls back to the first row of the filter, so it is
      // non-null almost always. On a phone the two cases want opposite layouts: the list when
      // nobody has opened anything, the ticket when somebody has. Only the URL knows which.
      opened={typeof t === 'string' && t.length > 0}
      // FB-130: STREAMED, not awaited.
      //
      // Blocking the page on it took the tickets screen from usable to **23 seconds** on ARCA's real
      // backlog — measured, three loads, against a desk that costs 6.5s. The trail is supplementary:
      // a founder came here to read a ticket and decide on it, and neither needs the history. So the
      // list and the ticket render immediately and the history arrives when it arrives.
      //
      // Skipped entirely for a row with no ticket file: nothing here can match a `repo#number` id.
      trail={
        selected?.item ? (
          <Suspense fallback={<TrailPending />}>
            <TrailFor venture={venture} row={selected} attention={attention} filedByRepo={filedByRepo} />
          </Suspense>
        ) : null
      }
      // FB-184: where to see the result. Streamed too, because a preview is opened before it is
      // linked to, and that is a network round trip the ticket itself must not wait for. Nothing is
      // drawn while it is checked: a line that changed its mind would be worse than one that arrives.
      follow={
        selected?.item ? (
          <Suspense fallback={null}>
            <FollowFor venture={venture} row={selected} attention={attention} filedByRepo={filedByRepo} approvals={approvalsRead.approvals} />
          </Suspense>
        ) : null
      }
      refs={Object.fromEntries(refs)}
      filedBranches={Object.fromEntries(filedBranch)}
      org={process.env.GITHUB_ORG ?? 'wealthcx01'}
      errors={[
        ...data.lanes.filter((l) => l.error).map((l) => l.error as string),
        ...attention.errors,
        ...(approvalsRead.error ? [approvalsRead.error] : []),
        ...(cards.unread ? [CARDS_UNREAD] : []),
      ]}
    />
  );
}


/**
 * The selected ticket's history, loaded off the critical path (FB-130).
 *
 * Its own async component so React can stream it: the list and the ticket paint immediately and this
 * arrives after. Blocking the page on it cost **23 seconds** on ARCA's real backlog against a 6.5s
 * desk, and a founder came to this screen to read a ticket and decide on it — neither of which needs
 * the history.
 *
 * The read budget, honestly (FB-154 fixes it properly):
 *
 * - `loadApprovals` walks every approval the venture has and is not cached. It is here only to learn
 *   which approvals belong to THIS ticket, which is a question the store cannot currently be asked.
 * - `loadRunReports` is left at its default 20. Raising it to 200 to stop run hops vanishing turned
 *   into `200 × READ_MARGIN` = **600 file reads per repository**, which was most of the 23 seconds.
 *   The cap is honest instead: when there were more reports than were read, the trail says its
 *   history may be short rather than passing a truncated one off as complete.
 */
async function TrailFor({
  venture,
  row,
  attention,
  filedByRepo,
}: {
  venture: VentureSummary;
  row: TicketRow;
  attention: Awaited<ReturnType<typeof loadVentureAttention>>;
  filedByRepo: Map<string, FiledTicket[]>;
}) {
  // Shared with the rail around this page (FB-157), which reads both of these too.
  const [approvals, runs] = await Promise.all([
    // `loadApprovals` returns a plain array; the `Array.isArray` narrowing that used to be here was
    // guarding against a shape it cannot produce.
    ventureApprovals(venture).catch((): ActiveGraphApproval[] => []),
    ventureRuns(venture).catch(() => ({ reports: [] as RunReport[], heartbeats: [] as RunReport[], total: 0 })),
  ]);

  const trail = await loadTrail(venture, row.repo, row.id, trailSources(venture, {
    approvals,
    runs: runs.reports.filter((r) => !r.isHeartbeat && r.repo === row.repo && r.ticketsTouched.includes(row.id)),
    work: attention.approvals,
    filedPrNumbers: filedPrNumbers(filedByRepo),
  }));

  // More reports existed than were read — so runs for this ticket MAY have been missed.
  //
  // Only said when none were found. ARCA has over a hundred run reports and twenty are read, so
  // marking every trail degraded made the warning fire on every ticket forever, and a warning that
  // is always on is one nobody reads. When the window did turn up this ticket's runs it plainly
  // covered it; when it turned up none, "there may be more I could not see" is the honest state and
  // the difference a founder needs.
  //
  // And only for a ticket that shows some evidence of having been worked at all. A ticket nobody has
  // started has no runs because nothing ran, not because the window missed them — saying "this may
  // be short" over the whole unstarted backlog is the always-on warning again, one step quieter.
  const workedOn = trail.hops.some((h) => h.source === 'repo' || h.source === 'preview' || h.source === 'activegraph');
  const mightHaveMissedRuns =
    runs.total > runs.reports.length && workedOn && !trail.hops.some((h) => h.source === 'run');
  return <TicketTrail trail={mightHaveMissedRuns ? { ...trail, degraded: true } : trail} />;
}


/** `repo ticketId` → the pull request a just-filed ticket's work is on (FB-120). */
function filedPrNumbers(filedByRepo: Map<string, FiledTicket[]>): Record<string, number> {
  return Object.fromEntries(
    [...filedByRepo].flatMap(([repo, fs]) => fs.map((f) => [`${repo} ${f.ticket.id}`, f.prNumber] as const)),
  );
}

/**
 * The selected ticket's "Follow it to…" line (FB-184).
 *
 * Reads nothing new except the preview itself: the work, the sends and the departments are all
 * already on this page. The preview is opened through the same `checkedPreview` the trail uses, so
 * the line and the trail's "see it running" hop cannot disagree about whether it works.
 */
async function FollowFor({
  venture,
  row,
  attention,
  filedByRepo,
  approvals,
}: {
  venture: VentureSummary;
  row: TicketRow;
  attention: Awaited<ReturnType<typeof loadVentureAttention>>;
  filedByRepo: Map<string, FiledTicket[]>;
  approvals: ActiveGraphApproval[];
}) {
  const department = (venture.departments ?? []).find((d) => d.repo === row.repo)?.id ?? null;
  const work = workForTicket({ work: attention.approvals, filedPrNumbers: filedPrNumbers(filedByRepo) }, row.repo, row.id);
  const send = sendForTicket(
    approvals,
    { id: row.id, repo: row.repo, department },
    (repo, id) => `/venture/${venture.id}/approvals/${repo}/${id}`,
  );
  const preview = !send && work?.previewUrl ? await checkedPreview(work.previewUrl) : null;
  return <FollowIt line={followLine({ department, hasWork: Boolean(work), preview, send })} />;
}

/**
 * What the founder sees while the history is still being read.
 *
 * A named state rather than a blank space, because the alternative is a ticket that looks finished
 * and then grows a section under the reader's hands. It says what is happening and that nothing is
 * waiting on them.
 */
function TrailPending() {
  return (
    <section
      data-testid="trail-pending"
      style={{ marginTop: '1.5rem', borderTop: '1px solid var(--color-border)', paddingTop: '1rem' }}
    >
      <p className="eyebrow" style={{ marginTop: 0 }}>Follow the change</p>
      <p className="muted" style={{ fontSize: 'var(--fs-body-sm)', margin: 0 }}>
        Reading what happened to this one…
      </p>
    </section>
  );
}
