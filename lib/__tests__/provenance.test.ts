import { describe, it, expect } from 'vitest';
import { verifyGrant, describeProvenance } from '../provenance';
import { attestationFor } from '../approval-attestation';

const SECRET = 'studio-signing-secret';
const ID = 'send-launch-email';
const SHA = 'abc123';
const APPROVER = 'matthew@bruntsfield.capital';
const REPO = 'wealthcx01/arca';
// Sign via the SAME function the studio uses — re-deriving the formula in a test is how a verifier
// and its signer drift apart while CI stays green.
const sign = (repo = REPO, id = ID, sha = SHA, approver = APPROVER, secret = SECRET) =>
  attestationFor(repo, id, sha, approver, secret);

const grant = (over: Record<string, unknown> = {}) => ({
  approver: APPROVER, proposal_sha: SHA, attestation: sign(), granted_at: '2026-07-30T11:00:00Z', ...over,
});

describe('a grant is an approval only when the studio can prove it issued it', () => {
  it('accepts its own signature and names the approver', () => {
    const v = verifyGrant(REPO, ID, SHA, grant(), SECRET);
    expect(v).toMatchObject({ provenance: 'attested', approver: APPROVER, grantedAt: '2026-07-30T11:00:00Z' });
  });

  it('REFUSES a grant a lane forged, and refuses to name anyone', () => {
    // The lane holds repo-write on this ref and can write any file it likes. What it cannot do is
    // produce this HMAC — the secret lives on the studio and the executor, never on a lane box.
    const forged = grant({ approver: 'john@bruntsfield.capital', attestation: 'not-a-real-hmac' });
    const v = verifyGrant(REPO, ID, SHA, forged, SECRET);
    expect(v.provenance).toBe('unattested');
    expect(v.approver).toBeNull();          // an unverified name is noise, not evidence
    expect(v.reasonKind).toBe('bad-signature');
  });

  it('refuses a grant signed for a DIFFERENT approval or approver', () => {
    expect(verifyGrant(REPO, ID, SHA, grant({ attestation: sign(REPO, 'other-id') }), SECRET).provenance).toBe('unattested');
    expect(verifyGrant(REPO, ID, SHA, grant({ approver: 'someone@else.com' }), SECRET).provenance).toBe('unattested');
  });

  it('refuses once the proposal has changed under it', () => {
    // The attestation pins the sha that was approved — the same TOCTOU protection the executor
    // relies on, surfaced to the founder instead of discovered at execution time.
    const v = verifyGrant(REPO, ID, 'a-different-sha', grant(), SECRET);
    expect(v.provenance).toBe('unattested');
    expect(v.reasonKind).toBe('proposal-changed');
  });

  it('refuses a grant signed with a different secret', () => {
    expect(verifyGrant(REPO, ID, SHA, grant({ attestation: sign(REPO, ID, SHA, APPROVER, 'other') }), SECRET).provenance)
      .toBe('unattested');
  });

  it('does not fall back to trusting the file when it cannot verify', () => {
    // No secret must mean "cannot verify", never "assume fine" — an unverifiable grant is exactly
    // what this exists to catch.
    expect(verifyGrant(REPO, ID, SHA, grant(), undefined).provenance).toBe('unattested');
    expect(verifyGrant(REPO, ID, SHA, grant({ attestation: undefined }), SECRET).reasonKind).toBe('no-signature');
    expect(verifyGrant(REPO, ID, SHA, grant({ approver: '' }), SECRET).reasonKind).toBe('no-approver');
    expect(verifyGrant(REPO, ID, null, grant(), SECRET).reasonKind).toBe('proposal-unreadable');
  });

  it('reports no grant at all as `none`, not as a failure', () => {
    expect(verifyGrant(REPO, ID, SHA, null, SECRET)).toMatchObject({ provenance: 'none', approver: null });
    expect(verifyGrant(REPO, ID, SHA, undefined, SECRET).provenance).toBe('none');
  });
});

describe('a grant cannot be replayed from another venture', () => {
  it('refuses a valid grant copied into a different repo', () => {
    // A git blob sha is content-addressed: the same proposal bytes hash identically in any repo, and
    // the approval id is a directory name a lane picks. Without the repo in the signed message, a
    // lane could copy another venture's proposal+grant pair and have it verify.
    const forVentureA = grant({ attestation: sign('wealthcx01/arca') });
    expect(verifyGrant('wealthcx01/arca', ID, SHA, forVentureA, SECRET).provenance).toBe('attested');
    expect(verifyGrant('wealthcx01/the-reset', ID, SHA, forVentureA, SECRET).reasonKind).toBe('bad-signature');
  });

  it('refuses a grant with no pinned proposal, matching the executor exactly', () => {
    // The executor rejects a missing proposal_sha outright; a verifier laxer than the enforcer is a
    // divergence waiting to rot.
    expect(verifyGrant(REPO, ID, SHA, grant({ proposal_sha: undefined }), SECRET).reasonKind).toBe('proposal-changed');
  });

  it('returns the CANONICAL approver, not the raw field', () => {
    // Anyone holding a copy of a valid grant could otherwise rewrite `approver` to a case variant
    // that folds identically — still verifying, while displaying a name the signature never covered.
    const v = verifyGrant(REPO, ID, SHA, grant({ approver: 'Matthew@Bruntsfield.Capital' }), SECRET);
    expect(v.provenance).toBe('attested');
    expect(v.approver).toBe('matthew@bruntsfield.capital');
  });
});

describe('what the founder is told, and what to do about it', () => {
  it('names the human when it verifies', () => {
    const d = describeProvenance(verifyGrant(REPO, ID, SHA, grant(), SECRET))!;
    expect(d.text).toContain(APPROVER);
    expect(d.text).toContain('30 July 2026');
    expect(d.nextStep).toBe('');
  });

  it('gives a forged approval an ESCALATION, not just a warning', () => {
    const d = describeProvenance(verifyGrant(REPO, ID, SHA, grant({ attestation: 'x' }), SECRET))!;
    expect(d.text).toContain('the studio did not issue that approval');
    expect(d.nextStep).toContain('Tell Bruntsfield');
  });

  it('gives a CHANGED proposal a re-approve, not an escalation', () => {
    const d = describeProvenance(verifyGrant(REPO, ID, 'new-sha', grant(), SECRET))!;
    expect(d.nextStep).toContain('approve again');
    expect(d.nextStep).not.toContain('Tell Bruntsfield');
  });

  it('does NOT promise nothing will be sent when the studio simply has no secret', () => {
    // The one case where that promise is false: the studio cannot verify while the executor may hold
    // a working secret, so a real approval still executes. Telling the founder otherwise would be the
    // same misrepresentation this narrowing removed, inverted.
    const d = describeProvenance(verifyGrant(REPO, ID, SHA, grant(), undefined))!;
    expect(d.text).toContain('may still go out');
    expect(d.text).not.toContain('Nothing has been sent');
  });

  it('uses no implementation words', () => {
    const all = ([grant({ attestation: 'x' }), grant({ approver: '' }), grant()] as const)
      .flatMap((g) => [describeProvenance(verifyGrant(REPO, ID, SHA, g, SECRET))])
      .concat(describeProvenance(verifyGrant(REPO, ID, SHA, grant(), undefined)))
      .filter(Boolean)
      .map((d) => `${d!.text} ${d!.nextStep}`.toLowerCase());
    for (const line of all) {
      for (const jargon of ['attestation', 'executor', 'hmac', 'unattested']) {
        expect(line, jargon).not.toContain(jargon);
      }
    }
  });

  it('says nothing when nothing has been granted', () => {
    expect(describeProvenance(verifyGrant(REPO, ID, SHA, null, SECRET))).toBeNull();
  });
});

describe('the signature comparison itself', () => {
  it('refuses a PREFIX or an extension of a valid signature', () => {
    // A prefix comparison passed every other test in this file, and is exploitable by exactly the
    // adversary this module exists to stop: a lane writes attestation:'a' and it verifies ~1 time in
    // 16, retryable. Every other forgery fixture happens to be near-full-length, so nothing
    // distinguished "wrong bytes" from "wrong length".
    const good = sign();
    for (const bad of [good.slice(0, 1), good.slice(0, 32), good.slice(0, good.length - 1), `${good}00`]) {
      expect(verifyGrant(REPO, ID, SHA, grant({ attestation: bad }), SECRET).provenance, bad.length.toString())
        .toBe('unattested');
    }
  });

  it('verifies a grant whose approver differs only in case or padding', () => {
    // Dropping .toLowerCase() or .trim() from the VERIFIER passed every test: the issuer's
    // normalisation was pinned, the verifier's was not. A real consequence — a grant the studio
    // itself issued for a mixed-case Google address would read as unverified, and the founder would
    // be told to treat a genuine approval as forged.
    const g = { approver: '  Matthew@Bruntsfield.Capital ', proposal_sha: SHA, attestation: sign(), granted_at: 't' };
    expect(verifyGrant(REPO, ID, SHA, g, SECRET).provenance).toBe('attested');
  });

  it('accepts exactly what the issuer produces — the studio↔verifier contract', () => {
    const att = attestationFor('wealthcx01/arca', 'appr-1', 'sha-abc', 'John@Bruntsfield.Capital', 'test-secret');
    expect(att).toBe('b02a016dc51aa1061e4d7406009724cb190d7f139f92d9fbdc028b3efe4113ac');
    expect(verifyGrant('wealthcx01/arca', 'appr-1', 'sha-abc',
      { approver: 'John@Bruntsfield.Capital', proposal_sha: 'sha-abc', attestation: att }, 'test-secret').provenance)
      .toBe('attested');
  });

  it('treats a non-object grant payload as no grant', () => {
    expect(verifyGrant(REPO, ID, SHA, 'just-a-string' as never, SECRET).provenance).toBe('none');
    expect(verifyGrant(REPO, ID, SHA, 42 as never, SECRET).provenance).toBe('none');
  });
});
