import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { loadAccessibleHealth, type RepoHealth, type ActivityEvent } from '@/lib/health';
import { classifyActivity, dedupeActivity, filedTicketId, isFounderVisible, MEANING_LABEL } from '@/lib/activity-kind';
import { composeActivitySummary } from '@/lib/activity-summary';
import { loadRunReports } from '@/lib/runreports';
import { githubRunReportSource, fixtureRunReportSource } from '@/lib/runreports-load';
import { stuckTickets } from '@/lib/brief';
import { GitHubClient, githubBudget, budgetIsLow } from '@/lib/github';
import { ciRunTone, toneColor } from '@/lib/status';
import { loadVentures } from '@/lib/ventures';
import { authorizeVentures, parseAdminEmails } from '@/lib/authz';
import { groupFailures, needsAction } from '@/lib/read-failures';
import { ago, studioNow } from '@/lib/when';
import { factoryCardsForJohn, ventureCardRows, viewerOf } from '@/lib/factory-work-load';
import { FACTORY_NAME, FACTORY_VENTURE, cardEvents, type CardEvent } from '@/lib/factory-work';
import { Mark } from '@/components/Mark';
import { FactoryQuiet } from '@/components/FactoryQuiet';

/**
 * The window this page shows. One constant, because FB-108's opening paragraph states the same
 * number as the heading above the feed — and two literals would eventually disagree.
 */
const ACTIVITY_WINDOW_DAYS = 14;

/**
 * What has been happening (FB-008, rewritten by FB-080).
 *
 * This page was called "CI & activity" and opened, per repository, with *"no CI runs · unprotected ·
 * active"*. `unprotected` is a GitHub branch-protection setting. `no CI runs` means nobody has
 * configured automated tests. Neither is a thing that happened, neither is a thing a founder can act
 * on, and together they filled 3.3 screens and 55,846 characters of a page called **Activity**.
 *
 * It is now what its name says: things that happened, newest first.
 *
 * The repository administration is not deleted — it is real, and Bruntsfield genuinely needs it. It
 * is shown to **admins only**, which is the honest home for it: a founder should not have to learn
 * what branch protection is to read their own company's news.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ refresh?: string; repo?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect('/login');
  const { refresh, repo: repoFilter } = await searchParams;
  const { ventures, activity } = await loadAccessibleHealth(session.user.email, { refresh: refresh === '1' });
  const ventureSummaries = loadVentures();
  const isAdmin = authorizeVentures(
    session.user.email,
    ventureSummaries,
    parseAdminEmails(process.env.STUDIO_ADMIN_EMAILS),
  ).isAdmin;

  // One place, one wording. The same missing repository was previously reported here, on the
  // attention queue and on the venture board, in three slightly different sentences.
  const failures = ventures.flatMap((v) => v.health.repos.filter((r) => r.error).map((r) => r.error as string));

  const allRepos = ventures.flatMap((v) => v.health.repos.map((r) => r.repo));
  // FB-096, in order: one human event per row, then only what is a founder's business. Admins keep
  // the housekeeping — it is real and Bruntsfield needs it; it is not what a founder came here for.
  const deduped = dedupeActivity(repoFilter ? activity.filter((e) => e.repo === repoFilter) : activity);
  const events = isAdmin ? deduped : deduped.filter((e) => isFounderVisible(classifyActivity(e)));
  const hidden = deduped.length - events.length;

  // FB-277: what the factory's cards said, for every venture this person passed the check for, in
  // their words. John also reads the factory's own cards, cowgate's, which no founder ever sees.
  // Kept to the same window as the rest of the page.
  const windowStart = studioNow() - ACTIVITY_WINDOW_DAYS * 86_400_000;
  const email = session.user.email;
  const cardLines: (CardEvent & { ventureName: string })[] = [];
  // One planning box serves every venture, so any read that has cards says whether it is quiet.
  let cardsQuiet: string | null = null;
  for (const v of ventures) {
    const summary = ventureSummaries.find((x) => x.id === v.id);
    if (!summary) continue;
    const viewer = viewerOf(email, summary);
    const read = await ventureCardRows(summary, viewer);
    cardsQuiet ??= read.quiet;
    for (const c of read.cards) cardLines.push(...cardEvents(c, viewer, summary.name).map((e) => ({ ...e, ventureName: summary.name })));
  }
  if (isAdmin) {
    const viewer = viewerOf(email, null);
    const read = await factoryCardsForJohn(viewer);
    cardsQuiet ??= read.quiet;
    for (const c of read.cards) cardLines.push(...cardEvents(c, viewer, FACTORY_NAME).map((e) => ({ ...e, ventureName: FACTORY_NAME })));
  }
  const shownCards = cardLines
    .filter((c) => Date.parse(c.at) >= windowStart && (!repoFilter || c.repo === repoFilter))
    .sort((a, b) => b.at.localeCompare(a.at));
  // One list, newest first: the repositories' events and the cards' lines by their own times.
  const feed = [
    ...events.map((e, i) => ({ at: e.at, key: `e-${e.url}-${i}`, event: e, card: null })),
    ...shownCards.map((c, i) => ({ at: c.at, key: `c-${c.ventureId}-${c.repo}-${c.number}-${i}`, event: null, card: c })),
  ].sort((x, y) => Date.parse(y.at) - Date.parse(x.at));

  // FB-108. Built from `events` — the same list, already deduplicated and already filtered to what
  // this reader may see — so the paragraph counts exactly the rows underneath it. Passing the raw
  // feed here instead would give an admin and a founder different numbers above identical rows.
  const activitySummary = composeActivitySummary({ events, windowDays: ACTIVITY_WINDOW_DAYS });

  // FB-096: "whatever happened to the tagline fix?" A filing that merged three days ago tells the
  // founder their request was accepted; it says nothing about the work, which may have been tried
  // three times and parked. The answer has to be on the row that raised the question.
  const parked = new Set<string>();
  await Promise.all(
    ventures.map(async (v) => {
      try {
        const runSource =
          process.env.RUNREPORTS_FIXTURE_DIR && process.env.E2E_TEST_LOGIN === '1'
            ? fixtureRunReportSource(process.env.RUNREPORTS_FIXTURE_DIR)
            : githubRunReportSource(new GitHubClient());
        const summary = ventureSummaries.find((x) => x.id === v.id);
        if (!summary) return;
        const runs = await loadRunReports(summary, runSource);
        for (const id of stuckTickets(runs.reports)) parked.add(id);
      } catch {
        // Unreadable run history means the feed simply does not annotate — it never means "fine".
      }
    }),
  );

  return (
    <section>
      <p className="eyebrow"><span className="eyebrow-id">Activity</span> — Foundry Studio</p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>What has been happening</h1>
        <Link href="/activity?refresh=1" className="mono muted" data-testid="activity-refresh" style={{ fontSize: 'var(--fs-meta-lg)' }}>refresh</Link>
      </div>
      <p className="muted" style={{ fontSize: 'var(--fs-body-sm)', maxWidth: 'var(--content-narrow)' }}>
        Everything your ventures have done lately, newest first.{' '}
        {/* Said, not hidden: a feed that quietly drops rows is a feed that cannot be counted on
            either. The founder is told the housekeeping exists and that it is not theirs. */}
        {hidden > 0 ? (
          <span data-testid="activity-hidden">
            {hidden} more {hidden === 1 ? 'entry is' : 'entries are'} housekeeping Bruntsfield does on
            the studio itself, and are not shown here.
          </span>
        ) : null}
      </p>

      <hr className="hr" />

      {/* Activity feed — the thing the page is named after, and now the first thing on it. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <h2 style={{ margin: 0 }}>Last {ACTIVITY_WINDOW_DAYS} days</h2>
        <span className="muted" style={{ fontSize: 'var(--fs-meta-lg)' }}>filter:</span>
        <Link href="/activity" className={`pill`} data-active={!repoFilter} data-testid="filter-all">all</Link>
        {[...new Set(allRepos)].map((r) => (
          <Link key={r} href={`/activity?repo=${encodeURIComponent(r)}`} className="pill" data-active={repoFilter === r} data-testid={`filter-${r}`}>
            {r}
          </Link>
        ))}
      </div>

      {/*
        FB-108: the paragraph a chief of staff would open with. Composed from the very events
        rendered below — same list, after the same deduplication and the same visibility filter — so
        the numbers here are arithmetic on the rows and cannot drift from them. Deterministic, so it
        renders instantly and is never waiting on anything.
      */}
      {activitySummary.sentences.length > 0 && (
        <p className="card" data-testid="activity-summary" style={{ marginBottom: '0.75rem' }}>
          {activitySummary.sentences.join(' ')}
        </p>
      )}

      <FactoryQuiet line={cardsQuiet} testId="activity-cards-quiet" />

      {feed.length === 0 ? (
        <p className="card muted" data-testid="activity-empty">
          Nothing has happened in the last {ACTIVITY_WINDOW_DAYS} days. When your team builds something, or a check
          fails, it appears here.
        </p>
      ) : (
        <div className="stack" data-testid="activity-feed" style={{ gap: '0.4rem' }}>
          {feed.map(({ key, event, card }) => event ? (
            <ActivityRow key={key} event={event} parked={isParked(event, parked)} />
          ) : card ? (
            <CardActivityRow key={key} line={card} />
          ) : null)}
        </div>
      )}

      {/* One wording, one place (FB-076's grouping). Below the news, not in front of it. */}
      {failures.length > 0 ? (
        <div data-testid="activity-errors" style={{ marginTop: '1.5rem' }}>
          <p className="eyebrow" style={{ marginBottom: '0.4rem' }}>
            {needsAction(groupFailures(failures)) ? 'Some of your work is not showing' : 'One workstream is catching up'}
          </p>
          {groupFailures(failures).map((g) => (
            <p key={g.cause} className="card" data-testid={`read-failure-${g.cause}`}
               style={{ fontSize: 'var(--fs-meta-lg)', marginBottom: '0.5rem',
                        borderColor: g.transient ? undefined : toneColor('attention') }}>
              {g.text} <span className="muted">{g.nextStep}</span>
            </p>
          ))}
        </div>
      ) : null}

      {/* FB-080: repository administration — branch protection, whether tests are configured — is
          real and Bruntsfield needs it. It is not a founder's business, and it used to be the first
          thing on their Activity page. Admins only. */}
      {isAdmin ? (
        <>
          <hr className="hr" />
          {/* FB-083's last acceptance criterion. The ceiling was measured (FB-077) and lowered
              (FB-083) and through both of those nobody could SEE it — the first sign of running out
              would have been a founder's board quietly failing to show their work. */}
          <BudgetStrip />
          {/* copy-lint-ok: admin-only (inside `isAdmin`) — this is repository administration, which is
              what it is called, and a founder never reaches it */}
          <h2 style={{ marginBottom: '0.25rem' }}>Repository health</h2>
          <p className="muted" style={{ fontSize: 'var(--fs-body-sm)' }}>
            {/* copy-lint-ok: admin-only (inside `isAdmin`) — branch protection is the setting's name */}
            Bruntsfield only — branch protection and whether automatic checks are set up.
          </p>
          {ventures.map((v) => (
            <div key={v.id} style={{ marginBottom: '1.25rem' }} data-testid={`health-venture-${v.id}`}>
              <h3 className="mono" style={{ fontSize: 'var(--fs-subhead)' }}>{v.name} <span className="muted">· {v.id}</span></h3>
              <div className="stack" style={{ gap: '0.5rem' }}>
                {v.health.repos.map((r) => <HealthStrip key={r.repo} health={r} />)}
              </div>
            </div>
          ))}
        </>
      ) : null}
    </section>
  );
}

/**
 * What is left of GitHub's allowances, for whoever operates the studio (FB-083).
 *
 * Admin-only and deliberately plain: two numbers, when they refill, and when the studio last heard.
 * A resource the studio has not touched this process says so rather than showing a reassuring blank
 * — "not heard yet" and "nearly empty" must never look the same.
 */
function BudgetStrip() {
  const { rest, graphql } = githubBudget();
  if (!rest && !graphql) return null;
  const row = (label: string, b: ReturnType<typeof githubBudget>['rest']) =>
    b ? (
      <span data-testid={`budget-${label}`} data-low={budgetIsLow(b) ? 'true' : 'false'}
            /* FB-211: amber. A budget running low is a decision waiting on the founder who set the
               limit — the same fact the desk and the rail now show in amber, and it must not be a
               different colour here just because it is a different screen. */
            style={{ color: budgetIsLow(b) ? toneColor('attention') : undefined, fontWeight: budgetIsLow(b) ? 600 : undefined }}>
        {label}: {b.remaining.toLocaleString()} of {b.limit.toLocaleString()} left, refills {ago(b.resetsAt) ?? 'shortly'}
      </span>
    ) : null;

  return (
    <p className="muted" data-testid="github-budget" style={{ fontSize: 'var(--fs-meta-lg)', margin: '0 0 0.75rem' }}>
      {/* copy-lint-ok: admin-only — this is the GitHub API budget, and naming it anything else would
          leave the operator guessing which ceiling the number is about */}
      <strong>GitHub budget</strong>{' '}
      {row('REST', rest)}
      {rest && graphql ? ' · ' : null}
      {row('GraphQL', graphql)}
    </p>
  );
}

// copy-lint-ok: admin-only strip — the git words are the precise ones for the person who acts on it
const STALE_TITLE = 'No commits or merges in over two weeks.';

/** Rendered only inside the `isAdmin` block above — Bruntsfield's own view of repository plumbing. */
function HealthStrip({ health }: { health: RepoHealth }) {
  const runColor = toneColor(ciRunTone(health.latestRun?.conclusion));
  return (
    <article className="card" data-testid={`health-${health.repo}`} style={{ padding: '0.7rem 0.9rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="mono" style={{ fontWeight: 500 }}>{health.repo}</span>
      {health.error ? (
        <span className="tag" style={{ color: toneColor('blocked') }}>{health.error}</span>
      ) : (
        <>
          {health.latestRun ? (
            <a className="tag mono" href={health.latestRun.url} target="_blank" rel="noreferrer" style={{ color: runColor }} data-testid={`health-run-${health.repo}`}>
              CI {health.latestRun.conclusion}
            </a>
          ) : (
            // copy-lint-ok: admin-only strip — Bruntsfield checks CI by name
            <span className="tag mono muted">no CI runs</span>
          )}
          <span className={`tag ${health.protected ? 'tag-accent' : ''}`} data-testid={`health-protection-${health.repo}`} style={health.protected ? undefined : { color: toneColor('attention') }}>
            {health.protected ? 'protected' : 'unprotected'}
          </span>
          {health.stale ? (
            <span className="tag" data-testid={`health-stale-${health.repo}`} tabIndex={0}
                  title={STALE_TITLE}
                  style={{ color: toneColor('attention') }}>
              <Mark />nothing lately
            </span>
          ) : (
            <span className="tag muted" data-testid={`health-active-${health.repo}`}>active</span>
          )}
        </>
      )}
    </article>
  );
}

/**
 * The badge on each row (FB-103's words, FB-096's meaning).
 *
 * A merged change is labelled by WHAT IT WAS, not by the git verb: the walkthrough met "MERGED —
 * Replace Bloomberg/Pokemon tagline" three days before opening the product and finding the old
 * tagline still there, because what merged was the request. A failure and a bare commit keep their
 * own words — neither one claims anything about the founder's product.
 */
const KIND_LABEL: Record<ActivityEvent['kind'], string> = {
  'pr-merged': 'accepted',
  'ci-failed': 'checks failed',
  commit: 'change',
};

function rowLabel(event: ActivityEvent): string {
  if (event.kind !== 'pr-merged') return KIND_LABEL[event.kind];
  const meaning = classifyActivity(event);
  return meaning === 'unknown' ? KIND_LABEL['pr-merged'] : MEANING_LABEL[meaning];
}

/** True when this row is a filing whose ticket has since been tried and stopped. */
function isParked(event: ActivityEvent, parked: ReadonlySet<string>): boolean {
  if (classifyActivity(event) !== 'ticket-filed') return false;
  const id = filedTicketId(event);
  return !!id && parked.has(id);
}

/**
 * One line from a factory card (FB-277), in the same look as the rows around it. The cost is on it
 * only for John: `cost` is null for anyone else, on the server.
 */
function CardActivityRow({ line }: { line: CardEvent & { ventureName: string } }) {
  const id = `${line.ventureId === FACTORY_VENTURE ? 'factory' : line.ventureId}-${line.repo}-${line.number}`;
  const body = (
    <>
      <span className="tag mono" style={{ minWidth: '5.5rem', textAlign: 'center' }}>your team</span>
      {/* The meta goes under the sentence, not beside it: it is longer than a repository's name, and
          beside it on a phone it squeezed the sentence to one word a line. */}
      <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-body-sm)' }}>
        {line.text}
        <span className="muted mono" style={{ display: 'block', fontSize: 'var(--fs-meta)', marginTop: '0.15rem' }}>
          {[line.ventureName, line.ref, line.cost, ago(line.at)].filter(Boolean).join(' · ')}
        </span>
      </span>
    </>
  );
  const style = { padding: '0.5rem 0.8rem', display: 'flex', gap: '0.6rem', alignItems: 'baseline' } as const;
  return line.href ? (
    <Link className="card card-link" href={line.href} data-testid={`activity-card-${id}`} style={style}>{body}</Link>
  ) : (
    <div className="card" data-testid={`activity-card-${id}`} style={style}>{body}</div>
  );
}

function ActivityRow({ event, parked = false }: { event: ActivityEvent; parked?: boolean }) {
  return (
    <a className="card card-link" href={event.url} target="_blank" rel="noreferrer" data-testid={`activity-${event.kind}`} style={{ padding: '0.5rem 0.8rem', display: 'flex', gap: '0.6rem', alignItems: 'baseline' }}>
      <span className="tag mono" data-testid={`activity-label-${event.kind}`} style={{ minWidth: '5.5rem', textAlign: 'center' }}>
        {rowLabel(event)}
      </span>
      <span style={{ flex: 1, fontSize: 'var(--fs-body-sm)' }}>
        {event.title}
        {/* FB-211: amber. The sentence says it — "It needs a person" — and `attention` means exactly
            that: needs a human, or a next step the founder must take. Red is for a fault nobody on
            the venture can clear, and this is its opposite: the one thing that clears it is somebody
            looking at it. */}
        {parked ? (
          <span data-testid="activity-parked" style={{ color: toneColor('attention'), fontWeight: 600 }}>
            {' '}— tried since, and stopped. It needs a person.
          </span>
        ) : null}
      </span>
      <span className="muted mono" style={{ fontSize: 'var(--fs-meta)' }}>{event.repo} · {ago(event.at) ?? ''}</span>
    </a>
  );
}

