import { describe, it, expect } from 'vitest';
import { verifyRefusal } from '../provenance';
import { attestationFor, refusalAttestationFor } from '../approval-attestation';

/**
 * FB-183: a refusal is only a refusal when the studio can prove a human made it.
 *
 * `refusal.json` lives on the same ref the proposing lane can write. Everything here is the
 * adversarial half — what a lane could put in that file, and what must happen when it does.
 *
 * The safe direction to fail is "still waiting": the worst case is a founder asked a second time,
 * where the other direction closes a decision nobody made.
 */
const SECRET = 'test-secret';
const REPO = 'wealthcx01/arca-marketing';
const ID = 'september-note';
const SHA = 'abc123';
const WHO = 'matthew@bruntsfield.capital';

const AT = '2026-09-03T02:20:56.399Z';
const NOTE = 'Not this month.';
const signed = (over: Record<string, unknown> = {}) => ({
  id: ID, repo: REPO, decision: 'refused', refused_by: WHO, proposal_sha: SHA,
  attestation: refusalAttestationFor(REPO, ID, SHA, WHO, SECRET, AT, NOTE),
  refused_at: AT, note: NOTE,
  ...over,
});

describe('verifyRefusal (FB-183)', () => {
  it('accepts one the studio signed, and reports who and why', () => {
    const r = verifyRefusal(REPO, ID, SHA, signed(), SECRET);
    expect(r?.refusedBy).toBe(WHO);
    expect(r?.note).toBe('Not this month.');
  });

  it('refuses one whose reason was edited after it was signed', () => {
    // The founder's words are part of the record. Changing them must break the signature.
    expect(verifyRefusal(REPO, ID, SHA, signed({ note: 'Fine, send it.' }), SECRET)).toBeNull();
  });

  it('refuses one whose date was changed or blanked after it was signed', () => {
    // A blank date drops the refusal out of "What happened"; a moved one buries it.
    expect(verifyRefusal(REPO, ID, SHA, signed({ refused_at: '' }), SECRET)).toBeNull();
    expect(verifyRefusal(REPO, ID, SHA, signed({ refused_at: '2020-01-01T00:00:00.000Z' }), SECRET)).toBeNull();
    expect(verifyRefusal(REPO, ID, SHA, signed({ refused_at: undefined }), SECRET)).toBeNull();
  });

  it('refuses one with no signature — a lane can write this file', () => {
    expect(verifyRefusal(REPO, ID, SHA, signed({ attestation: '' }), SECRET)).toBeNull();
    expect(verifyRefusal(REPO, ID, SHA, signed({ attestation: 'deadbeef' }), SECRET)).toBeNull();
  });

  it('refuses one pinned to a different proposal', () => {
    // Refusing one document must not close a different one that replaced it.
    expect(verifyRefusal(REPO, ID, SHA, signed({ proposal_sha: 'other' }), SECRET)).toBeNull();
    expect(verifyRefusal(REPO, ID, 'moved-on', signed(), SECRET)).toBeNull();
  });

  it('refuses one signed for a different repository or a different approval', () => {
    expect(verifyRefusal('wealthcx01/arca', ID, SHA, signed(), SECRET)).toBeNull();
    expect(verifyRefusal(REPO, 'another-send', SHA, signed(), SECRET)).toBeNull();
  });

  /**
   * The reason the refusal formula carries a literal `refused` (see `refusalAttestationFor`).
   *
   * If the two shared a formula, a signed GRANT and a signed REFUSAL over the same proposal would be
   * byte-identical — so either file could be renamed to the other and would still verify. A refusal
   * replayed as a grant is a send going out that a human explicitly stopped.
   */
  it('a grant signature does not verify as a refusal', () => {
    const asGrant = signed({ attestation: attestationFor(REPO, ID, SHA, WHO, SECRET) });
    expect(verifyRefusal(REPO, ID, SHA, asGrant, SECRET)).toBeNull();
  });

  it('refuses everything when the studio has no secret to check against', () => {
    expect(verifyRefusal(REPO, ID, SHA, signed(), undefined)).toBeNull();
  });

  it('shrugs at rubbish rather than throwing', () => {
    for (const junk of [null, undefined, 'a string', 42, [], {}]) {
      expect(verifyRefusal(REPO, ID, SHA, junk, SECRET)).toBeNull();
    }
  });
});
