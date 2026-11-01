import { beforeEach, describe, expect, it, vi } from 'vitest';

// The server actions, replaced: these tests are about what the component does with their answer.
const { acceptWork, sendBackWork, pressFactoryCard } = vi.hoisted(() => ({ acceptWork: vi.fn(), sendBackWork: vi.fn(), pressFactoryCard: vi.fn() }));
vi.mock('@/app/actions/work', () => ({ acceptWork, sendBackWork }));
vi.mock('@/app/actions/press', () => ({ pressFactoryCard }));

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * FB-273: Accept and Send back are drawn by one component, `components/Decision.tsx`.
 *
 * Two things are held here. What a press does, which is the same on every screen. And what each
 * screen shows before anyone presses, which must stay exactly as it was: the screens' own browser
 * tests (`e2e/work.spec.ts`, `e2e/tickets-view.spec.ts`) find these buttons by their test ids.
 */

// Under vitest, JSX compiles to `React.createElement`; the component expects it in scope.
(globalThis as { React?: typeof React }).React = React;
const { Decision, decisionOutcome, press, stateLabel } = await import('@/components/Decision');

const WORK = { repo: 'arca', number: 10, headSha: 'abc1234' };
const SIGNED_OFF = { ok: true, signedOff: true, message: 'Signed off by you, waiting for John. Nothing changes in your product until he approves it.' };
const MERGED = { ok: true, message: 'Accepted. It is now part of your product.' };
const SENT = { ok: true, message: 'Sent. Your team picks this up on its next wake.' };

beforeEach(() => {
  acceptWork.mockReset();
  sendBackWork.mockReset();
  pressFactoryCard.mockReset();
});

describe('a press', () => {
  it('Accept passes the commit the founder was shown, and says it was an Accept', async () => {
    acceptWork.mockResolvedValue(SIGNED_OFF);
    const r = await press('arca', WORK, 'accept');
    expect(acceptWork).toHaveBeenCalledWith('arca', 'arca', 10, 'abc1234');
    expect(sendBackWork).not.toHaveBeenCalled();
    expect(r).toEqual({ ...SIGNED_OFF, decided: 'accept' });
  });

  it('Accept without a commit sends none, rather than an empty one', async () => {
    acceptWork.mockResolvedValue(SIGNED_OFF);
    await press('arca', { repo: 'arca', number: 10, headSha: null }, 'accept');
    expect(acceptWork).toHaveBeenCalledWith('arca', 'arca', 10, undefined);
  });

  it('Send back passes the note, and says it was a Send back', async () => {
    sendBackWork.mockResolvedValue(SENT);
    const r = await press('arca', WORK, 'send-back', 'Shorter, please.');
    expect(sendBackWork).toHaveBeenCalledWith('arca', 'arca', 10, 'Shorter, please.');
    expect(acceptWork).not.toHaveBeenCalled();
    expect(r).toEqual({ ...SENT, decided: 'send-back' });
  });

  it('Accept with notes passes them on, for the Review screen (FB-274)', async () => {
    acceptWork.mockResolvedValue(SIGNED_OFF);
    await press('arca', WORK, 'accept', '1. On the "after" picture: shorter.');
    expect(acceptWork).toHaveBeenCalledWith('arca', 'arca', 10, 'abc1234', '1. On the "after" picture: shorter.');
  });

  it("the Review screen's presses go to the press door, never to acceptWork or sendBackWork (FB-276)", async () => {
    pressFactoryCard.mockResolvedValue(SIGNED_OFF);
    expect(await press('arca', WORK, 'accept', 'Lovely.', true)).toEqual({ ...SIGNED_OFF, decided: 'accept' });
    expect(pressFactoryCard).toHaveBeenCalledWith('arca', 'arca', 10, 'accept', 'Lovely.', 'abc1234');
    pressFactoryCard.mockResolvedValue(SENT);
    await press('arca', WORK, 'send-back', 'Shorter.', true);
    expect(pressFactoryCard).toHaveBeenLastCalledWith('arca', 'arca', 10, 'send-back', 'Shorter.', 'abc1234');
    expect(acceptWork).not.toHaveBeenCalled();
    expect(sendBackWork).not.toHaveBeenCalled();
  });

  it('a refused press comes back as it was said, marked with which button it was', async () => {
    acceptWork.mockResolvedValue({ ok: false, message: 'You need to sign in.' });
    expect(await press('arca', WORK, 'accept')).toEqual({ ok: false, message: 'You need to sign in.', decided: 'accept' });
  });
});

describe('what the Tickets screen says after a press', () => {
  it("a founder's Accept is a sign-off, waiting for John", () => {
    expect(decisionOutcome({ ...SIGNED_OFF, decided: 'accept' })).toEqual({
      heading: 'Signed off, waiting for John',
      text: SIGNED_OFF.message,
    });
  });

  it("John's Accept is approved", () => {
    expect(decisionOutcome({ ...MERGED, decided: 'accept' }).heading).toBe('Approved and verified');
  });

  it('a Send back says nothing went out, whatever the server said', () => {
    expect(decisionOutcome({ ...SENT, decided: 'send-back' })).toEqual({
      heading: 'Sent back with your note',
      text: 'Nothing went out. Your team re-opens it, reads your note, and comes back with a revision.',
    });
  });
});

describe('what the work page says after a press', () => {
  it("John's Accept is accepted", () => {
    expect(stateLabel({ ...MERGED, decided: 'accept' })).toBe('accepted');
  });

  it("a founder's Accept is signed off (FB-272)", () => {
    expect(stateLabel({ ...SIGNED_OFF, decided: 'accept' })).toBe('signed off');
  });

  it('a Send back is sent back, never accepted or signed off (FB-281)', () => {
    expect(stateLabel({ ...SENT, decided: 'send-back' })).toBe('sent back');
    expect(stateLabel({ ...SENT, signedOff: true, decided: 'send-back' })).toBe('sent back');
  });
});

describe('each screen, before anyone presses', () => {
  const draw = (p: Partial<React.ComponentProps<typeof Decision>>) =>
    renderToStaticMarkup(React.createElement(Decision, { look: 'work', ventureId: 'arca', work: WORK, ...p }));
  const ids = (html: string) => [...html.matchAll(/data-testid="([^"]*)"/g)].map((m) => m[1]);

  it('the work page: Accept and Send back, in its words', () => {
    const html = draw({ look: 'work' });
    expect(ids(html)).toEqual(['work-decision', 'work-accept', 'work-sendback-open']);
    expect(html).toContain('>Accept this work<');
    expect(html).toContain('>Send it back with a note<');
  });

  it('the work page: when it cannot be accepted, the reason stands where Accept was', () => {
    const blocked = React.createElement('p', { 'data-testid': 'work-blocked' }, 'It clashes.');
    expect(ids(draw({ look: 'work', blocked }))).toEqual(['work-decision', 'work-blocked', 'work-sendback-open']);
  });

  it('the work page: work already merged has nothing to press', () => {
    const html = draw({ look: 'work', merged: true });
    expect(ids(html)).toEqual(['work-decision', 'work-state']);
    expect(html).toContain('>accepted<');
  });

  it('the work page: while the factory is quiet, a card\'s buttons are off and the page says why (FB-278)', () => {
    const html = draw({ look: 'work', off: 'The factory hasn\'t reported since 10:42.' });
    expect(ids(html)).toEqual(['work-decision', 'work-off', 'work-accept', 'work-sendback-open']);
    expect(html).toContain('reported since 10:42.');
    expect(html).toMatch(/data-testid="work-accept"[^>]*disabled/);
    expect(html).toMatch(/data-testid="work-sendback-open"[^>]*disabled/);
  });

  it('the Review screen: while the factory is quiet, both buttons are off and the reason is above them (FB-278)', () => {
    const html = draw({ look: 'review', isJohn: true, off: 'Off for now.' });
    expect(ids(html)).toEqual(['review-off', 'review-accept', 'review-sendback']);
    expect(html).toMatch(/data-testid="review-accept"[^>]*disabled/);
  });

  it('the Tickets screen: its own words for the same two buttons', () => {
    const html = draw({ look: 'tickets' });
    expect(ids(html)).toEqual(['detail-approve', 'detail-refuse']);
    expect(html).toContain('>Make it part of my product<');
    expect(html).toContain('>Refuse, and say why<');
  });

  it("the Review screen, for a founder: Sign it off, and Send back off until there is a note (FB-274)", () => {
    const html = draw({ look: 'review' });
    expect(ids(html)).toEqual(['review-accept', 'review-sendback']);
    expect(html).toContain('>Sign it off →<');
    expect(html).toMatch(/data-testid="review-sendback"[^>]*disabled/);
  });

  it("the Review screen, for John: his Accept makes it part of the product (FB-274)", () => {
    const notes = { text: '1. A note', sendBackLabel: 'Send it back with my 1 note', sendBackShort: 'Send it back' };
    const html = draw({ look: 'review', isJohn: true, reviewNotes: notes });
    expect(html).toContain('>Make it part of my product →<');
    expect(html).toContain('>Send it back with my 1 note<');
    expect(html).not.toMatch(/data-testid="review-sendback"[^>]*disabled/);
  });

  it('the drawer: Accept and Send back', () => {
    const html = draw({ look: 'drawer' });
    expect(ids(html)).toEqual(['drawer-accept', 'drawer-sendback-open']);
    expect(html).toContain('>Accept this work<');
  });
});
