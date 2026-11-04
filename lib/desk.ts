/**
 * The desk's own sentences (FB-128).
 *
 * ## Why these are here rather than in the component
 *
 * Three surfaces state the same fact about how much waits on a founder: the summary sentence at the
 * top of the desk, the amber blocker banner under it, and the rail's "Needs you" badge on every
 * screen. Three renderings of one number is how a badge comes to say 15 while every column says 0 —
 * which is not hypothetical, it is FB-099.
 *
 * So the count is computed once, here, and the sentences are built from it. The desk imports these
 * and so does `lib/rail.ts`.
 *
 * ## What they will not say
 *
 * Anything the studio cannot see. The design's summary opens with a clause about what the venture is
 * for; no manifest carries one, so the sentence starts at the facts instead of inventing a purpose.
 * The same rule the surface outcomes follow (`docs/decision-surface-outcomes.md`): render what
 * exists, invent nothing.
 */

import { formatMoney, periodLabel, type Period } from './budgets';
import { sellOutcome, type Send } from './sends';
import { META_ADS_CONNECTOR } from './meta-ads';

/** Finished work waiting to be read, plus external actions proposed and waiting on a human. */
export interface WaitingInput {
  /** Pull requests carrying finished work — the attention queue. */
  openWork: number;
  /** External sends waiting on the founder: an email, a post, a spend (lib/needs-you.ts). */
  awaitingApproval: number;
  /**
   * How many of those were already tried or carried out (failed, or done on an approval the studio
   * cannot verify). When it is above zero no sentence may call them actions that "would" go out.
   */
  sendsAlreadyTried?: number;
}

/**
 * How much waits on this founder — the one number.
 *
 * Both halves, because both are a decision only they can make. A badge that counted finished work
 * and quietly left out a proposed send would be telling a founder they were clear while something
 * external sat waiting for their word (CLAUDE.md #4).
 */
export const waitingOnFounder = (w: WaitingInput): number => w.openWork + w.awaitingApproval;

export interface DeskFacts extends WaitingInput {
  /** Tickets the engine has actually moved on — work in flight, not work filed. */
  movingTickets: number;
  /**
   * This period's committed spend and limit — summed ONLY across departments that agree on both
   * currency and period. Null when they do not, because there is no honest single figure then.
   */
  spentMinor: number | null;
  limitMinor: number | null;
  /** Spend proposed and awaiting this founder. Counted separately: it has not been spent. */
  queuedMinor: number | null;
  currency: string | null;
  /** The window those figures cover, so the sentence can name it instead of assuming a month. */
  period: Period | null;
  /**
   * What this venture IS, in one line from its manifest (FB-203 item 3).
   *
   * It opens the sentence, before any count. The design's argument: a founder should be reminded
   * what they are building before being told how much of it is waiting on them. Null when the
   * manifest does not say, and the sentence then begins at the counts rather than at a placeholder —
   * a description is a fact about the venture, and inventing one would be the studio telling a
   * founder what their company is.
   */
  description?: string | null;
  /** True when a read failed. The sentence says so rather than sounding calm over a partial picture. */
  degraded: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The one sentence at the top of the desk.
 *
 * Clauses only for the things that are true. A founder with nothing waiting, no work moving and no
 * budget set should read one short sentence, not three clauses of zeroes dressed as a report.
 */
export function deskSummary(f: DeskFacts): string {
  const clauses: string[] = [];

  const waiting = waitingOnFounder(f);
  clauses.push(waiting > 0 ? `${plural(waiting, 'decision')} ${waiting === 1 ? 'waits' : 'wait'} on you` : 'nothing waits on you');

  if (f.movingTickets > 0) {
    clauses.push(`your team is on ${plural(f.movingTickets, 'moving ticket')}`);
  }

  // Named by its actual window. `Period` is monthly, quarterly, yearly or all-time, and asserting
  // "this month" over a quarterly envelope is a false statement about a founder's own burn on the
  // lead sentence of the screen. `lib/budgets.ts` already refuses to add up mismatched currencies
  // per department; the caller applies the same rule before it gets here.
  if (f.spentMinor !== null && f.limitMinor !== null && f.currency && f.period && f.limitMinor > 0) {
    // `periodLabel` already reads "this month" / "this quarter"; only all-time needs its own words.
    const window = f.period === 'all-time' ? 'in total' : periodLabel(f.period);
    // Money awaiting the founder is named rather than left out (FB-152). Nothing has been *spent* —
    // that is what `reportedMinor` counts and the word is accurate — but the rail totals reported
    // and queued together, so a desk saying "£0 is spent" beside a rail reading "£5,200/£4,800" is
    // two numbers for one budget on one screen. Both true; only saying both makes them agree.
    //
    // Found against production data. The e2e fixtures have committed spend, so both surfaces agreed
    // there and no gate could see it.
    const waiting = f.queuedMinor && f.queuedMinor > 0
      ? `, with ${formatMoney(f.queuedMinor, f.currency)} awaiting your OK`
      : '';
    clauses.push(`${formatMoney(f.spentMinor, f.currency)} of ${formatMoney(f.limitMinor, f.currency)} is spent ${window}${waiting}`);
  }

  // Joined with a semicolon and a final "and", the way the design writes it — one sentence a founder
  // reads, not a list they scan.
  const body =
    clauses.length > 2
      ? `${clauses.slice(0, -1).join('; ')}, and ${clauses[clauses.length - 1]}`
      : clauses.join('; ');

  const counts = `${body.charAt(0).toUpperCase()}${body.slice(1)}.`;
  // The description first, then the counts, as one paragraph. Its own full stop is added only if it
  // is missing, so a manifest may write the line either way and neither ends up with two.
  const lead = f.description?.trim();
  const sentence = lead ? `${lead.replace(/[.\s]*$/, '')}. ${counts}` : counts;
  return f.degraded ? `${sentence} Some of this venture could not be read, so it may be incomplete.` : sentence;
}

/**
 * The amber banner, or nothing.
 *
 * It names the founder as the blocker in those words, deliberately. "3 items awaiting review" is a
 * status; "you are the blocker on 3 items" is the same fact addressed to the person who can end it,
 * and the age is what turns it from a number into a reason to act now.
 */
export function blockerLine(input: WaitingInput & {
  /**
   * How long the oldest piece of finished WORK has waited. There is no such figure for a proposed
   * external action: `committedAt` is the grant timestamp and a proposal has not been granted, so
   * the studio genuinely does not know when it was raised. Rather than quietly attribute a pull
   * request's age to a set that includes approvals, the sentence names what the age is of.
   */
  oldestMs: number | null;
}): string | null {
  const waiting = waitingOnFounder(input);
  if (waiting === 0) return null;

  // The breakdown, when there is one worth drawing. "8 items" tells a founder how much; "4 pieces of
  // finished work and 4 actions that would go outside the company" tells them what KIND, and the two
  // kinds want different things from them — one is a read, the other is a decision with a
  // consequence. This is the sentence the brief's headline used to carry; it belongs in the one
  // amber line rather than in a second block saying the same number a different way.
  const parts: string[] = [];
  if (input.openWork > 0) parts.push(`${plural(input.openWork, 'piece')} of finished work to read`);
  if (input.awaitingApproval > 0) {
    parts.push((input.sendsAlreadyTried ?? 0) > 0
      ? `${plural(input.awaitingApproval, 'decision')} about something leaving the company`
      : `${plural(input.awaitingApproval, 'action')} that would go outside the company`);
  }
  const kinds = parts.length > 1 ? ` — ${parts.join(' and ')}` : '';

  const head = `You are the blocker on ${plural(waiting, 'item')}${kinds}`;
  // "the oldest" only when the age covers everything counted; otherwise it says which oldest.
  const subject = input.awaitingApproval > 0 && input.openWork > 0 ? 'the oldest piece of work' : 'the oldest';
  const days = input.oldestMs === null ? null : Math.floor(input.oldestMs / 86_400_000);
  if (days === null) return `${head}.`;
  if (days < 1) {
    const hours = Math.floor((input.oldestMs ?? 0) / 3_600_000);
    return hours < 1
      ? `${head}; ${subject} arrived just now.`
      : `${head}; ${subject} has waited ${plural(hours, 'hour')}.`;
  }
  return `${head}; ${subject} has waited ${plural(days, 'day')}.`;
}

export interface ReadFailure {
  /** The part of the venture that could not be read, when it is known. */
  where: string | null;
  /** What the studio was told, already phrased for a founder by whichever loader failed. */
  message: string;
}

export interface DegradedGroup {
  /** What went wrong, as a founder would name it. */
  cause: string;
  /** Which parts of the venture it affected. Empty when nothing named one. */
  where: string[];
  /**
   * Whether it clears without anyone doing anything (FB-297). A busy GitHub does; a repository the
   * studio isn't allowed to read never does, and saying "it clears on its own" about that one
   * meant it stayed broken for weeks with the studio calling it nothing.
   */
  clears: boolean;
}

/**
 * Read failures, grouped by cause rather than listed one per repository.
 *
 * Five lines all saying "GitHub is rate-limiting reads" is five times the alarm for one fact, and it
 * buries the one line that is different. Grouping is what makes the strip readable enough to be
 * placed where it belongs — **below** everything the founder must act on, because a thing that fixes
 * itself must not sit above a thing that does not.
 *
 * Takes the repository as a field rather than reading it out of the message. The first version
 * pattern-matched a repo name from the end of the sentence, which is a guess about prose written
 * somewhere else — and it would have gone quietly wrong the first time a message ended in any other
 * hyphenated word.
 */
export function degradedGroups(failures: ReadFailure[]): DegradedGroup[] {
  const groups = new Map<string, { where: string[]; clears: boolean }>();
  for (const f of failures) {
    let message = f.message?.trim();
    let where = f.where;
    if (!message) continue;
    // FB-297: the open-work read says "arca: The studio could not read arca just now." about the
    // same fault the tickets read reported as "The studio could not read arca just now." Taken
    // apart, the two are one line, not two.
    const named = where ? null : message.match(/^([a-z0-9][a-z0-9._-]*): (.+)$/);
    if (named) [where, message] = [named[1], named[2]];
    const { cause, clears } = causeOf(message);
    const group = groups.get(cause) ?? { where: [], clears };
    if (where && !group.where.includes(where)) group.where.push(where);
    groups.set(cause, group);
  }
  return [...groups.entries()].map(([cause, g]) => ({ cause, where: g.where, clears: g.clears }));
}

/**
 * The few causes worth telling apart, in plain words, and whether each clears by itself (FB-297).
 * Anything else is reported in the studio's own words, as something that clears.
 *
 * GitHub answers "not found" both for a repository that isn't there and for a private one the
 * studio's key isn't allowed to see, so that sentence says both. On staging, ARCA's two private
 * repositories came back "not found" while its public one read fine.
 */
function causeOf(text: string): { cause: string; clears: boolean } {
  // The loaders' own catch-all, which names one repository per sentence: one line for all of them.
  if (/^The studio could not read \S+ just now\.?$/.test(text)) {
    return { cause: 'The studio could not read these just now.', clears: true };
  }
  if (/rate.?limit/i.test(text)) {
    return { cause: 'GitHub is limiting how much the studio can read just now. This fills in as reads succeed.', clears: true };
  }
  if (/not found|404|does not exist/i.test(text)) {
    return { cause: 'GitHub says this isn’t there, or the studio isn’t allowed to see it.', clears: false };
  }
  if (/permission|forbidden|403|not allowed/i.test(text)) {
    return { cause: 'The studio isn’t allowed to read this.', clears: false };
  }
  return { cause: text, clears: true };
}

/** What to do about the groups, in one sentence: nothing, or who has to act. */
export function degradedNextStep(groups: DegradedGroup[]): string {
  return groups.every((g) => g.clears)
    ? 'Nothing for you to do; it clears on its own.'
    : 'This won’t clear on its own: someone has to give the studio access to it.';
}


/**
 * What a surface has actually produced (FB-128), per `docs/decision-surface-outcomes.md`.
 *
 * The desk's last section is the only place a founder learns whether any of this worked, so it has to
 * be there — and it has to be honest, because a number nobody can source is worse than a blank. The
 * rule the memo settles, applied here:
 *
 * - **Build's line is true today.** Ticket counts come from the backlog and the preview from the box.
 * - **Sell has no source yet.** The email provider's reporting arrives with FB-142; until then the
 *   line says there is nothing reported, not "0 delivered".
 * - **Scale is not connected**, and its platform is an open decision (G3). It says that, and counts
 *   the tickets waiting on it — which is a real number the studio can see.
 *
 * No zeroes standing in for unknowns. A surface with no source says so in words.
 */
export interface SurfaceOutcomeInput {
  /** The department's own id, from the manifest. Consulted last and for one named reason. */
  departmentId: string;
  /** Tickets on this surface's own repository. Real, from the backlog. */
  ticketCount: number;
  /** The manifest declares somewhere this surface's work can be opened and seen running. */
  hasLaunch: boolean;
  /** The surface is set up at all. */
  provisioned: boolean;
  /**
   * Sell only: the most recent send the studio gated, if any (FB-142).
   *
   * Optional because every other surface has none, and absent is a real answer — a venture that has
   * never sent anything says so rather than reading as a surface that reports nothing.
   */
  lastSend?: Send | null;
  /**
   * How long ago that send went out, worked out on the server (FB-241). The desk draws this line in
   * the browser, which cannot read the studio's clock, so the age arrives as a number.
   */
  lastSendAgeMs?: number | null;
  /**
   * Connectors the surface declares (FB-248). Declaring `meta-ads` settles the platform question
   * for that venture, so its line stops saying "platform tbd" — and says "not connected" instead,
   * because no ad account is linked yet and the studio cannot read one.
   */
  connectors?: string[];
}

/**
 * Read from what the manifest declares, not from what the id is called.
 *
 * The first version switched on the literal ids `build` / `sell` / `scale` and hard-coded a claim
 * about each. The concrete cost, which is the one that matters: a venture that later connects a
 * Scale surface would still be told, in the studio's own voice, that it is not connected — because
 * the sentence was never sourced from anything the venture said.
 *
 * So `hasLaunch` and `provisioned` decide it. The one id that survives is `scale`, and it names a
 * **platform** decision rather than a venture: no ad platform has been chosen (G3,
 * `docs/decision-scale-platform.md`), and that is true of the Foundry, not of any one venture. It is
 * reached only when the venture has declared nothing to the contrary — the moment a Scale surface
 * declares somewhere to open, it gets the real line like any other.
 */
export function surfaceOutcome(input: SurfaceOutcomeInput): string {
  const tickets = input.ticketCount === 0 ? 'No tickets yet' : plural(input.ticketCount, 'ticket');

  if (input.hasLaunch) return `${tickets} · preview of the app running from the venture machine.`;
  if (!input.provisioned) return `Not set up yet. ${tickets} waiting on it.`;
  if (input.connectors?.includes(META_ADS_CONNECTOR)) return `Meta ads · not connected yet. ${tickets} waiting on it.`;
  if (input.departmentId === 'scale') return `Not connected · platform tbd. ${tickets} waiting on it.`;

  // FB-142: Sell is no longer silent. The studio holds every send it gated, so it can say what went
  // and when — and it says plainly that what happened NEXT is not reported, rather than printing a
  // zero for it. `lib/sends.ts` explains why two thirds of the design's line cannot be obtained.
  if (input.departmentId === 'sell') return sellOutcome(input.lastSend ?? null, input.ticketCount, input.lastSendAgeMs ?? null);

  // Nothing has reported, which is a different fact from nothing having happened — and only one of
  // them is true. There is no analytics source anywhere in the studio yet.
  return `${tickets}. Nothing reported yet — outcomes appear here once this surface reports.`;
}


/**
 * Which of a founder's waiting decisions the desk shows (FB-203, item 10).
 *
 * The design caps this list at three or four: it is an index, and "Needs you" holds the whole queue.
 * Capping a list that is ordered by kind, though, does not take the four most important things — it
 * takes the first kind until it runs out.
 *
 * That is not hypothetical. External sends lead the queue on purpose (FB-183: nothing leaves the
 * company without one), and on production ARCA had six of them. A cap of four showed four sends and
 * **every piece of finished work disappeared from the desk** — including the pull requests the amber
 * banner had just counted, on the screen the banner sends a founder to. The browser gate caught it
 * because a phone test looks for a pull-request row; a founder would have caught it by wondering
 * where their work went.
 *
 * So when both kinds are waiting, both are on the desk. The last slot goes to whichever kind the cap
 * would otherwise have erased. Everything else is still one press away, and `WaitingQueue` says how
 * many are behind the link rather than letting them go quiet.
 */
export function deskQueue<T extends { external?: boolean }>(items: readonly T[], rows: number): T[] {
  if (rows <= 0) return [];
  if (items.length <= rows) return [...items];

  const head = items.slice(0, rows);
  const isExternal = (i: T) => i.external === true;
  const missing = (kind: (i: T) => boolean) => items.some(kind) && !head.some(kind);

  // Only one kind can be missing at a time: the head is full, so if both kinds were absent from it
  // the head would be empty. Whichever it is, it takes the last slot from the kind that has the most
  // rows — which is the kind that pushed it out.
  const wanted = missing((i) => !isExternal(i))
    ? items.find((i) => !isExternal(i))
    : missing(isExternal)
      ? items.find(isExternal)
      : null;
  if (!wanted) return [...head];
  return [...head.slice(0, rows - 1), wanted];
}
