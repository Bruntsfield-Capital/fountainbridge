import { describe, it, expect } from 'vitest';
import {
  attestationFor, approverRoleForDepartment, canApprove, canDecide, firstApprovalAttestationFor, isDualPair,
  refusalAttestationFor, stillNeededAfter,
} from '../approval-attestation';
import { verifyFirstApproval, verifyGrant } from '../provenance';
import type { VentureSummary } from '../ventures';

const venture: VentureSummary = {
  id: 'arca',
  name: 'ARCA',
  description: null,
  status: 'active',
  founderName: 'John',
  founderEmail: 'john@bruntsfield.capital',
  repos: ['arca'],
  vpsHost: 'arca.bruntsfield.capital',
  departments: [],
  approvalMatrix: [
    { changeClass: 'product-visible', approver: 'founder' },
    { changeClass: 'high-blast-radius', approver: 'dual' },
  ],
};

describe('attestationFor — MUST match deploy/executor/executor.mjs', () => {
  it('pins a known vector (studio↔executor compatibility)', () => {
    // Recomputed identically by the executor's expectedAttestation() — this vector is the contract.
    expect(attestationFor('wealthcx01/arca', 'appr-1', 'sha-abc', 'john@bruntsfield.capital', 'test-secret')).toBe(
      'b02a016dc51aa1061e4d7406009724cb190d7f139f92d9fbdc028b3efe4113ac',
    );
  });
  it('is case-insensitive on the approver (executor lowercases too)', () => {
    expect(attestationFor('wealthcx01/arca', 'appr-1', 'sha-abc', 'John@Bruntsfield.Capital', 'test-secret')).toBe(
      attestationFor('wealthcx01/arca', 'appr-1', 'sha-abc', 'john@bruntsfield.capital', 'test-secret'),
    );
  });
  it('changes if the pinned proposal sha changes (TOCTOU protection)', () => {
    expect(attestationFor('wealthcx01/arca', 'appr-1', 'sha-abc', 'john@bruntsfield.capital', 's')).not.toBe(
      attestationFor('wealthcx01/arca', 'appr-1', 'sha-XYZ', 'john@bruntsfield.capital', 's'),
    );
  });
});

describe('D7 routing + authorization', () => {
  it('routes an external/high-blast-radius action to the matrix approver', () => {
    expect(approverRoleForDepartment(venture, 'sell')).toBe('dual');
  });
  it('defaults to founder when the matrix does not name high-blast-radius', () => {
    expect(approverRoleForDepartment({ ...venture, approvalMatrix: [] }, 'sell')).toBe('founder');
  });
  it('lets the founder or an admin issue a founder-role grant; denies a stranger', () => {
    expect(canApprove('john@bruntsfield.capital', 'founder', venture, [])).toBe(true);
    expect(canApprove('admin@bruntsfield.capital', 'founder', venture, ['admin@bruntsfield.capital'])).toBe(true);
    expect(canApprove('random@example.com', 'founder', venture, [])).toBe(false);
  });
  it('requires an admin for a bruntsfield-role grant', () => {
    expect(canApprove('john@bruntsfield.capital', 'bruntsfield', venture, [])).toBe(false);
    expect(canApprove('admin@bruntsfield.capital', 'bruntsfield', venture, ['admin@bruntsfield.capital'])).toBe(true);
  });
  it('denies an empty email', () => {
    expect(canApprove('', 'founder', venture, [])).toBe(false);
  });
});

describe('the repo is part of the signed message', () => {
  it('a grant signed for one venture does not verify for another', () => {
    // A git blob sha is content-addressed — the same proposal bytes hash identically in any repo,
    // and the approval id is a directory name a lane picks. Without the repo, a lane could copy
    // another venture's proposal+grant pair into its own tree and have it verify.
    expect(attestationFor('wealthcx01/arca', 'a', 'sha', 'x@y.com', 's'))
      .not.toBe(attestationFor('wealthcx01/the-reset', 'a', 'sha', 'x@y.com', 's'));
  });

  it('trims as well as lowercases the approver', () => {
    expect(attestationFor('r', 'a', 'sha', '  X@Y.com ', 's')).toBe(attestationFor('r', 'a', 'sha', 'x@y.com', 's'));
  });
});

/**
 * FB-271: for a dual decision, one person can never approve alone.
 *
 * `canApprove` is the question "may the studio sign a grant on this one person's word?". Before
 * FB-271 it answered yes for the founder or an admin on a dual decision, and the executor sends on a
 * grant it can verify.
 */
describe('dual: both must approve, and one person is one person (FB-271)', () => {
  const FOUNDER = 'matthew@bruntsfield.capital';
  const ADMIN = 'john@bruntsfield.capital';
  const OTHER_ADMIN = 'second.admin@bruntsfield.capital';
  const ADMINS = [ADMIN, OTHER_ADMIN];
  const dual: VentureSummary = { ...venture, founderName: 'Founder', founderEmail: FOUNDER };
  const both: VentureSummary = { ...venture, founderName: 'John', founderEmail: ADMIN };

  it('nobody can approve a dual decision alone: not the founder, not an admin, not someone who is both', () => {
    expect(canApprove(FOUNDER, 'dual', dual, ADMINS)).toBe(false);
    expect(canApprove(ADMIN, 'dual', dual, ADMINS)).toBe(false);
    expect(canApprove(ADMIN, 'dual', both, ADMINS)).toBe(false);
  });

  it('either side may take part (and so may refuse alone); a stranger may not', () => {
    expect(canDecide(FOUNDER, 'dual', dual, ADMINS)).toBe(true);
    expect(canDecide(ADMIN, 'dual', dual, ADMINS)).toBe(true);
    expect(canDecide('random@example.com', 'dual', dual, ADMINS)).toBe(false);
  });

  it('the founder and an admin make a pair, in either order', () => {
    expect(isDualPair(FOUNDER, ADMIN, dual, ADMINS)).toBe(true);
    expect(isDualPair(ADMIN, FOUNDER, dual, ADMINS)).toBe(true);
    expect(isDualPair(' Matthew@Bruntsfield.Capital ', ADMIN, dual, ADMINS)).toBe(true);
  });

  it('the same address twice is never a pair, even when it is both founder and admin', () => {
    expect(isDualPair(FOUNDER, FOUNDER, dual, ADMINS)).toBe(false);
    expect(isDualPair(ADMIN, 'John@Bruntsfield.Capital', both, ADMINS)).toBe(false);
  });

  it('two admins are one side, unless one of them is the founder', () => {
    expect(isDualPair(ADMIN, OTHER_ADMIN, dual, ADMINS)).toBe(false);
    expect(isDualPair(ADMIN, OTHER_ADMIN, both, ADMINS)).toBe(true);
  });

  it('says who is still needed, by name', () => {
    expect(stillNeededAfter(FOUNDER, dual, ADMINS)).toBe('Bruntsfield');
    expect(stillNeededAfter(ADMIN, dual, ADMINS)).toBe('the founder');
    const reset = { ...dual, id: 'the-reset', name: 'THE RESET', founderName: 'Ross', founderEmail: 'ross@bruntsfield.capital' };
    expect(stillNeededAfter(ADMIN, reset, ADMINS)).toBe('Ross, the founder,');
    expect(stillNeededAfter(ADMIN, both, ADMINS)).toBe('someone else at Bruntsfield');
  });

  it('founder-only and Bruntsfield-only decisions are unchanged', () => {
    expect(canApprove(FOUNDER, 'founder', dual, ADMINS)).toBe(true);
    expect(canApprove(ADMIN, 'founder', dual, ADMINS)).toBe(true);
    expect(canApprove(FOUNDER, 'bruntsfield', dual, ADMINS)).toBe(false);
    expect(canApprove(ADMIN, 'bruntsfield', dual, ADMINS)).toBe(true);
  });
});

describe('a first approval can never pass as a grant (FB-271)', () => {
  const R = 'wealthcx01/arca';
  const AT = '2026-10-28T09:00:00Z';

  it('uses its own formula, so its signature is not a grant signature', () => {
    const half = firstApprovalAttestationFor('external-action', R, 'a', 'sha', 'x@y.com', AT, 's');
    expect(half).not.toBe(attestationFor(R, 'a', 'sha', 'x@y.com', 's'));
    expect(half).not.toBe(refusalAttestationFor(R, 'a', 'sha', 'x@y.com', 's', AT, ''));
  });

  it('a signed first approval, renamed grant.json, does not verify as a grant', () => {
    const record = {
      approver: 'x@y.com', proposal_sha: 'sha', approved_at: AT,
      attestation: firstApprovalAttestationFor('external-action', R, 'a', 'sha', 'x@y.com', AT, 's'),
    };
    expect(verifyFirstApproval('external-action', R, 'a', 'sha', record, 's')).toEqual({ approver: 'x@y.com', approvedAt: AT });
    expect(verifyGrant(R, 'a', 'sha', record, 's').provenance).toBe('unattested');
  });

  it('does not verify for a changed proposal, an edited time, another repo, or the other kind', () => {
    const record = {
      approver: 'x@y.com', proposal_sha: 'sha', approved_at: AT,
      attestation: firstApprovalAttestationFor('external-action', R, 'a', 'sha', 'x@y.com', AT, 's'),
    };
    expect(verifyFirstApproval('external-action', R, 'a', 'sha-new', record, 's')).toBeNull();
    expect(verifyFirstApproval('external-action', R, 'a', 'sha', { ...record, approved_at: '2026-10-29T09:00:00Z' }, 's')).toBeNull();
    expect(verifyFirstApproval('external-action', 'wealthcx01/the-reset', 'a', 'sha', record, 's')).toBeNull();
    expect(verifyFirstApproval('plan-release', R, 'a', 'sha', record, 's')).toBeNull();
    expect(verifyFirstApproval('external-action', R, 'a', 'sha', { ...record, attestation: 'f'.repeat(64) }, 's')).toBeNull();
  });
});
