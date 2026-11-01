import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { loadVentures, type VentureSummary } from '@/lib/ventures';
import { authorizeVentures, canAccessVenture, parseAdminEmails } from '@/lib/authz';
import { loadVentureHealth } from '@/lib/health';
import { ventureApprovals, ventureStory } from '@/lib/venture-reads';
import { type ActiveGraphApproval } from '@/lib/approvals';
import { GitHubClient } from '@/lib/github';
import { buildFeed } from '@/lib/activity-feed';
import { composeActivitySummary } from '@/lib/activity-summary';
import { classifyActivity, dedupeActivity, isFounderVisible } from '@/lib/activity-kind';
import { groupFailures } from '@/lib/read-failures';
import { historyIsPartial, historyScope } from '@/lib/history-scope';
import { VentureForbidden } from '@/components/VentureForbidden';
import { ActivityFeed } from '@/components/ActivityFeed';
import { Mark } from '@/components/Mark';
import { FactoryQuiet } from '@/components/FactoryQuiet';
import { CARDS_UNREAD, ventureCardRows, viewerOf } from '@/lib/factory-work-load';
import { cardEvents } from '@/lib/factory-work';

/**
 * What happened (FB-132) — everything this venture did, newest first.
 *
 * ## Venture-scoped, which is a narrowing
 *
 * This route was a shim over `/activity`, which spans **every venture the viewer can reach**. The
 * design puts this screen inside one venture's rail showing that venture's events, so it is scoped
 * now — enforced here, server-side, before any read (CLAUDE.md #6).
 *
 * For an admin that is a loss: the all-ventures feed is how John saw the portfolio at a glance. It
 * still exists at `/activity` and becomes the admin ledger's job in FB-136. Narrowing this screen
 * without leaving that one standing would have taken something away and replaced it with nothing.
 *
 * ## The founder's own decisions are here, and were not
 *
 * A founder could not see their own yes in the record. Approvals and refusals come from the same
 * `loadApprovals` the desk reads — no per-row read, no second source of truth about what was
 * decided.
 */
export default async function VentureActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ refresh?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect('/login');

  const { id } = await params;
  const { refresh } = await searchParams;

  const ventures = loadVentures();
  const access = authorizeVentures(session.user.email, ventures, parseAdminEmails(process.env.STUDIO_ADMIN_EMAILS));
  const venture = ventures.find((v) => v.id === id);
  if (!venture || !canAccessVenture(access, id)) {
    return <VentureForbidden ventureId={id} exists={Boolean(venture)} />;
  }

  return (
    <Suspense fallback={<ActivityWaiting ventureName={venture.name} />}>
      <Record venture={venture} isAdmin={access.isAdmin} email={session.user.email} refreshing={refresh === '1'} />
    </Suspense>
  );
}

/**
 * The screen before its records are in (FB-158).
 *
 * Every other screen under a venture answers in about 230 ms; this one took **5,986 ms**, because it
 * awaited three reads before rendering anything — and `ventureRuns` alone is the most expensive read
 * in the studio (~4.3s, measured in FB-157).
 *
 * The heading is true before any of them return, so it renders now.
 *
 * **No summary sentence, no skeleton rows, and no controls.** The summary counts changes in a
 * fourteen-day window: a greyed-out one is still a claim about the venture. And a control in a
 * Suspense fallback is not hydrated — FB-157 shipped one, and while the boundary resolved there were
 * two of it in the document, one of them dead.
 */
function ActivityWaiting({ ventureName }: { ventureName: string }) {
  return (
    <section data-testid="activity-waiting">
      <p className="eyebrow"><span className="eyebrow-id">{ventureName}</span> — What happened</p>
      <h1 style={{ margin: '0 0 0.5rem' }}>What happened</h1>
      <p className="muted" data-testid="activity-waiting-line"
         style={{ fontSize: 'var(--fs-body-sm)', maxWidth: 'var(--content-narrow)' }}>
        Reading what {ventureName} has been doing&hellip;
      </p>
    </section>
  );
}

/** The record once it is read. Everything below here costs a round trip. */
async function Record({
  venture,
  isAdmin,
  email,
  refreshing,
}: {
  venture: VentureSummary;
  isAdmin: boolean;
  email: string;
  refreshing: boolean;
}) {
  // Three reads, in parallel, each already bounded by its own loader (FB-123). This screen adds no
  // per-row read: the decisions come out of the approvals the desk already loads, not from walking
  // each one's event history.
  //
  // A source that could not be read is SAID, never swallowed. Both of these degraded silently, and
  // the consequence was specific: a mis-scoped token 403s the approvals read, every decision
  // disappears, and the page goes on promising "your decisions appear the moment you make them"
  // with nothing to show it could not see (CLAUDE.md #10). A log that quietly drops failures is
  // worse than no log — including when what it drops is its own.
  const unreadable: string[] = [];
  const viewer = viewerOf(email, venture);
  const [health, runs, approvals, cards] = await Promise.all([
    loadVentureHealth(venture, { refresh: refreshing }),
    // One line per stretch of work on one ticket (FB-180), not the newest reports the desk reads.
    ventureStory(venture).catch(() => {
      unreadable.push('what your team has been doing');
      return { reports: [], heartbeats: [], checkIns: [], total: 0, earliest: null, busiest: null, stretches: null };
    }),
    ventureApprovals(venture).catch((): ActiveGraphApproval[] => {
      unreadable.push('the decisions you have made');
      return [];
    }),
    // FB-277: the factory's cards and what was pressed on them, in this viewer's words.
    ventureCardRows(venture, viewer),
  ]);

  // Dedupe, THEN filter. `health.activity` carries a merged pull request with its paths and a paired
  // commit without them: filtering first drops the pull request as housekeeping and leaves its twin,
  // which classifies as `unknown` and is founder-visible — so a `.github/workflows/` change that
  // `/activity` correctly hides reappeared here as "changed".
  const activity = dedupeActivity(health.activity).filter((e) => isFounderVisible(classifyActivity(e)));

  // `loadRunReports` already partitions heartbeats out; they arrive in their own field.
  // FB-180: the meta column names the surface a founder owns, not the repository git happens to
  // keep it in. Built here because the manifest is the only place that knows the mapping.
  const surfaces = Object.fromEntries((venture.departments ?? []).map((d) => [d.repo, d.name]));
  const { items: feed, truncated, cardsTruncated } = buildFeed({
    activity, runs: runs.reports, approvals, limit: FEED_LIMIT, surfaces, ventureName: venture.name,
    cards: cards.cards.flatMap((c) => cardEvents(c, viewer, venture.name)), cardLimit: CARD_FEED_LIMIT,
    departments: Object.fromEntries((venture.departments ?? []).map((d) => [d.id, d.name])),
  });
  // Composed from the SAME list the rows come from. `lib/activity-summary.ts` states that invariant
  // in its own header — "there is no second pass that could drift" — and composing it from the
  // undeduplicated events made the paragraph count changes the list below did not show.
  // `withoutList`: the rows are printed directly below this, so "Most recently: A, B and C" would
  // name the first three of them (FB-180). The design's summary here is the counts sentence alone.
  const summary = composeActivitySummary({ events: activity, windowDays: 14, openAreas: [], withoutList: true });

  const failures = health.repos.filter((r) => r.error).map((r) => r.error as string);

  // FB-242. What the screen may honestly claim about a record it has only partly read.
  //
  // Before FB-180 the rows were the newest reports, and `truncated` alone could not be trusted: on
  // ARCA twenty reports were read, they collapsed to one row because they were all the same park,
  // and one row built with one row kept "dropped nothing" while 9,869 reports were unseen.
  //
  // FB-180 changed what a row is. The runs are now one per stretch of work (`ventureStory`), so no
  // collapse can hide anything: each stretch is its own row. The page is showing less than the
  // whole record when either (a) it read fewer stretches than exist, or (b) it had more rows than
  // it shows and dropped the oldest. Either one, and it says so.
  const record = feed.filter((i) => i.source !== 'card');
  const bounded = historyIsPartial(truncated, runs.reports.length, runs.stretches ?? runs.total);
  const scope = historyScope({
    ventureName: venture.name,
    // The run record's own rows: the factory's lines have their own allowance and their own dates.
    shown: record.length,
    total: runs.total,
    earliest: runs.earliest,
    oldestShown: record.length ? record[record.length - 1].at : null,
    busiest: runs.busiest,
    bounded,
    byStretch: typeof runs.stretches === 'number',
  });

  return (
    <section data-testid="venture-activity">
      <p className="eyebrow"><span className="eyebrow-id">{venture.name}</span> — What happened</p>
      <h1 style={{ margin: '0 0 0.5rem' }}>What happened</h1>

      {/* The summary counts CHANGES in a fourteen-day window; the record below also carries runs
          and decisions, which have no window at all. A founder read "in the last 14 days" directly
          above a decision from June and reasonably took the paragraph as describing the list. So the
          paragraph says what it counts, and the list says how far back it goes. */}
      <div data-testid="activity-summary" style={{ maxWidth: 'var(--content-narrow)' }}>
        {summary.sentences.map((s, i) => (
          <p key={i} style={{ fontSize: 'var(--fs-body-sm)', margin: '0 0 0.3rem' }}>
            {i === 0 ? <>Changes to your product: {s.charAt(0).toLowerCase()}{s.slice(1)}</> : s}
          </p>
        ))}
      </div>

      <p className="muted" data-testid="activity-scope" style={{ fontSize: 'var(--fs-body-sm)', maxWidth: 'var(--content-narrow)' }}>
        {scope ? <>{scope} </> : null}Sent, failed, refused: it stays here with its state. Decisions
        appear the moment they are made.
      </p>

      <FactoryQuiet line={cards.quiet} testId="activity-cards-quiet" />
      <ActivityFeed items={feed} couldNotRead={unreadable.length > 0 || failures.length > 0 || cards.unread} />

      {cards.unread ? (
        <p className="card muted" data-testid="activity-cards-unread" style={{ fontSize: 'var(--fs-body-sm)', maxWidth: 'var(--content-narrow)' }}>
          <Mark />{CARDS_UNREAD}
        </p>
      ) : null}

      {/* Fires on the bound that matters — the record being larger than the page — not on whether
          the last step happened to drop a row. */}
      {bounded ? (
        <p className="muted" data-testid="activity-capped" style={{ fontSize: 'var(--fs-meta-lg)' }}>
          Older entries are still in your venture’s records. Nothing here has been deleted.
        </p>
      ) : cardsTruncated ? (
        // FB-277: the factory's lines have their own allowance, so they say so on their own.
        <p className="muted" data-testid="activity-cards-capped" style={{ fontSize: 'var(--fs-meta-lg)' }}>
          Older lines about your team’s finished work are still kept. Nothing here has been deleted.
        </p>
      ) : null}

      {unreadable.length ? (
        <p className="card" data-testid="activity-unreadable" style={{ fontSize: 'var(--fs-body-sm)', maxWidth: 'var(--content-narrow)' }}>
          <Mark />
          The studio could not read {unreadable.join(' or ')}, so this record is incomplete. It is not
          that nothing happened — it is that the studio could not see it. Bruntsfield can look into why.
        </p>
      ) : null}

      {failures.length ? (
        <div data-testid="activity-failures" style={{ marginTop: '1.25rem' }}>
          {groupFailures(failures).map((g, i) => (
            <p key={i} className="card muted" style={{ fontSize: 'var(--fs-body-sm)' }}>
              <Mark />{g.text}
              {/* What happens next, including "this one will not clear on its own" — the half a
                  founder can act on, and the reason these are grouped by cause at all. */}
              {g.nextStep ? <> {g.nextStep}</> : null}
            </p>
          ))}
        </div>
      ) : null}

      {isAdmin ? (
        // Only Bruntsfield. A founder has one venture and the cross-venture feed would be a door to
        // a room with their own furniture in it.
        <p className="muted" data-testid="activity-all-ventures" style={{ fontSize: 'var(--fs-meta-lg)', marginTop: '1.25rem' }}>
          <Link href="/activity">Every venture at once →</Link>
        </p>
      ) : null}
    </section>
  );
}

/**
 * Bounded because the page is, not because the truth is — and it says so when it caps.
 *
 * Forty on ARCA's real record is 3,556px, against a design that fits one screen and shows six rows
 * for a week. FB-178 settled this argument on the desk: a screen a founder reads beats a screen a
 * founder scrolls, and "everything, in order" is a shape that only ever grows.
 *
 * The line under the list says plainly how many it shows and that the rest is still in the
 * venture's records. Nothing is lost and nothing is implied to be complete that is not.
 *
 * Twelve since FB-180. Rows became one per stretch of work, so the page reached five weeks back on
 * ARCA instead of one day — and twenty of those measured 1,807px against the ticket's 1,500. Twelve
 * on ARCA is back to 26 August: the last month of the venture, on about one and a half screens.
 */
const FEED_LIMIT = 12;

/**
 * The factory's newest card lines, shown beside those twelve rather than instead of them (FB-277).
 * Six is about a week of one venture's finished, stuck and decided work.
 */
const CARD_FEED_LIMIT = 6;
