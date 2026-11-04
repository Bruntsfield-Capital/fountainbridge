/**
 * Ticket types — mirror of the bcap-contracts `Ticket` contract (v0.1.0), vendored at
 * `schema/Ticket.schema.json` (FB-002). Hand-authored here so FB-004 stays an isolated,
 * dependency-light tool; FB-005 replaces these with the generated TS types from bcap-contracts.
 * Keep this in lock-step with the vendored schema — `test/schema.test.ts` enforces it.
 */

/** Where a ticket sits in the one-ticket-one-branch-one-PR flow (FB-002 spec). */
export type TicketStatus = 'todo' | 'in-progress' | 'pr-open' | 'done';

export const TICKET_STATUSES: readonly TicketStatus[] = [
  'todo',
  'in-progress',
  'pr-open',
  'done',
] as const;

/**
 * A work item, rendered from a `docs/tickets/` markdown file. `id`, `repo`, `path`, `title`
 * are required by the contract; `repo`/`path` come from the file's location (caller context),
 * everything else is parsed from the markdown.
 */
export interface Ticket {
  /** Ticket id, e.g. 'FB-001' (or 'GRS-0147b'). */
  id: string;
  /** Repo the ticket lives in — from caller context, not the markdown. */
  repo: string;
  /** Path to the ticket file within the repo — from caller context. */
  path: string;
  /** Ticket title. */
  title: string;
  /** Phase/Loop label, if the ticket declares one. */
  phase: string | null;
  /** Ids of tickets this one depends on. */
  depends_on: string[];
  /** Lifecycle status. Parse-time default is `todo`; PR-derived inference lands in FB-007. */
  status: TicketStatus;
  /** Branch name (fb-XXX-slug), if the ticket declares one. */
  branch: string | null;
  /** URL of the open/merged PR, if any. Always null at parse time (filled by FB-007). */
  pr_url: string | null;
  /** Rendered markdown body of the ticket (the full source). */
  body_md: string;
}

/** Non-fatal issue found while parsing. Surfaced, never swallowed (CLAUDE.md non-negotiable #10). */
export interface ParseWarning {
  /** Stable machine code, e.g. 'no-id', 'unrecognized-status'. */
  code: ParseWarningCode;
  /** Human-readable, founder-facing explanation. */
  message: string;
}

export type ParseWarningCode =
  | 'no-h1'
  | 'no-id'
  | 'no-id-in-heading'
  /** `<PREFIX>-NEW` — the composer's old placeholder, which is not a name (FB-097). */
  | 'unnumbered-id'
  | 'no-title'
  | 'unrecognized-status';

/** Caller-supplied context: the required contract fields the markdown can't provide. */
export interface ParseContext {
  /** Repo the ticket lives in, e.g. 'fountainbridge'. Required (contract `repo`). */
  repo: string;
  /** Repo-relative path, e.g. 'docs/tickets/FB-004-ticket-file-parser.md'. Required (contract `path`). */
  path: string;
}

/** Result of parsing one ticket file: always a valid `Ticket`, plus any warnings. */
export interface ParseResult {
  ticket: Ticket;
  warnings: ParseWarning[];
  /** The status said the work was stopped (FB-296). `ticket.status` is then `done`. */
  stopped?: true;
}
