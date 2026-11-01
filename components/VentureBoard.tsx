'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
// Type-only imports: lib/tickets pulls in node:fs / the GitHub client, which must never reach the
// client bundle. `import type` is erased at build, so only the shapes cross the boundary.
import type { LaneTickets, TicketStatusGroup, TicketWithMeta } from '@/lib/tickets';
import type { DepartmentSummary } from '@/lib/ventures';
import type { ActiveGraphApproval } from '@/lib/approvals';
import type { PrApproval } from '@/lib/attention';
import { STATUS_LABEL } from '@/lib/glossary';
import { agoMs } from '@/lib/when';
import { emptyPanel } from '@/lib/firstrun';
import { laneErrorTone, toneColor } from '@/lib/status';
import { ticketProgress } from '@/lib/ticket-progress';
import { isUnnumbered } from '@/lib/ticket-ids';
import { BlockerBanner, DegradedStrip, DeskSummary } from './DeskHeader';
import { OfficePlate } from './OfficePlate';
import { OfficeLedger } from './OfficeLedger';
import { OfficeEmbed } from './OfficeEmbed';
import type { Office } from '@/lib/office';
import { lastSend, outboxUrl } from '@/lib/sends';
import { WaitingQueue, externalWaitingItem, prWaitingItem, type WaitingItem } from './WaitingQueue';
import { PromptBar } from './PromptBar';
import { describe as describeBudget, type BudgetDisclosure } from '@/lib/budgets';
import { surfaceOutcome, type DegradedGroup } from '@/lib/desk';
import { META_ADS_CONNECTOR } from '@/lib/meta-ads';
import { offerFor, type PreviewCheck } from '@/lib/result-link';
import { sendSurface, sendsWaitingOnFounder } from '@/lib/needs-you';
import { EngineActivity } from './EngineActivity';
import { WhileWorking } from './WhileWorking';
import type { Brief } from '@/lib/brief';
import type { AgedRun } from '@/lib/runreports';
import { Mark } from './Mark';
import { FactoryQuiet } from './FactoryQuiet';

// FB-048: the founder's three owned surfaces. Plain-language gate labels (FB-024) — the founder sees
// "how work here is approved", never the contract enum.
//
// WHOLE SENTENCES, not fragments slotted into "Work here is ___." (FB-063). The fragment form read
// "Work here is approval coming." for the gate that has not been specified yet — a template can only
// be as grammatical as its worst case, and the worst case is the one a founder meets on a surface
// nobody has finished designing.
/**
 * The one gate sentence a surface still prints (FB-203, item 11).
 *
 * The other two — "Work here is approved by review", "Work here is approved before it goes out" —
 * were policy, printed once per surface on every desk load, and policy belongs in the handbook.
 * This one is not policy. It says nothing can leave the company while the gate is unsettled, which
 * is a fact about this venture right now and the kind of thing non-negotiable 10 is about.
 */
const GATE_UNDECIDED = 'How work here gets approved is still being decided. Nothing goes out meanwhile.';

// Column keys stay technical (col-<key> test ids, contract statuses); the visible label is the
// founder-facing term from the glossary (FB-024) — e.g. "pr-open" → "Needs your OK".
const GROUPS: { key: TicketStatusGroup; label: string }[] = [
  // FB-120: first, because it is the earliest thing that can be true of a piece of work — the founder
  // has approved it and nobody has picked it up. The column is omitted entirely when empty (below);
  // a permanently empty first column would be a worse first impression than no column at all.
  { key: 'filed', label: STATUS_LABEL.filed },
  { key: 'todo', label: STATUS_LABEL.todo },
  { key: 'in-progress', label: STATUS_LABEL['in-progress'] },
  { key: 'pr-open', label: STATUS_LABEL['pr-open'] },
  { key: 'done', label: STATUS_LABEL.done },
];

interface Selected {
  repo: string;
  ref: string;
  item: TicketWithMeta;
  /** The column it was opened from — the drawer must agree with the board about where it sits. */
  group: TicketStatusGroup;
}

// FB-021: present each read-failure state so a founder can tell "not set up yet" from "broken".
// Setup states read `attention` (a next step, not a crash); an unexpected fault reads `blocked`.
// FB-057 moved the tone decision itself into lib/status.ts — the studio has one status vocabulary,
// and a component that keeps its own private one is how the patchwork starts.
type LaneErrorKind = LaneTickets['errorKind'];

function laneErrorNextStep(kind: LaneErrorKind): string | null {
  switch (kind) {
    // FB-103: the founder's sentence first \u2014 it tells them who has to act, which is the only thing
    // they can do anything with. The instruction that follows is for whoever fixes it, and it stays
    // exact: FB-021 built these states so a person could act on them, and "something is misconfigured"
    // is a diagnosis nobody can act on.
    case 'no-credentials':
      // copy-lint-ok: the bracketed half is the repair instruction for Bruntsfield, labelled as such
      return 'Bruntsfield connects the studio to this venture\u2019s records so it can see the work. (For Bruntsfield: install the Foundry GitHub App, or set a read token.)';
    case 'unreadable':
      // copy-lint-ok: the bracketed half is the repair instruction for Bruntsfield, labelled as such
      return 'Bruntsfield gives the studio read access to this venture\u2019s records \u2014 or checks the name it was given is right. (For Bruntsfield: install or scope the Foundry GitHub App, or the read token, for this repository.)';
    case 'rate-limit':
    case 'error':
    case null:
      return null;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}


export function VentureBoard({
  venture,
  lanes,
  departments = [],
  doors = {},
  approvals = [],
  lastSendAgeMs = null,
  budgets = [],
  budgetsError = null,
  brief = null,
  summary = null,
  blocker = null,
  degraded = [],
  full = false,
  officeSrc = null,
  officeSocket = null,
  runs = [],
  runsTotal = 0,
  engine = null,
  office,
  orphanEnvelopes = [],
  staleRepos = [],
  totalWarnings,
  fetchedAgeMs,
  org,
  openWork = {},
  openWorkQueue = [],
  cardItems = [],
  cardsQuiet = null,
  filedRefs = {},
  unmatchedWork = {},
  viewerIsFounder = false,
  wiringWarning = null,
}: {
  venture: {
    id: string; name: string; status: string; founderName: string | null; hasComposer: boolean;
    /** The box's own chat, on its own screen (FB-086). Null until the venture has a box. */
    /** The venture's own Workspace address — the outbox the Sell surface links to (FB-142). */
    founderEmail?: string | null;
  };
  lanes: LaneTickets[];
  departments?: DepartmentSummary[];
  /**
   * What opening each surface's door found, by department id (FB-184). A door is drawn as a link
   * only when its check says it opens; a department with a `launch` and no entry here gets no link.
   */
  doors?: Record<string, PreviewCheck>;
  approvals?: ActiveGraphApproval[];
  /** How long ago the last send went out, worked out on the server (FB-241). */
  lastSendAgeMs?: number | null;
  budgets?: (BudgetDisclosure | null)[];
  /** Finished work waiting to be read, newest-waiting first — the desk's section 7 (FB-128). */
  openWorkQueue?: PrApproval[];
  /**
   * The factory's cards waiting on this viewer, as rows (FB-277). Built on the server, which is
   * where a founder's rows lose John's words. Pull requests a card stands for are already gone from
   * `openWorkQueue`, so one piece of work is one row.
   */
  cardItems?: WaitingItem[];
  /** The line saying the factory has gone quiet, so its cards may be out of date (FB-278). */
  cardsQuiet?: string | null;
  /** The venture in a paragraph (FB-042) — composed server-side so the ordering has one owner. */
  brief?: Brief | null;
  /** The desk's one sentence (FB-128). Composed server-side from the same count the banner uses. */
  summary?: string | null;
  /** The amber banner's line, or null when nothing waits. Never assembled here — see `lib/desk.ts`. */
  blocker?: string | null;
  /** What could not be read, grouped by cause (FB-128). Empty when every read succeeded. */
  degraded?: DegradedGroup[];
  /**
   * `?full=1` — the whole desk on a phone (FB-160).
   *
   * The pocket studio is the desk with the sections the design does not put on a phone stood down.
   * This is the way to all of it, for a founder who wants the surfaces or the run reports while they
   * are out. Nothing about a wide screen changes.
   */
  full?: boolean;
  /**
   * The studio's own path to this venture's office, with a short-lived token naming the venture
   * (FB-163). Null when the venture has no box, which is most of them — then the plate stands alone.
   *
   * Minted on the server after the venture check, so the token is a statement the studio is entitled
   * to make. It carries nothing about the box.
   */
  officeSrc?: string | null;
  /** The office's live socket on the venture's box, for the desk's own check (FB-198). */
  officeSocket?: string | null;
  /** What the agent lanes did, newest first (FB-042). */
  /** Each with its age worked out on the server (FB-241): this component renders in the browser. */
  runs?: AgedRun[];
  runsTotal?: number;
  /** `ageMinutes` since FB-098: a card can only say "picked up 12 minutes ago; last checked in 2
   *  minutes ago" if the real check-in travels with the state. */
  engine?: { state: string; text: string; ageMinutes: number | null } | null;
  /**
   * The office, built server-side (FB-139).
   *
   * One array, mapped twice — into the plate and into the ledger — so the design's constraint ("same
   * events, so they cannot disagree") holds because there is nothing to disagree with.
   */
  office: Office;
  /** Non-null when the venture's budgets file exists but could not be read (FB-054). */
  budgetsError?: string | null;
  /** Envelopes keyed to departments this venture does not declare — configured but enforcing nothing. */
  orphanEnvelopes?: string[];
  staleRepos?: string[];
  totalWarnings: number;
  /** How old the data on this page is, worked out on the server (FB-241). */
  fetchedAgeMs: number;
  org: string;
  /**
   * The work waiting on each ticket, keyed `"<repo> <id>"` — the same key the status inference uses
   * (FB-105). So the drawer's Accept button and the column the card sits in are the same fact.
   */
  openWork?: Record<string, { repo: string; number: number }>;
  /** Where a filed ticket lives, keyed `<repo> <ticketId>` — its own branch, not the default
   *  one. The drawer builds a GitHub link from the ref it is given, and the default branch is
   *  the one branch a filed ticket is provably not on (FB-120). */
  filedRefs?: Record<string, { branch: string; prNumber: number; prUrl: string }>;
  /**
   * Open work this venture has that matches no ticket, by repo (FB-099).
   *
   * It has to appear SOMEWHERE. The badge counts every open piece of work; the columns counted
   * tickets. Anything the matcher cannot place used to fall between the two, which is how "Needs
   * you — 15" sat six centimetres from a column reading 0.
   */
  unmatchedWork?: Record<string, Array<{ number: number; title: string }>>;
  /** True when the person reading this IS the venture's named founder (FB-100's item 7). */
  viewerIsFounder?: boolean;
  /** FB-087: admin-only — this venture has a box the studio cannot reach. Null for founders. */
  wiringWarning?: string | null;
}) {
  /**
   * Every external action that still needs this founder (FB-207).
   *
   * Three states, one queue. `proposed` is waiting for a yes. `failed` was approved, the executor
   * tried, and it did not go — nobody but the founder decides what happens next. `unverified-action`
   * is a grant record the studio did not issue, which is an incident rather than a queue item and
   * carries its own alarm on the row.
   *
   * The last two were the desk's `approvals-attention` section, below the queue. The design's rule
   * is one queue because a founder has one queue, and a send that failed is more urgent than most of
   * what was above it — so a separate block underneath was the wrong shape twice over.
   */
  // FB-149: the same predicate the rail's badge, the desk's sentence and Tickets all ask.
  const pendingApprovals = sendsWaitingOnFounder(approvals);
  // FB-142: the venture's own Workspace sent view, for the Sell surface's reference link.
  const outbox = outboxUrl(venture.founderEmail ?? null);
  // FB-109: which surface the founder is looking at, if any. Deliberately not routed and not
  // persisted — a filter that survives reload is navigation, and navigation is a bigger decision
  // than this ticket makes.
  const [surface, setSurface] = useState<string | null>(null);
  const stale = new Set(staleRepos);

  // The board showed the same three-way split twice and never joined them: cards named Build / Sell
  // / Scale, and lanes headed `arca`, `arca-marketing`, `arca-ops`. The mapping was in the manifest
  // the whole time and the studio kept it to itself.
  const surfaceOf = (repo: string) => departments.find((d) => d.repo === repo) ?? null;
  const selectedRepo = surface ? (departments.find((d) => d.id === surface)?.repo ?? null) : null;
  /** The queue behind a surface, when the venture has one for that repository. */
  const laneOf = (repo: string | null | undefined) => (repo ? lanes.find((l) => l.repo === repo) ?? null : null);
  /**
   * A queue no surface claims (FB-186).
   *
   * `departments` is optional in the manifest, so a venture can have a repository with a lane and no
   * surface named over it. Folding the queues into the surface cards would have made those
   * disappear, which is the failure mode this whole run of tickets keeps finding: a screen that is
   * correct about everything it shows and silent about what it dropped.
   */
  const orphanLanes = lanes.filter((l) => !departments.some((d) => d.repo === l.repo));

  /**
   * One queue, because a founder has one queue (FB-183).
   *
   * Pull requests waiting on the founder and external sends waiting on the founder are the same
   * question — "what is blocked on me?" — and were two lists on one screen, the second of them 282px
   * of card per item. The design has one, and the send is told apart from the work by its own meta
   * line saying `external send`, not by living somewhere else.
   *
   * Sends first: nothing leaves the company without one of these, and the pull requests behind them
   * are internal.
   */
  const waitingItems = [
    // FB-149: a send names its own department; the repository it was proposed from is only a fallback.
    ...pendingApprovals.map((a) => externalWaitingItem(a, venture.id, sendSurface(departments, a))),
    // FB-277: the factory's cards, after the sends and before the work read from GitHub. They are
    // the newest finished work, and the design's queue is made of them.
    ...cardItems,
    ...openWorkQueue.map((a) => prWaitingItem(a, venture.id, surfaceOf(a.repo)?.name)),
  ];

  // Index every ticket by id so dependency chips in the drawer can jump to another ticket.

  // FB-098's live board, affordable since FB-083: poll only while a run is genuinely in flight. The
  // same evidence the cards read from — a run with no outcome yet — so the page cannot poll over
  // work that is not happening.
  const somethingInFlight = runs.some((r) => r.outcome === null);

  // FB-203, item 5. The brief's blocked lines — a stuck ticket, a stalled engine — outlive the box
  // they were in, because no other surface on the desk or the phone names them.
  const stopped = (brief?.lines ?? []).filter((l) => l.tone === 'blocked');

  return (
    // `desk` is what the phone media query reorders (FB-138). See `app/globals.css`.
    <section className={full ? 'desk desk-full' : 'desk'} data-testid="desk" data-pocket={full ? 'full' : 'pocket'}>
      <WhileWorking working={somethingInFlight} />
      {/* FB-160: the venture's name comes FIRST on a phone, not after the prompt bar.
          Everything the pocket order does not name falls to `order: 5`, and that included the title
          — so a founder scrolled the whole screen before being told which venture they were looking
          at. The design's phone leads with the wordmark and the venture. */}
      {/* FB-160: the venture's name comes FIRST on a phone, not after the prompt bar.
          Everything the pocket order does not name falls to `order: 5`, and that included the title
          — so a founder scrolled the whole screen before being told which venture they were looking
          at. The design's phone leads with the wordmark and the venture.

          FB-203, item 2: the name moved into this line and the heading became "The desk". The page
          used to be headed ARCA, which is the one fact a founder already knows — they chose the
          venture to get here, and the rail says it. The heading now names the room they are in,
          which is the thing that changes as they move around the studio. The venture, what it is,
          and how it is doing all sit above it in three words. */}
      <p className="eyebrow pocket-0">
        <span className="eyebrow-id">{venture.id}</span> · Venture · {venture.status}
      </p>
      <div className="desk-head pocket-0">
        <h1>The desk</h1>
        <p className="muted not-in-pocket" data-testid="board-founder" style={{ fontSize: 'var(--fs-body-sm)', margin: 0 }}>
          {/* FB-100's item 7: "Founder: John Gallagher" while signed in AS the founder reads as the
              studio introducing someone to themselves. The manifest is right; this is presentation. */}
          {venture.founderName ? <>Founder: {viewerIsFounder ? 'you' : venture.founderName} · </> : null}
          {/* FB-068: "3:05:32 PM" was a clock reading, not an answer to "is this current?". */}
          <span>updated {agoMs(fetchedAgeMs) ?? 'just now'}</span> ·{' '}
          <Link href={`/venture/${venture.id}?refresh=1`} className="mono" data-testid="refresh">
            refresh
          </Link>
        </p>
        {/* FB-068: a badge that cannot be interrogated trains people to ignore badges. It says what
            it means, in words, and is reachable by keyboard rather than by hover alone.

            FB-203 deleted the ACTIVE pill beside it — the status is in the eyebrow now, and a pill
            that says the same word twice teaches a founder that pills carry no information. This one
            stayed, because it only appears when something is actually wrong. */}
        {totalWarnings > 0 ? (
          <span
            className="tag"
            data-testid="warnings-badge"
            tabIndex={0}
            title={`${totalWarnings} ticket${totalWarnings === 1 ? '' : 's'} could not be read completely — some detail is missing from the board, and nothing is lost from your venture’s records.`}
          >
            <Mark />
            {totalWarnings} ticket{totalWarnings === 1 ? '' : 's'} not fully read
          </span>
        ) : null}
      </div>

      {/* ---- 1. The sentence (FB-128) ------------------------------------------------------------
          Where things stand, in one line, before anything else. Composed server-side from the same
          count the banner and the rail's badge read, so the three cannot disagree. */}
      {summary ? <DeskSummary sentence={summary} /> : null}

      {/* ---- 2. The blocker banner --------------------------------------------------------------
          The founder named as the blocker, in those words. "3 items awaiting review" is a status;
          this is the same fact addressed to the one person who can end it. */}
      <div className="pocket-1">
        <BlockerBanner line={blocker} href={`/venture/${venture.id}#waiting-on-you`} />
      </div>

      {/* FB-203, item 5: the "Where things stand" box is gone. Its lines repeated the summary
          sentence above and the banner beside it — the same three facts read three ways, which is
          not emphasis on the one screen a founder leaves open.

          Its blocked lines stayed, in the banner's own shape. Those are the ones nothing else says:
          a ticket the team could not finish, an engine that has stalled. Amber like the banner, not
          red — item 5 is explicit that the design has no red, and the complaint it makes about the
          box these lines came from is that its red was the loudest thing on the screen. */}
      <div className="pocket-1b">
        {stopped.map((line, i) => (
          <Link key={i} className="blocker" data-testid="desk-stuck" href={line.href ?? '#activity'}>
            <span className="blocker-marker" aria-hidden="true" />
            <span className="blocker-line">{line.text}</span>
            <span className="blocker-decide">Look →</span>
          </Link>
        ))}
      </div>

      {/* FB-087. The composer was broken in production for weeks and the only way anyone could find
          out was a founder pressing the button and getting an error. This is the same fact, told to
          the person who can fix it, before that happens. */}
      {wiringWarning ? (
        <p className="card" data-testid="wiring-warning"
           style={{ borderColor: toneColor('blocked'), color: toneColor('blocked'), fontSize: 'var(--fs-body-sm)' }}>
          {wiringWarning}
        </p>
      ) : null}

      {/* ---- 3. What could not be read ----------------------------------------------------------
          BELOW the banner and the brief, deliberately. It reports a condition that clears on its
          own, and a thing that fixes itself must never sit above a thing that does not. */}
      <DegradedStrip groups={degraded} ventureId={venture.id} />

      {/* ---- 4. The prompt bar -------------------------------------------------------------------
          The most important thing a founder does, started from the screen they leave open rather
          than from behind a link. It files nothing: it carries the words to the composer, whose own
          gate is still the only thing that turns them into work. */}
      <div className="pocket-4">
        <PromptBar ventureId={venture.id} ventureName={venture.name} />
      </div>
      {/* Conversational composer entry (FB-025 → in-studio FB-065 → out to the box FB-086 → home
          again FB-102). The full story, because this button has now moved three times and the next
          person deserves the dates: FB-065 put it in-studio (no founder should leave for a
          different-looking product with no way back). FB-086 sent it back out because the in-studio
          route had never worked in production — the key was never set (FB-087) — and a working
          screen beats a well-argued broken one. FB-095 fixed the engine and proved the in-studio
          surface end to end against the live box, at which point the external door's own cost was
          exposed: a second application with a second login guarding the most important button in
          the product (John hit exactly that). FB-086 said "the board is one line away from
          pointing back"; FB-102 is that line. The box's chat stays available below as the
          secondary surface, for whoever wants the full LibreChat screen. */}
      {/* FB-128: no longer a primary button. The prompt bar directly above IS this door, with the
          founder's first sentence already in it — two controls one line apart, both reading "tell
          the studio what you want", is the doubled navigation FB-124 shipped in a different coat.
          The link stays because the composer is a place as well as a box, and because
          `venture-composer-link` is how the board is known to reach it. */}
      <p style={{ fontSize: 'var(--fs-meta-lg)', margin: '0.4rem 0 0' }}>
        <Link href={`/venture/${venture.id}/composer`} data-testid="venture-composer-link">
          Open the whole conversation
        </Link>
      </p>
      {/* FB-203, item 6. Four links used to hang under the prompt bar with nothing tying them
          together: the composer, Memory, routines, and the box's own chat. Three of them are gone
          from here, and none of them lost a way in:

            - **Memory** is a rail item on every screen (`RailNav.tsx`). A link on the desk to a
              place the navigation already goes is the doubled navigation FB-124 shipped.
            - **Routines** is reached from Memory — `memory-routines-link`, "Change these →", beside
              the routines themselves. FB-047 put it on the desk because the page had no door at
              all; it has one now, next to the thing it changes.
            - **The box's own chat** is gone, and nothing was lost with it. It pointed at
              `chat.<box host>` — the same address the in-studio composer already talks to. Both are
              built from the venture's `vps.host`, so there is no state where the external door
              works and the composer does not: if the box is there both work, and if it is not then
              neither does. It was the same conversation in a second application behind a second
              login, which is exactly what FB-065 brought inside the studio. `composer.spec.ts` has
              forbidden that link on the composer page ever since; the desk was where it survived.

          What is left is the one link that says something the prompt bar does not — that the
          composer is a place, with everything already said in it, and not only a box. */}
      {/* ---- 5. The office, and the ledger beside it -------------------------------------------
          FB-139's plate is a drawing and says so in its own header. FB-163 puts the real thing in
          front of it where a venture has one: pixel-agents on the venture's own machine, proxied by
          the studio so no address or credential of the box reaches the browser.
          The plate is the fallback, not a second office — it is passed in, rendered once, and shown
          whenever the embed cannot be. A frozen last-known scene would read as a team sitting
          still.

          FB-203, item 7 pairs the two halves in one row, which is the design's whole argument for
          this section: *the office is the feeling; this ledger is the record.* They ran one under
          the other before, so a founder read the room, scrolled past a caption, and met the same
          three surfaces again with nothing saying the second was an account of the first.

          The ledger also used to live inside the plate — the fallback — so on any venture whose real
          office loaded it was not rendered at all. The half a screen-reader user gets was the half
          that disappeared when the venture was healthiest. */}
      <section className="office-section pocket-2" data-testid="office-section">
        <div className="office-head">
          <h2>The office</h2>
        </div>
        {/* The design puts "LIVE FROM ARCA'S MACHINE" on this heading row. It is drawn one line
            lower, inside the room itself, and that is not a compromise — it is the only place that
            knows whether a founder is looking at the real room.

            Put here it read as a caption on the section, and the section renders the *stand-in* when
            the embed cannot load. So the first version of this printed "Live from your venture's own
            machine" directly above a drawing whose own note says "This is a stand-in". A label that
            can be wrong about the thing beneath it is worse than no label. `office.live` is a fact
            about the box reporting run reports, which is a different question from whether the room
            is on the screen, and `OfficeEmbed` is the only component that knows the second. */}
        <div className="office-pair">
          <div className="office-pair-view">
            {officeSrc && officeSocket ? (
              <OfficeEmbed
                src={officeSrc}
                socket={officeSocket}
                fallback={<OfficePlate office={office} />}
              />
            ) : (
              <OfficePlate office={office} />
            )}
          </div>
          <div className="office-pair-ledger not-in-pocket">
            <OfficeLedger office={office} ventureId={venture.id} />
          </div>
        </div>
      </section>

      {/* ---- 6. What the engine did --------------------------------------------------------------
          FB-203, item 9: its own section under a rule, rather than the second half of the card list
          the ledger above used to be. It answers a different question — the ledger says what each
          surface is doing now, this says what the engine has done — and production collapsed both
          into one place where neither was legible.

          FB-160: not on a phone. The design's pocket studio is the blocker banner, the office, the
          queue and the prompt. What your team has been doing is a record, and a record is what
          "What happened" is for. Stood down rather than removed: `?full=1` shows it. */}
      {engine ? (
        <div className="not-in-pocket">
          <EngineActivity reports={runs} total={runsTotal} engine={engine} hasComposer={venture.hasComposer} ventureId={venture.id} />
        </div>
      ) : null}
      {/* ---- 7. Waiting on you -------------------------------------------------------------------
          Where "Decide now →" lands, so it has to hold the work the banner just counted. The
          external-approval cards alone were not that: on a venture whose waiting items are all open
          pull requests — the common case — the anchor sat above three empty sections and a founder
          was scrolled past the office to nothing. */}
      <section id="waiting-on-you" data-testid="waiting-on-you" className="pocket-3" style={{ marginTop: '1.5rem' }}>
        {/* FB-203, item 10: a serif heading, not a small uppercase label. The design reserves those
            for column heads and eyebrows, and this is a section of the page — the same size and
            weight as "The office" and "What your team did" above it.

            The link beside it goes to Needs you rather than to all tickets, because that screen
            counts exactly what this list counts (FB-149) and "all tickets" would send a founder
            somewhere with a different number on it. */}
        <div className="queue-head">
          <h2>Waiting on you</h2>
          <Link className="queue-all" href={`/venture/${venture.id}/tickets?filter=needs`} data-testid="waiting-all">
            everything waiting →
          </Link>
        </div>
        <FactoryQuiet line={cardItems.length ? cardsQuiet : null} testId="waiting-cards-quiet" />
        <WaitingQueue items={waitingItems} ventureId={venture.id} />
      </section>
      {/* FB-183: the external-send cards that used to stand here are rows in "Waiting on you" above,
          and the decision is made on the page each row opens.
          Claude Design's rule is "one decision surface, everywhere else is a pointer to it", and
          this section was 282px of card per send on a page that should be about 1,900px in total.
          It could not become rows until there was somewhere for the rows to point, because
          `ApprovalCard` carried the only approve control in the studio — turning it into a row first
          would have deleted the only way a founder can approve anything leaving their company
          (non-negotiable 4). The page came first; this section went second.
          The desk cannot sign now, and the reason is stronger than it used to be: this file renders
          NO `ApprovalCard` at all. An earlier version of this comment said "every `ApprovalCard` below
          renders read-only, because `decide` defaults to false" -- true when written, stale once the
          last one went, and it made a test that looped over those elements pass by looping over
          nothing (FB-183, corrected 2026-09-29). `lib/__tests__/one-signing-surface.test.ts` now
          asserts the absence directly. */}

      {/* FB-207: "Decided — what happened next" and "Went out, or tried to — needs your eye" stood
          here, and both are gone.

          They stayed through two earlier instructions to move them, for a reason this file recorded
          at the time and which was right: *"It is not only a record. It is the only place a founder
          can see whether a COMPLETED approval's signature was genuine … Removing this section would
          make a forged grant on a past send invisible, which is non-negotiable 4 — a recorded,
          VERIFIABLE human approval — failing quietly."*

          The second design review said the same thing from the other side — *"nothing on the row
          says whether the signature verified; this is what kept R-01 on the desk"* — and that is what
          made the pair one ticket. What happened carries the attestation now (`lib/activity-feed.ts`,
          `components/ActivityFeed.tsx`): every decision row states whether the studio issued that
          approval, in words and in colour, and links to the page where the three reasons a signature
          does not verify are told apart.

          So the property moved before the section did, and nothing about a completed approval is now
          less visible than it was — it is on the screen whose job is the record, rather than on the
          one whose job is what happens next.

          The two states that are NOT a record went the other way: a send that failed and a grant
          nobody can verify are things waiting on the founder, so they are rows in the queue above,
          with the meta line saying which. */}

      {/* ---- 8. The company, by surface ----------------------------------------------------------
          The three founder-owned surfaces (FB-048): Build / Sell / Scale. Each is its own queue with
          its own approval gate — so product-building, selling, and scaling are managed separately.

          FB-203, item 11: three columns divided by rules, not three bordered cards. Each is a label,
          one line, and the links that go somewhere. What went, and why each was safe to lose:

            - **The ACTIVE pill.** Three pills all saying "active" on a venture whose eyebrow already
              says ACTIVE. "Coming" was the only one carrying anything, and the line says it now.
            - **"Limit set in the studio; spend as reported by the venture."** Printed three times,
              once per surface, as provenance for a figure that lives in the rail.
            - **The budget line.** The rail carries every venture's budgets on every screen, and
              colours an over-limit one red. Stating them again per column was the desk answering a
              question the rail had already answered.
            - **The gate sentence.** "Work here is approved by review" is policy, not state, and the
              handbook is where policy belongs. The one variant that is not policy — *nothing goes
              out while the gate is undecided* — is kept, because that one is a caution.
            - **The outlined Open button**, which was the most button-shaped thing on the page, and
              **"Nowhere to open yet…"**, which was a paragraph standing in for a link.

          What stayed, against the design, and why:

            - **The stale flag.** The design calls it noise. It is the only place in the studio that
              says a surface has gone quiet for a fortnight — `e2e/activity.spec.ts` and
              `e2e/attention.spec.ts` both reach for it on the desk because there is nowhere else. The
              badge went; the fact is a clause on the one line, still interrogable by keyboard
              (FB-068).
            - **The read-failure and empty panels.** Neither is in the design because the design has
              no failing venture in it. A read that failed is not an empty queue and an empty queue
              is not a queue with work in it (non-negotiable 10). They only render in those states,
              so an ordinary column is a label, a line and two links. */}
      {departments.length > 0 ? (
        <div className="not-in-pocket" data-testid="dept-surfaces" style={{ marginTop: '2.25rem' }}>
          <div className="queue-head">
            <h2>The company, by surface</h2>
          </div>
          <div className="surfaces">
            {departments.map((d) => {
              const laneStale = stale.has(d.repo ?? '');
              const budget = budgets[departments.indexOf(d)] ?? null;
              // FB-184: what opening this surface's door found. A link only when it opened.
              const door = d.provisioned && d.launch ? offerFor(doors[d.id]) : null;
              return (
              <div key={d.id} className="surface-col" data-testid={`dept-${d.id}`}>
                <div
                  id={`lane-${d.repo}`}
                  data-testid={`lane-${d.repo}`}
                  data-quiet={selectedRepo && selectedRepo !== d.repo ? 'true' : 'false'}
                  style={{
                    opacity: selectedRepo && selectedRepo !== d.repo ? 0.45 : 1,
                    transition: 'opacity var(--dur) var(--ease)',
                  }}
                >
                <p className="surface-label">
                  {/* A real button, not a card-shaped div: the audit found the surface cards were the
                      most button-shaped objects on the page and the only ones that did nothing. The
                      NAME is the control rather than the whole column, because the column also holds
                      links and a link inside a button is neither. */}
                  {d.repo && lanes.some((l) => l.repo === d.repo) ? (
                    <button
                      type="button"
                      data-testid={`dept-${d.id}-select`}
                      aria-pressed={surface === d.id}
                      aria-controls={`lane-${d.repo}`}
                      onClick={() => {
                        const next = surface === d.id ? null : d.id;
                        setSurface(next);
                        if (next && d.repo) {
                          document.getElementById(`lane-${d.repo}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                      }}
                    >
                      {d.name}
                    </button>
                  ) : (
                    d.name
                  )}
                </p>

                {/* The one line. What this surface has actually produced — the only place a founder
                    learns whether any of it worked. Sourced or silent
                    (docs/decision-surface-outcomes.md): Build's line is true today, Sell has no
                    reporting until FB-142 and says so, and Scale is not connected and says that too.
                    No zero standing in for an unknown. */}
                <p className="surface-line" data-testid={`dept-${d.id}-outcome`}>
                  {d.provisioned ? (
                    <>
                      {surfaceOutcome({
                        departmentId: d.id,
                        ticketCount: lanes.find((l) => l.repo === d.repo)?.total ?? 0,
                        // FB-184: "running" only when the door was opened and it worked.
                        hasLaunch: door?.kind === 'link',
                        provisioned: d.provisioned,
                        // FB-142: from the sends this venture has already gated. No new read.
                        lastSend: d.id === 'sell' ? lastSend(approvals) : null,
                        lastSendAgeMs,
                        connectors: d.connectors,
                      })}
                      {/* Policy belongs in the handbook; this one is not policy, it is a caution
                          that nothing can leave the company while the gate is unsettled. */}
                      {d.gate === 'tbd-fb012' ? <> {GATE_UNDECIDED}</> : null}
                      {/* FB-068: a badge that cannot be interrogated trains people to ignore badges.
                          It is a clause now rather than a tag, and it still says what it means and is
                          still reachable by keyboard.
                          Last in the line, because it is the one amber thing in it — amber in the
                          middle of a sentence reads as a link rather than as a warning. */}
                      {laneStale ? (
                        <>
                          {' '}
                          <span
                            data-testid={`lane-stale-${d.repo}`}
                            tabIndex={0}
                            title="Nothing has been built or changed here for over two weeks. That may be fine — it is only worth a look if you expected something to be happening."
                            style={{ color: toneColor('attention') }}
                          >
                            Nothing here for over two weeks.
                          </span>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>Not open yet. Bruntsfield sets this side of the venture up when you need it.</>
                  )}
                </p>

                {/* Money, and only when it is a problem (FB-203, item 11).
                    The design's argument is that budgets already live in the rail, which carries
                    every surface's figure on every screen — so restating three of them here was the
                    desk answering a question that was already answered, three times, with the same
                    provenance sentence under each.
                    A surface OVER its limit is not that. The rail can colour the figure red; it
                    cannot say 192% of the limit, or that £5,200 of it is still awaiting a founder's
                    OK, or where either number came from. FB-054's reasoning is unchanged and is why
                    the provenance travels with the sentence: the studio owns the limit and does not
                    own the spend, and dressing an unverifiable figure as a verdict is what three
                    review passes punished. */}
                {budget?.overLimit ? (
                  <p
                    data-testid={`dept-${d.id}-budget`}
                    data-budget-over="true"
                    // FB-211: attention, not blocked. Over budget is a decision waiting on a
                    // founder — the same class as the amber banner at the top of this page — and
                    // red is for a fault nobody on the venture can clear. Spending the alarm colour
                    // on a routine state is how a founder learns to stop seeing it.
                    style={{ fontSize: 'var(--fs-meta-lg)', margin: '0 0 0.5rem', color: toneColor('attention'), fontWeight: 600 }}
                  >
                    {describeBudget(budget, d.name)}{' '}
                    <span className="muted" style={{ fontWeight: 400 }}>
                      Limit set in the studio; spend as reported by the venture.
                    </span>
                  </p>
                ) : null}

                {/* The links, underlined, and only the ones that go somewhere. */}
                <p className="surface-links">
                  {/* FB-093: the door to the thing this surface is building. The target comes from
                      the manifest (`launch:` — venture-as-config, never hard-coded here); a new tab
                      for the same reason as the chat button: it is a different application, and
                      replacing the board with it is the "no way back" problem FB-065 named.
                      A surface with nothing running gets no link, rather than a paragraph
                      apologising for the absence of one. */}
                  {/* FB-184: opened by the studio before it is offered. A door that does not open
                      says so, quietly, rather than being a link that lands on an error page. */}
                  {door?.kind === 'link' ? (
                    <a
                      href={door.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid={`dept-${d.id}-launch`}
                    >
                      {d.launch?.label ?? 'Open'} ↗
                    </a>
                  ) : door?.kind === 'why' ? (
                    <span className="muted" data-testid={`dept-${d.id}-launch-why`}>
                      {d.launch?.label ?? 'Open'}: {door.text}.
                    </span>
                  ) : null}
                  {/* The design's "Open your outbox ↗". The studio does not read the mailbox — see
                      lib/sends.ts on why that scope is not taken — so this is the one place a founder
                      can see the message itself. Absent without a workspace address, rather than a
                      link that lands on somebody's personal inbox. */}
                  {/* FB-235: the pipeline — who this venture is selling to and who needs the
                      founder now. Inside the studio, so the same tab. */}
                  {d.id === 'sell' && d.provisioned ? (
                    <Link href={`/venture/${venture.id}/sell`} data-testid="sell-pipeline-link">
                      your pipeline →
                    </Link>
                  ) : null}
                  {d.id === 'sell' && outbox ? (
                    <a href={outbox} target="_blank" rel="noopener noreferrer" data-testid="sell-outbox">
                      Open your outbox ↗
                    </a>
                  ) : null}
                  {/* FB-248: the surface's ads, read-only. Only where the venture's setup declares
                      Meta for this surface — venture-as-config, never keyed on the id `scale`. It
                      opens even before the surface is set up: the page's first line says plainly that
                      nothing is connected, which is the answer a founder pressing it needs. */}
                  {d.connectors.includes(META_ADS_CONNECTOR) ? (
                    <Link href={`/venture/${venture.id}/ads`} data-testid={`dept-${d.id}-ads`}>
                      your ads on Meta →
                    </Link>
                  ) : null}
                  {/* FB-213: to THIS surface's queue. All three of these linked `/tickets` with no
                      filter, so Build, Sell and Scale landed on the same screen and a founder
                      pressing Sell's got Build's work — a control the studio drew, promising
                      something it did not do. The department's own id is what goes in the URL,
                      because it is the name the founder just pressed. */}
                  {laneOf(d.repo) && !laneOf(d.repo)?.error && laneOf(d.repo)!.total > 0 ? (
                    <Link href={`/venture/${venture.id}/tickets?surface=${encodeURIComponent(d.id)}`}
                          data-testid={`lane-open-${d.repo}`}>
                      open the queue →
                    </Link>
                  ) : null}
                </p>

                {/* Order matters: a read that FAILED is not an empty queue, and an empty queue is not
                    a queue with work in it (non-negotiable 10). */}
                {laneOf(d.repo)?.error ? (
                  <p
                    data-testid="lane-error"
                    data-error-kind={laneOf(d.repo)?.errorKind ?? 'error'}
                    style={{
                      fontSize: 'var(--fs-meta-lg)',
                      marginTop: '0.5rem',
                      color: toneColor(laneErrorTone(laneOf(d.repo)?.errorKind ?? null)),
                    }}
                  >
                    {laneOf(d.repo)?.error}
                    {laneErrorNextStep(laneOf(d.repo)?.errorKind ?? null) ? (
                      <span className="muted" data-testid="lane-error-next" style={{ display: 'block', marginTop: '0.35rem' }}>
                        <strong>Next step:</strong> {laneErrorNextStep(laneOf(d.repo)?.errorKind ?? null)}
                      </span>
                    ) : null}
                  </p>
                ) : !laneOf(d.repo) ? null : laneOf(d.repo)!.total === 0 ? (
                  /* FB-066: what would fill this, then how it starts. "No tickets yet" is true and
                     useless — a founder cannot tell from it whether they are waiting, whether
                     something broke, or whether they were meant to do something first.
                     Keyed on the repository, like every other id on this screen (FB-058).

                     FB-203, item 11 dropped the "what" half. `surfaceOutcome` above already opens
                     with "No tickets yet" for exactly this surface, so the panel was answering a
                     question the line had just answered, in more general words — which is how
                     Scale's column came to hold five sentences under a design asking for one.
                     The "how" is the half that is not a restatement: it says what starts it. */
                  <p className="muted" data-testid={`lane-empty-${d.repo}`} style={{ fontSize: 'var(--fs-meta-lg)', marginTop: '0.4rem' }}>
                    {emptyPanel('tickets', venture.hasComposer).how}
                  </p>
                ) : null}
                </div>
              </div>
              );
            })}
          </div>
          {budgetsError ? (
            <p data-testid="budgets-error" style={{ color: toneColor('blocked'), fontSize: 'var(--fs-body-sm)', marginTop: '0.9rem' }}>
              <Mark />{budgets.some(Boolean)
                ? <>Part of your budgets file was rejected, so those departments have no limit while the rest still report normally: {budgetsError}.</>
                : <>Your budgets file couldn&rsquo;t be read, so no limits are set: {budgetsError}.</>}
            </p>
          ) : null}
          {orphanEnvelopes.length > 0 ? (
            <p className="muted" data-testid="budgets-orphans" style={{ fontSize: 'var(--fs-body-sm)', marginTop: '0.6rem' }}>
              <Mark />Budget{orphanEnvelopes.length === 1 ? '' : 's'} set for{' '}
              <span className="mono">{orphanEnvelopes.join(', ')}</span>, which {orphanEnvelopes.length === 1 ? 'is not a department' : 'are not departments'} of this
              venture — so {orphanEnvelopes.length === 1 ? 'it is' : 'they are'} enforcing nothing. Check the spelling against your surfaces above.
            </p>
          ) : null}
        </div>
      ) : null}
      {/* FB-186: the second list of surfaces that stood here is gone.
          It repeated the three names, the three repositories and the three ticket counts already on
          the cards above, in different words — 139px of restatement plus its rule and its margins,
          on a desk that is meant to be a page a founder reads rather than one they scroll. Every
          figure in it was correct, which is why no test caught it and only looking did.
          Nothing was dropped: the queue link, the stale flag, the read-failure panel and the empty
          panel all moved up into the surface each belongs to, keeping their own ids.
          A lane whose repository no department claims still renders, below. */}
      {orphanLanes.length > 0 ? (
        <div data-testid="lanes-unclaimed" style={{ marginTop: '1.25rem' }}>
          <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Other queues</p>
          {orphanLanes.map((lane) => (
            <p key={lane.repo} id={`lane-${lane.repo}`} data-testid={`lane-${lane.repo}`} style={{ fontSize: 'var(--fs-body-sm)', margin: '0 0 0.5rem' }}>
              <span className="mono muted" style={{ fontSize: 'var(--fs-meta)' }}>{lane.repo}</span>{' '}
              <span className="muted">{lane.total} ticket{lane.total === 1 ? '' : 's'}</span>
              {' — '}
              {/* No department claims this lane, so it has no founder-facing name to put in the
                  URL — its repository is the only thing that identifies it. `resolveSurface`
                  accepts either, which is what keeps this one mechanism (FB-213). */}
              <Link href={`/venture/${venture.id}/tickets?surface=${encodeURIComponent(lane.repo)}`}
                    data-testid={`lane-open-${lane.repo}`}>
                open the queue
              </Link>
            </p>
          ))}
        </div>
      ) : null}

      {/* FB-160: the way to the rest of the desk, and back.
          A link and a query, not client state, so the choice survives a reload and can be sent to
          somebody. One element, rendered once, whichever mode the desk is in — a phone-only second
          copy of anything is how the rail's waiting shell and the ledger's fallback table each
          shipped a duplicate test id (FB-158, FB-136). */}
      <p className="pocket-more" style={{ fontSize: 'var(--fs-body-sm)', marginTop: '1.5rem' }}>
        {full ? (
          <Link href={`/venture/${venture.id}`} data-testid="pocket-less">← Back to the pocket studio</Link>
        ) : (
          <Link href={`/venture/${venture.id}?full=1`} data-testid="pocket-more">
            See the whole desk — your surfaces, and what your team has been doing →
          </Link>
        )}
      </p>

      {/* The ticket drawer that stood here is gone (FB-178).
          Nothing could open it once the desk's board went — `setSelected` was only ever called by a
          ticket card — and an unreachable control is worse than none. It had already been superseded:
          `TicketsView`'s own header reads "The list, the ticket and the decision are one screen.
          Before this the drawer showed a ticket…", and that screen carries the accept, the
          send-back, the dependency chips and the trail. */}
    </section>
  );
}
