import { describe, it, expect } from 'vitest';
import { authorizeVentures, canAccessVenture, founderAddress, isFounder, parseAdminEmails } from '../authz';
import { loadVentures } from '../ventures';

// arca's founder here is John (who is also the admin); the-reset's is Ross.
const ventures = [
  { id: 'arca', founderEmail: 'john.gallagher@wealthcx.com' },
  { id: 'the-reset', founderEmail: 'ross@thereset.com' },
];
const admins = ['john.gallagher@wealthcx.com'];

describe('authorizeVentures — the three FB-005 acceptance cases', () => {
  it('admin (John) sees every venture', () => {
    const a = authorizeVentures('john.gallagher@wealthcx.com', ventures, admins);
    expect(a.isAdmin).toBe(true);
    expect([...a.ventureIds].sort()).toEqual(['arca', 'the-reset']);
  });

  it('a founder sees only their own venture', () => {
    const a = authorizeVentures('ross@thereset.com', ventures, admins);
    expect(a.isAdmin).toBe(false);
    expect(a.ventureIds).toEqual(['the-reset']);
  });

  it('an unlisted account sees nothing', () => {
    expect(authorizeVentures('nobody@example.com', ventures, admins)).toEqual({
      isAdmin: false,
      ventureIds: [],
    });
  });

  it('a signed-out identity sees nothing', () => {
    expect(authorizeVentures(null, ventures, admins).ventureIds).toEqual([]);
    expect(authorizeVentures(undefined, ventures, admins).ventureIds).toEqual([]);
  });

  it('matching is case- and whitespace-insensitive', () => {
    expect(authorizeVentures('  ROSS@TheReset.com ', ventures, admins).ventureIds).toEqual([
      'the-reset',
    ]);
  });

  it('a venture with no founder email is never matched by a founder', () => {
    const vs = [{ id: 'x', founderEmail: null }];
    expect(authorizeVentures('someone@x.com', vs, []).ventureIds).toEqual([]);
  });

  it('a blank/whitespace identity matches nothing — even a manifest with a blank founder email', () => {
    const vs = [{ id: 'blank', founderEmail: '   ' }];
    expect(authorizeVentures('   ', vs, ['   '])).toEqual({ isAdmin: false, ventureIds: [] });
    expect(authorizeVentures('', vs, [])).toEqual({ isAdmin: false, ventureIds: [] });
  });
});

describe('canAccessVenture', () => {
  it('admin can access any venture', () => {
    expect(canAccessVenture({ isAdmin: true, ventureIds: [] }, 'anything')).toBe(true);
  });
  it('a founder can access only listed ventures', () => {
    const a = { isAdmin: false, ventureIds: ['the-reset'] };
    expect(canAccessVenture(a, 'the-reset')).toBe(true);
    expect(canAccessVenture(a, 'arca')).toBe(false);
  });
});

describe('founderAddress', () => {
  it('trims and lowercases the founder address, and gives null when there is none', () => {
    expect(founderAddress({ founderEmail: '  Matthew@Bruntsfield.Capital ' })).toBe('matthew@bruntsfield.capital');
    expect(founderAddress({ founderEmail: '   ' })).toBeNull();
    expect(founderAddress({ founderEmail: null })).toBeNull();
  });
});

describe('isFounder', () => {
  it('matches the founder whatever the case or spacing, and nobody when the manifest names none', () => {
    expect(isFounder({ founderEmail: 'Matthew@bruntsfield.capital' }, ' MATTHEW@Bruntsfield.Capital ')).toBe(true);
    expect(isFounder({ founderEmail: 'matthew@bruntsfield.capital' }, 'john@bruntsfield.capital')).toBe(false);
    expect(isFounder({ founderEmail: null }, '')).toBe(false);
    expect(isFounder({ founderEmail: '  ' }, '  ')).toBe(false);
  });
});

describe('parseAdminEmails', () => {
  it('splits on commas/whitespace and trims', () => {
    expect(parseAdminEmails('a@x.com, b@y.com  c@z.com')).toEqual(['a@x.com', 'b@y.com', 'c@z.com']);
  });
  it('handles undefined/empty', () => {
    expect(parseAdminEmails(undefined)).toEqual([]);
    expect(parseAdminEmails('   ')).toEqual([]);
  });
});

// --- FB-058: the DEPLOYED configuration, not a mock of it ------------------------------------------
// Everything above tests the function against invented ventures. That proves the logic and proves
// nothing about whether Ross, signing in tomorrow, sees only his venture — which depends on the real
// manifests and the real STUDIO_ADMIN_EMAILS, neither of which any test read.
//
// A manifest edit could hand a founder someone else's venture, or add them to the admin list, and
// every test here would still pass. This one reads what actually ships.
describe('venture isolation as configured (non-negotiable 6)', () => {
  // The production value, mirrored here on purpose: if it changes, this test should be the thing
  // that notices, not a founder seeing a board that is not theirs.
  const PRODUCTION_ADMINS = parseAdminEmails('john@bruntsfield.capital,john.gallagher@wealthcx.com');
  const real = loadVentures();

  it('every venture declares a founder, so none is visible to nobody or to everybody', () => {
    for (const v of real) {
      expect(v.founderEmail, `${v.id} has no founder email`).toBeTruthy();
      expect(v.founderEmail).toMatch(/@/);
    }
  });

  it('no founder email is also an admin email by accident', () => {
    // A founder who is silently an admin sees every venture, and nothing in the UI would say so.
    const admins = new Set(PRODUCTION_ADMINS.map((e) => e.toLowerCase()));
    for (const v of real) {
      if (v.id === 'arca' || v.id === 'modernisation-engine') continue; // John's own, deliberately
      expect(admins.has((v.founderEmail ?? '').toLowerCase()), `${v.id}'s founder is in the admin list`).toBe(false);
    }
  });

  it('Ross sees the-reset and nothing else', () => {
    const access = authorizeVentures('ross@bruntsfield.capital', real, PRODUCTION_ADMINS);
    expect(access.isAdmin).toBe(false);
    expect(access.ventureIds).toEqual(['the-reset']);
    // Asserted per venture rather than by count, so adding a fourth venture cannot quietly pass.
    for (const v of real) {
      expect(canAccessVenture(access, v.id), `ross vs ${v.id}`).toBe(v.id === 'the-reset');
    }
  });

  it('John sees every venture', () => {
    const access = authorizeVentures('john.gallagher@wealthcx.com', real, PRODUCTION_ADMINS);
    expect(access.isAdmin).toBe(true);
    for (const v of real) expect(canAccessVenture(access, v.id)).toBe(true);
  });

  it('a Workspace address that is nobody sees nothing', () => {
    // Signing in is not authorisation. The consent screen is Internal to the Bruntsfield Workspace,
    // so any colleague can authenticate; only a named founder or admin gets a venture.
    const access = authorizeVentures('someone-else@bruntsfield.capital', real, PRODUCTION_ADMINS);
    expect(access.ventureIds).toEqual([]);
    for (const v of real) expect(canAccessVenture(access, v.id)).toBe(false);
  });

  it('case and surrounding whitespace cannot widen or narrow access', () => {
    expect(authorizeVentures('  ROSS@Bruntsfield.Capital  ', real, PRODUCTION_ADMINS).ventureIds).toEqual(['the-reset']);
  });
});
