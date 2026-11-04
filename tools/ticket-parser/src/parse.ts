/**
 * Ticket-file parser (FB-004): a `docs/tickets/*.md` file → the bcap-contracts `Ticket` contract.
 *
 * Design goals (from the ticket):
 *  - Tolerant of real variation across repos, not just the ideal template. Two live formats are
 *    supported side by side:
 *      grassmarket — H1 `# GRS-0001 — Title`, metadata as a bullet list (`- **Loop:** 0`,
 *                    `- **Status:** In review`), free-text statuses, letter-suffix ids (GRS-0147b).
 *      fountainbridge — H1 `# FB-004 — Title`, metadata inline (`**Phase:** 1 · **Depends on:** FB-002`).
 *  - Graceful degradation: a malformed ticket parses to a `Ticket` with warnings, never a throw.
 *    Imperfect tickets are shown flagged, never hidden (CLAUDE.md #10, "fail loud").
 *  - Status is a *hint* only. Parse-time default is `todo`; authoritative PR-derived inference is FB-007.
 */

import type {
  ParseContext,
  ParseResult,
  ParseWarning,
  Ticket,
  TicketStatus,
} from './types';

/** Ticket id: 2+ uppercase letters, a hyphen, digits, an optional lowercase suffix. e.g. FB-1, GRS-0147b. */
/**
 * A ticket id at the start of a heading or filename.
 *
 * `<PREFIX>-NEW` is accepted deliberately (FB-097). The composer filed everything under that
 * placeholder for weeks, so those files exist — and rejecting them meant the studio counted them as
 * "not tickets" and dropped them off the board entirely, which is a stranger failure than showing
 * them: work a founder asked for, filed successfully, and invisible. They parse, they carry an
 * `unnumbered-id` warning, and the board renders them as unnumbered so they get renamed rather than
 * quietly accumulate.
 */
const ID_ANCHORED = /^([A-Z]{2,}-(?:\d+[a-z]?|NEW))\b/;
const ID_GLOBAL = /\b[A-Z]{2,}-\d+[a-z]?\b/g;
/** Separators between an id and its title in an H1: em/en dash, hyphen, colon, middot. */
const HEADING_SEP = /\s*[—–\-:·]\s*/;
/**
 * A metadata field: `**Key:** value` (colon inside the bold) OR `**Key**: value` (colon
 * outside — a common author variant). Bullet prefix tolerated. EVERY whitespace run and the key
 * itself are bounded — an unbounded space-matching quantifier next to a space-inclusive key class
 * backtracks catastrophically (ReDoS) on a `**` followed by a long colon-less run. Fully bounded
 * quantifiers keep matching linear regardless of input length. Only the trailing value is open.
 */
const FIELD =
  /^[ \t]{0,16}[-*]?[ \t]{0,4}\*\*[ \t]{0,4}([^*:\n]{1,80}?)[ \t]{0,4}(?::[ \t]{0,4}\*\*|\*\*[ \t]{0,4}:)[ \t]{0,4}(.*)$/;

/**
 * Status vocabulary, checked in precedence order against the leading clause of the status text
 * (the part before the first `—`, `(`, `;`). First group with a keyword hit wins. `todo` is
 * checked before `in-progress` so "not started" doesn't get caught by "started".
 */
const STATUS_RULES: ReadonlyArray<readonly [TicketStatus, RegExp]> = [
  ['done', /\b(done|complete|completed|shipped|merged|closed|fixed|resolved|implemented|delivered|landed|ratified)\b/],
  ['pr-open', /\b(pr[\s-]?open|in[\s-]?review|under[\s-]?review|awaiting[\s-]?review|ready[\s-]?for[\s-]?review)\b|pr\s*#/],
  ['todo', /\b(todo|to[\s-]?do|backlog|planned|not[\s-]?started|draft|proposed|queued|pending)\b/],
  ['in-progress', /\b(in[\s-]?progress|wip|active|doing|ongoing|building|paused|blocked|on[\s-]?hold|halted|underway|started)\b/],
];

function stripInline(value: string): string {
  return value.replace(/[*`]/g, '').trim();
}

/**
 * Work nobody will do (FB-296). The contract has no state for it, so it maps to `done` (it is settled,
 * not waiting), and the result says `stopped` so a screen can call it "Stopped", not "Done".
 */
const STOPPED = /\b(stopped|cancell?ed|dropped|abandoned|won'?t[\s-]?do|wontfix|superseded|retired|not[\s-]?wanted)\b/;

/** Whether a free-text status says the work was stopped rather than finished. */
export function isStoppedStatus(raw: string): boolean {
  const lead = stripInline(raw).split(/[—–(;]/)[0].toLowerCase().trim();
  return STOPPED.test(lead);
}

/** Map a free-text status to the contract enum. Returns null if nothing recognizable is found. */
export function mapStatus(raw: string): TicketStatus | null {
  const lead = stripInline(raw)
    .split(/[—–(;]/)[0]
    .toLowerCase()
    .trim();
  if (!lead) return null;
  for (const [status, re] of STATUS_RULES) {
    if (re.test(lead)) return status;
  }
  return null;
}

/** Extract dependency ids from a `Depends on:` value. Best-effort; "none"/"—"/"-" → []. */
export function parseDependsOn(raw: string): string[] {
  const cleaned = stripInline(raw);
  if (!cleaned || /^(none|n\/?a|-{1,2}|—|–)\b/i.test(cleaned)) return [];
  const ids = cleaned.match(ID_GLOBAL) ?? [];
  return [...new Set(ids)];
}

/** Split an H1 into its ticket id (if any) and title. */
function splitHeading(h1: string): { id: string | null; title: string } {
  const text = h1.replace(/^#+\s*/, '').trim();
  const idMatch = text.match(ID_ANCHORED);
  if (!idMatch) return { id: null, title: text };
  const id = idMatch[0];
  const rest = text.slice(id.length).replace(new RegExp(`^${HEADING_SEP.source}`), '').trim();
  return { id, title: rest || text };
}

function fileStem(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/i, '');
}

function idFromPath(path: string): string | null {
  const m = fileStem(path).match(ID_ANCHORED);
  return m ? m[0] : null;
}

/** Human-ish title from a filename when the file has no usable H1. */
function titleFromPath(path: string, id: string | null): string {
  let slug = fileStem(path);
  if (id && slug.toUpperCase().startsWith(id.toUpperCase())) {
    slug = slug.slice(id.length).replace(/^[-_\s]+/, '');
  }
  const words = slug.replace(/[-_]+/g, ' ').trim();
  if (!words) return id || fileStem(path) || path; // never empty — contract requires minLength 1
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Parse a ticket markdown file into a `Ticket`. Never throws on string content — malformed input
 * yields a best-effort `Ticket` plus `warnings`. Throws only on a missing caller context (a usage
 * error, not a data error), since `repo`/`path` are required contract fields it cannot invent.
 */
export function parseTicket(markdown: string, ctx: ParseContext): ParseResult {
  if (!ctx || !ctx.repo || !ctx.path) {
    throw new TypeError('parseTicket requires a context with non-empty { repo, path }.');
  }
  const warnings: ParseWarning[] = [];
  const src = typeof markdown === 'string' ? markdown : '';
  const lines = src.split(/\r?\n/);

  // --- id + title, from the H1 where possible, else from the filename ------------------------
  const h1Index = lines.findIndex((l) => /^#\s+/.test(l));
  let id: string | null = null;
  let title: string | null = null;

  if (h1Index >= 0) {
    const heading = splitHeading(lines[h1Index]);
    id = heading.id;
    title = heading.title || null;
  } else {
    warnings.push({
      code: 'no-h1',
      message: 'No H1 heading found; id and title derived from the filename.',
    });
  }

  if (!id) {
    const fromPath = idFromPath(ctx.path);
    if (fromPath) {
      id = fromPath;
      if (h1Index >= 0) {
        warnings.push({
          code: 'no-id-in-heading',
          message: 'H1 present but no ticket id in it; id taken from the filename.',
        });
      }
    } else {
      id = fileStem(ctx.path) || ctx.path; // never empty — contract requires minLength 1
      warnings.push({
        code: 'no-id',
        message:
          'No ticket id (e.g. FB-001) found in the heading or filename; this may not be a ticket file.',
      });
    }
  }

  // FB-097: a ticket that never got a real number cannot be referred to, depended on, or approved by
  // name. It parses — dropping it would hide real work — and says loudly that it needs renaming.
  if (/-NEW$/.test(id)) {
    warnings.push({
      code: 'unnumbered-id',
      message: `"${id}" is a placeholder, not a ticket id — this ticket needs a real number before anything can refer to it.`,
    });
  }

  if (!title) {
    title = titleFromPath(ctx.path, id);
    warnings.push({ code: 'no-title', message: 'No title in an H1; derived from the filename.' });
  }

  // --- metadata block: from just after the H1 to the first `## ` section ----------------------
  let phase: string | null = null;
  let branch: string | null = null;
  let dependsOn: string[] = [];
  let statusRaw: string | null = null;

  const start = h1Index >= 0 ? h1Index + 1 : 0;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break;
    if (!line.trim()) continue;
    // A single physical line may hold several `·`-separated fields (fountainbridge inline style).
    // Only split when the line actually looks inline (≥2 bold fields), so a bullet value that
    // legitimately contains `·` (e.g. "blocked · waiting") isn't silently truncated.
    const boldCount = line.match(/\*\*/g)?.length ?? 0;
    const segments = boldCount >= 4 && line.includes('·') ? line.split('·') : [line];
    for (const segment of segments) {
      const m = segment.match(FIELD);
      if (!m) continue;
      const key = m[1].trim().toLowerCase().replace(/\s+/g, ' ');
      const value = m[2];
      switch (key) {
        case 'phase':
        case 'loop':
          phase = stripInline(value).replace(/\s*\(.*\)\s*$/, '').trim() || null;
          break;
        case 'depends on':
        case 'depends':
        case 'dependencies':
        case 'deps':
          dependsOn = parseDependsOn(value);
          break;
        case 'branch':
          branch = stripInline(value).split(/\s+/)[0] || null;
          break;
        case 'status':
          statusRaw = value;
          break;
        // Other keys (Owner, Severity, Normative sources, Repo, …) are legitimately common and
        // not part of the contract — ignore them silently rather than warn.
        default:
          break;
      }
    }
  }

  // --- status: absence is normal (default todo); presence-but-unmappable is worth flagging -----
  let status: TicketStatus = 'todo';
  const stopped = statusRaw !== null && isStoppedStatus(statusRaw);
  if (stopped) {
    status = 'done';
  } else if (statusRaw !== null && statusRaw.trim() !== '') {
    const mapped = mapStatus(statusRaw);
    if (mapped) {
      status = mapped;
    } else {
      warnings.push({
        code: 'unrecognized-status',
        message: `Status "${stripInline(statusRaw)}" did not map to a known lifecycle state; defaulting to "todo".`,
      });
    }
  }

  const ticket: Ticket = {
    id,
    repo: ctx.repo,
    path: ctx.path,
    title,
    phase,
    depends_on: dependsOn,
    status,
    branch,
    pr_url: null,
    body_md: src,
  };

  return stopped ? { ticket, warnings, stopped: true } : { ticket, warnings };
}

/**
 * Heuristic: does this parse look like an actual ticket (vs. a stray README/design note in the
 * directory)? A consumer (FB-006) uses this to decide what to render as a ticket.
 */
export function looksLikeTicket(result: ParseResult): boolean {
  return !result.warnings.some((w) => w.code === 'no-id');
}
