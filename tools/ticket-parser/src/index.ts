/**
 * fountainbridge-ticket-parser (FB-004) — public API.
 *
 * Pure, dependency-free parsing of `docs/tickets/*.md` into the bcap-contracts `Ticket` contract.
 * File fetching (GitHub API) is FB-006; PR-derived status inference is FB-007. This library only
 * turns markdown content + caller context into a `Ticket` + warnings.
 */

export { parseTicket, looksLikeTicket, mapStatus, parseDependsOn, isStoppedStatus } from './parse';
export type {
  Ticket,
  TicketStatus,
  ParseContext,
  ParseResult,
  ParseWarning,
  ParseWarningCode,
} from './types';
export { TICKET_STATUSES } from './types';
