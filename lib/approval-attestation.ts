/**
 * Approval attestation (FB-046) — the studio side of the FB-044 gate.
 *
 * When a human approves an external action in the studio, the server signs the grant with an HMAC
 * over {repo, approval id, proposal blob sha, approver}. The gated executor
 * (deploy/executor/executor.mjs) recomputes the same HMAC with the SHARED secret and refuses anything
 * that doesn't match — so a lane (which never holds the secret) cannot forge a grant.
 *
 * **The repo is in the signed message deliberately.** One secret serves every venture, and a git blob
 * sha is content-addressed — the same proposal bytes hash identically in any repository, and the
 * approval id is just a directory name a lane chooses. Without the repo, a lane on venture B that
 * could read venture A's approvals ref could copy A's proposal.json and grant.json into its own tree
 * and have the pair verify: a real signature, for an approval no human ever issued for that venture,
 * executed with venture B's credentials. No guard can catch that — only the signed message can.
 *
 * ⚠ There are THREE implementations of this formula and they must stay byte-identical:
 * `attestationFor()` here, `verifyGrant()` in lib/provenance.ts (which calls this one — keep it that
 * way), and `expectedAttestation()` in deploy/executor/executor.mjs. The compat test in
 * lib/__tests__/approval-attestation.test.ts pins a known vector; change the format and you change
 * the executor and the vector in the same commit.
 *
 * Server-only — the secret (FOUNDRY_APPROVAL_SECRET) must never reach the client or the lane box.
 */

import 'server-only';
import { createHmac } from 'node:crypto';
import { isFounder } from './authz';
import type { VentureSummary } from './ventures';

export function attestationFor(
  repo: string,
  id: string,
  proposalSha: string,
  approver: string,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`${repo}|${id}|${proposalSha}|${approver.trim().toLowerCase()}`)
    .digest('hex');
}

/** Who approves a change class, per the D7 approval matrix. */
export type ApproverRole = 'founder' | 'bruntsfield' | 'dual';

/** A department's gate — mirrors the manifest `departments[].gate`. */
export type DepartmentGate = 'pr' | 'activegraph' | 'tbd-fb012';

/**
 * Who may approve this department's external action, per the D7 approval matrix on the manifest.
 * External sends are a high-blast-radius change class (D3/D7) — routed to the matrix's
 * `high-blast-radius` approver (founder | bruntsfield | dual). Falls back to `founder` if the matrix
 * doesn't name it (a product-visible default), never to "anyone".
 */
export function approverRoleForDepartment(venture: VentureSummary, departmentId: string): ApproverRole {
  const row = venture.approvalMatrix?.find((r) => r.changeClass === 'high-blast-radius');
  return row?.approver ?? 'founder';
}

function normalise(email: string): string {
  return email.trim().toLowerCase();
}


function isAdmin(email: string, adminEmails: string[]): boolean {
  const e = normalise(email);
  return Boolean(e) && adminEmails.map((a) => a.trim().toLowerCase()).includes(e);
}

/**
 * May `email` take part in deciding this? Deny by default.
 *
 * `founder` → the venture's founder, or a studio admin. `bruntsfield` → a studio admin.
 * `dual` → the founder or a studio admin, but each of them is only HALF the decision (FB-271).
 *
 * This is the check for saying no: one refusal from either side of a dual decision closes it. It is
 * NOT the check for saying yes — that is `canApprove` below, and for `dual` the yes needs two people.
 */
export function canDecide(email: string, role: ApproverRole, venture: VentureSummary, adminEmails: string[]): boolean {
  if (!normalise(email)) return false;
  const founder = isFounder(venture, email);
  const admin = isAdmin(email, adminEmails);
  switch (role) {
    case 'founder':
      return founder || admin; // an admin can always act; the founder owns product-visible changes
    case 'bruntsfield':
      return admin;
    case 'dual':
      return founder || admin;
    default:
      return false;
  }
}

/**
 * Can `email`, alone, approve this — so that the studio may sign a grant on their word only?
 *
 * Always false for `dual` (FB-271). Until FB-271, `dual` let either the founder or an admin issue the
 * grant alone, and the executor sends on a grant it can verify — so "both must approve" meant "either
 * may approve". A dual decision is now granted only by `isDualPair`: two different people, one of them
 * the founder and the other a studio admin.
 */
export function canApprove(email: string, role: ApproverRole, venture: VentureSummary, adminEmails: string[]): boolean {
  if (role === 'dual') return false;
  return canDecide(email, role, venture, adminEmails);
}

/**
 * Do these two approvals, together, make a dual decision (FB-271)?
 *
 * They must come from two different addresses, and between them cover both sides: one the
 * venture's founder, the other a studio admin. An address that is both the founder and an admin is
 * ONE person: it fills one side, never both, so it still needs a second, different person.
 *
 * What this cannot see: one human signing in with two different addresses. The studio knows
 * accounts, not people.
 */
export function isDualPair(first: string, second: string, venture: VentureSummary, adminEmails: string[]): boolean {
  const a = normalise(first);
  const b = normalise(second);
  if (!a || !b || a === b) return false;
  return (isFounder(venture, a) && isAdmin(b, adminEmails)) || (isAdmin(a, adminEmails) && isFounder(venture, b));
}

/**
 * Who a dual decision is still waiting for, once `first` has approved, in words for the screen.
 * The person who has not approved yet is named, so nobody has to guess whose turn it is.
 */
export function stillNeededAfter(first: string, venture: VentureSummary, adminEmails: string[]): string {
  const founder = isFounder(venture, first);
  const admin = isAdmin(first, adminEmails);
  // ARCA's founder is named "Founder", a placeholder: "Founder, the founder," would say it twice.
  const name = venture.founderName?.trim();
  const founderName = name && name.toLowerCase() !== 'founder' ? `${name}, the founder,` : 'the founder';
  if (founder && admin) return 'someone else at Bruntsfield';
  if (founder) return 'Bruntsfield';
  return founderName;
}

/**
 * The signature over the FIRST of the two approvals a dual decision needs (FB-271).
 *
 * Its own formula, separated from the grant by the literal `first-approval` in the signed string —
 * the same way FB-183 separates a refusal. If it shared the grant's formula, a signed first half
 * could be renamed `grant.json` and the executor would verify it and send, on one person's word.
 * The word in the string is what stops half a decision being replayed as a whole one.
 *
 * `kind` says what is being approved (`external-action`, or `plan-release` for a held plan), so a
 * first half for one can never be copied across to the other. The approver and the time go in as
 * one JSON array, as the refusal's fields do: nothing in one field can shift where the next begins.
 * `proposalSha` pins the exact proposal approved; a changed proposal does not match, and the half
 * is void.
 */
export function firstApprovalAttestationFor(
  kind: 'external-action' | 'plan-release',
  repo: string,
  id: string,
  proposalSha: string,
  approver: string,
  approvedAt: string,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`${repo}|${id}|${proposalSha}|first-approval|${JSON.stringify([kind, normalise(approver), approvedAt])}`)
    .digest('hex');
}

/**
 * The signature over a REFUSAL (FB-183).
 *
 * A separate formula from `attestationFor`, and separated by a literal `refused` in the signed
 * string rather than by convention. If the two shared a formula, a signed refusal and a signed
 * grant over the same proposal would be byte-identical — so a refusal file could be renamed to
 * `grant.json` and would verify as an approval to send. The word in the string is what stops one
 * decision being replayed as the other.
 *
 * The date and the reason are signed too. Unsigned, anything that can write the file could change
 * the founder's stated reason, or blank the date so the refusal drops out of "What happened", and
 * the signature would still check out (FB-183 review). They go in as one JSON array, so a `|` in
 * the reason cannot shift where one field ends and the next begins.
 */
export function refusalAttestationFor(
  repo: string,
  id: string,
  proposalSha: string,
  approver: string,
  secret: string,
  refusedAt: string,
  note: string,
): string {
  return createHmac('sha256', secret)
    .update(`${repo}|${id}|${proposalSha}|refused|${JSON.stringify([approver.trim().toLowerCase(), refusedAt, note])}`)
    .digest('hex');
}

/**
 * The signature over a monthly budget for temporary ticket machines (FB-239; John, 2026-10-02).
 *
 * John approves each venture's monthly machine budget on the studio's budget page, signed in with
 * Google (`app/actions/machine-budget.ts`). The studio refuses to make a machine for a venture unless
 * the newest budget on record names an approved proposal for the same amount, carries this
 * signature, and was approved by the one address in `BUDGET_APPROVER_EMAIL`. A lane never holds
 * `FOUNDRY_APPROVAL_SECRET`, so it cannot write a budget for itself, raise one, or move one from
 * another venture: the venture id and the proposal id are inside the signed text.
 *
 * Its own formula, separated from the grant and the refusal by the literal `machine-budget`, so a
 * budget can never be replayed as an approval to send, nor the other way round. The fields go in as
 * one JSON array, for the refusal's reason: nothing in one field can shift where the next begins.
 */
export function machineBudgetAttestationFor(
  ventureId: string,
  proposalId: string,
  monthlyCents: number,
  approver: string,
  approvedAt: string,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`machine-budget|${JSON.stringify([ventureId, proposalId, monthlyCents, approver.trim().toLowerCase(), approvedAt])}`)
    .digest('hex');
}
