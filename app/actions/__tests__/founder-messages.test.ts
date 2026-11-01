import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A founder starting and stopping the messages about their team's work (FB-279). A server action is
 * a public endpoint (FB-127), so these pin who may switch, and that a refusal writes nothing.
 */
const auth = vi.fn();
const loadVentures = vi.fn();
const withVenture = vi.fn();
const setMessagesOff = vi.fn();

class NoDatabaseError extends Error {}
vi.mock('server-only', () => ({}));
vi.mock('@/auth', () => ({ auth: () => auth() }));
vi.mock('@/lib/ventures', () => ({ loadVentures: () => loadVentures() }));
vi.mock('@/lib/db', () => ({ withVenture: (id: string, fn: (q: unknown) => unknown) => withVenture(id, fn), NoDatabaseError }));
vi.mock('@/lib/founder-message-store', () => ({ setMessagesOff: (...a: unknown[]) => setMessagesOff(...a) }));

const { setFounderMessages } = await import('../founder-messages');

const ARCA = { id: 'arca', name: 'ARCA', repos: ['arca'], departments: [], founderEmail: 'Founder@bruntsfield.capital', approvalMatrix: [] };
const RESET = { id: 'the-reset', name: 'The Reset', repos: ['the-reset'], departments: [], founderEmail: 'ross@bruntsfield.capital', approvalMatrix: [] };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.STUDIO_ADMIN_EMAILS;
  loadVentures.mockReturnValue([ARCA, RESET]);
  auth.mockResolvedValue({ user: { email: 'founder@bruntsfield.capital' } });
  withVenture.mockImplementation(async (_id: string, fn: (q: unknown) => unknown) => fn({}));
});

describe('the founder', () => {
  it('can stop the messages, and start them again, under their own venture', async () => {
    expect(await setFounderMessages('arca', false)).toEqual({ ok: true });
    expect(withVenture.mock.calls[0][0]).toBe('arca');
    expect(setMessagesOff.mock.calls[0].slice(1)).toEqual(['founder@bruntsfield.capital', true]);

    expect(await setFounderMessages('arca', true)).toEqual({ ok: true });
    expect(setMessagesOff.mock.calls[1].slice(1)).toEqual(['founder@bruntsfield.capital', false]);
  });

  it('is told plainly when there is nowhere to keep the choice', async () => {
    withVenture.mockRejectedValue(new NoDatabaseError('no database'));
    expect(await setFounderMessages('arca', false)).toEqual({ ok: false, message: 'The studio has nowhere to keep this choice yet. Nothing was changed.' });
  });
});

describe('anyone else is refused, and nothing is written', () => {
  it('John, who can see the venture but is not its founder', async () => {
    process.env.STUDIO_ADMIN_EMAILS = 'john@bruntsfield.capital';
    auth.mockResolvedValue({ user: { email: 'john@bruntsfield.capital' } });
    const r = await setFounderMessages('arca', false);
    expect(r).toEqual({ ok: false, message: 'Only the founder of this venture gets these messages, so only they can switch them.' });
    expect(withVenture).not.toHaveBeenCalled();
  });

  it('a venture the session cannot reach', async () => {
    expect((await setFounderMessages('the-reset', false)).ok).toBe(false);
    expect(withVenture).not.toHaveBeenCalled();
  });

  it('nobody signed in', async () => {
    auth.mockResolvedValue(null);
    expect((await setFounderMessages('arca', false)).ok).toBe(false);
    expect(withVenture).not.toHaveBeenCalled();
  });

  it('a value that is not on or off', async () => {
    for (const on of ['false', 0, null, undefined, {}]) {
      expect((await setFounderMessages('arca', on)).ok).toBe(false);
    }
    expect(withVenture).not.toHaveBeenCalled();
  });
});
