import { describe, expect, it } from 'vitest';
import { founderSafe, isSettled, noteFrom, reviewFor, stateFrom, type ReviewCardFile } from '../review';
import { toReviewCard } from '../card-store';
import { LAPSE_MS, NOT_ANSWERED, NOT_COLLECTED, QUIET_MS, quietLine, quietSince, type BoxAnswer, type PressAction, type StoredPress } from '../presses';
import { storedCard, withPictures } from './review-fixtures';

/**
 * FB-274: what the Review screen is handed, for a founder and for John.
 *
 * The rule under test is the ticket's: no dollar figure, no "What to do next" line and no Archon
 * link ever reaches a founder's browser. The screen is handed only what `reviewFor` returns, so if
 * none of it is in what `reviewFor` returns, none of it is in the browser.
 */

// ARCA's #20, as the door stores it and the store hands it back (FB-275).
const CARD: ReviewCardFile = toReviewCard(withPictures(storedCard('arca', 20)));

const at = (isJohn: boolean) => ({
  ventureId: 'arca',
  ventureName: 'ARCA',
  repo: 'arca',
  number: 20,
  preview: null,
  state: { kind: 'finished' } as const,
  place: { index: 1, of: 2, next: null },
  viewer: { isJohn },
});

/** Everything John-only, as a founder must never receive it. */
const JOHN_ONLY = [/\$\s?\d/, /what to do next/i, /archon/i];

describe("a founder's Review screen", () => {
  const view = reviewFor(CARD, at(false));
  const sent = JSON.stringify(view);

  it.each(JOHN_ONLY)('holds nothing matching %s', (re) => {
    expect(sent).not.toMatch(re);
  });

  it("has none of John's parts", () => {
    expect(view.forJohn).toBeNull();
  });

  it('loses only the sentence that named a cost, not the line it was in', () => {
    // The fixture's second trail line ends "The checks ran for $0.40." on purpose.
    expect(view.trail.map((t) => t.text)).toContain('Your team finished it and checked it three ways.');
  });

  it('never passes on a part of the card it does not know', () => {
    const odd = { ...CARD, budgetLeft: '$21.60', archonRun: 'run-20' } as ReviewCardFile;
    expect(JSON.stringify(reviewFor(odd, at(false)))).not.toMatch(/21\.60|run-20/);
    expect(JSON.stringify(reviewFor(odd, at(true)))).not.toMatch(/21\.60|run-20/);
  });

  it('a note John wrote is read through the same lock', () => {
    const view2 = reviewFor(CARD, {
      ...at(false),
      state: { kind: 'sent-back', by: 'John', at: '2026-07-21T00:00:00Z', note: 'Too slow. What to do next: retry it. Cost $3.', signedOffBy: null, answer: null },
    });
    expect(JSON.stringify(view2)).not.toMatch(/what to do next|\$3/i);
    expect(view2.state.kind === 'sent-back' && view2.state.note).toBe('Too slow.');
  });

  it("the factory's answer is read through the same lock", () => {
    const view2 = reviewFor(CARD, {
      ...at(false),
      state: {
        kind: 'approved', by: 'John', at: '2026-07-21T00:00:00Z', signedOffBy: null,
        answer: { outcome: 'done', message: 'Merged. The run cost $2.10. See it in Archon.', at: '2026-07-21T00:01:00Z' },
      },
    });
    expect(JSON.stringify(view2)).not.toMatch(/\$2|archon/i);
    expect(view2.state.kind === 'approved' && view2.state.answer?.message).toBe('Merged.');
  });
});

describe("John's Review screen", () => {
  const view = reviewFor(CARD, at(true));

  it('has his cost, his next step and the run', () => {
    expect(view.forJohn).toEqual({
      cost: '$3.40 so far, of a $25 budget',
      nextStep: 'What to do next: approve it. Nothing else waiting depends on it.',
      runUrl: 'https://archon.example.invalid/runs/arca-20',
    });
  });

  it('reads the card as the factory wrote it', () => {
    expect(view.trail[1].text).toContain('$0.40');
  });

  it('gets each picture at its own size, from the studio', () => {
    expect(view.pictures).toEqual([
      { name: 'before-computer', width: 1440, height: 1000, src: '/venture/arca/review/arca/20/picture/before-computer' },
      { name: 'after-computer', width: 1440, height: 1000, src: '/venture/arca/review/arca/20/picture/after-computer' },
      { name: 'before-phone', width: 393, height: 851, src: '/venture/arca/review/arca/20/picture/before-phone' },
      { name: 'after-phone', width: 393, height: 851, src: '/venture/arca/review/arca/20/picture/after-phone' },
    ]);
  });
});

describe('founderSafe', () => {
  it('keeps a sentence with a pound figure: only dollars are costs', () => {
    expect(founderSafe('It shows £1,240. It cost $2.')).toBe('It shows £1,240.');
  });
});

describe('the note a Send back carries', () => {
  it('names the picture and the spot of every pin, then the note about the whole thing', () => {
    const note = noteFrom(
      [
        { picture: 'after-phone', x: 81.6, y: 40.9, text: 'The button is cut off here' },
        { picture: 'after-computer', x: 10, y: 10, text: '   ' },
        { picture: 'before-computer', x: 50, y: 50, text: 'This was fine before.' },
      ],
      'Otherwise good.',
    );
    expect(note).toBe(
      '1. On the "after" picture, on a phone, 82% across and 41% down: The button is cut off here\n' +
        '2. On the "before" picture, on a computer, 50% across and 50% down: This was fine before.\n' +
        'About the whole thing: Otherwise good.',
    );
  });

  it('is only the whole-thing note when nothing was pinned', () => {
    expect(noteFrom([], ' Shorter, please. ')).toBe('Shorter, please.');
  });

  it('is empty when nothing was written, so Send back stays off', () => {
    expect(noteFrom([{ picture: 'after-phone', x: 1, y: 1, text: '' }], '')).toBe('');
  });
});

describe("a card's state", () => {
  let n = 0;
  const press = (action: PressAction, by: string, patch: Partial<StoredPress> = {}): StoredPress => ({
    id: `p${++n}`, ventureId: 'arca', repo: 'arca', number: 20, action, by, byJohn: by === 'j@x', source: 'studio', note: '',
    seenHeadSha: 'sha', pressedAt: `2026-07-21T10:00:0${n % 10}Z`, collectedAt: null, answer: null, ...patch,
  });
  const said = (outcome: BoxAnswer['outcome'], message = 'Said.'): BoxAnswer => ({ outcome, message, at: '2026-07-21T11:00:00Z' });
  /** A minute after the presses below: none of them has lapsed. */
  const NOW = Date.parse('2026-07-21T10:01:00Z');

  it('is finished until someone presses', () => {
    expect(stateFrom([], NOW)).toEqual({ kind: 'finished' });
  });

  it("a founder's sign-off does not settle it", () => {
    const s = stateFrom([press('accept', 'f@x', { note: 'Lovely.' })], NOW);
    expect(s).toMatchObject({ kind: 'signed-off', by: 'f@x', note: 'Lovely.' });
    expect(isSettled(s)).toBe(false);
  });

  it("a founder's sign-off then John's approval is approved, and remembers the sign-off", () => {
    const s = stateFrom([press('accept', 'f@x'), press('approve', 'j@x')], NOW);
    expect(s).toMatchObject({ kind: 'approved', by: 'j@x', signedOffBy: 'f@x', answer: null });
    expect(isSettled(s)).toBe(true);
  });

  it("shows the factory's answer once it has one", () => {
    expect(stateFrom([press('approve', 'j@x', { answer: said('done', 'Made part of ARCA.') })], NOW)).toMatchObject({
      kind: 'approved', answer: { outcome: 'done', message: 'Made part of ARCA.' },
    });
  });

  it('the press the factory did wins over a later one it said did nothing', () => {
    const s = stateFrom([press('send-back', 'f@x', { answer: said('done') }), press('approve', 'j@x', { answer: said('out-of-date') })], NOW);
    expect(s).toMatchObject({ kind: 'sent-back', by: 'f@x' });
  });

  it('a press the factory said did nothing still shows, with what it said', () => {
    const s = stateFrom([press('approve', 'j@x', { answer: said('out-of-date', 'Nothing was done.') })], NOW);
    expect(s).toMatchObject({ kind: 'approved', answer: { outcome: 'out-of-date' } });
    expect(isSettled(s)).toBe(true);
  });

  it("John's other presses are decided, by name", () => {
    for (const action of ['stop', 'reject', 'try-again', 'split'] as const) {
      expect(stateFrom([press(action, 'j@x')], NOW)).toMatchObject({ kind: 'decided', action, by: 'j@x' });
    }
  });

  it('a tap on Telegram says so', () => {
    const s = stateFrom([press('reject', 'j@x', { source: 'telegram', answer: said('done') })], NOW, (e) => (e === 'j@x' ? 'John' : e));
    expect(s).toMatchObject({ kind: 'decided', action: 'reject', by: 'John on Telegram' });
  });

  it('a press the factory never collected lapses after 10 minutes: nothing was done, and the card waits again', () => {
    const approve = press('approve', 'j@x');
    const lapses = Date.parse(approve.pressedAt) + LAPSE_MS;
    expect(stateFrom([approve], lapses - 1)).toMatchObject({ kind: 'approved', answer: null });
    const s = stateFrom([approve], lapses);
    expect(s).toEqual({
      kind: 'finished',
      lapsed: { action: 'approve', by: 'j@x', at: new Date(lapses).toISOString(), message: NOT_COLLECTED },
    });
    expect(isSettled(s)).toBe(false);
  });

  it('a press collected and never answered lapses 10 minutes after it was collected, keeping the sign-off before it', () => {
    const presses = [press('accept', 'f@x'), press('approve', 'j@x', { collectedAt: '2026-07-21T10:30:00Z' })];
    expect(stateFrom(presses, Date.parse('2026-07-21T10:39:59Z'))).toMatchObject({ kind: 'approved' });
    expect(stateFrom(presses, Date.parse('2026-07-21T10:40:00Z'))).toMatchObject({
      kind: 'signed-off', by: 'f@x', lapsed: { message: NOT_ANSWERED, at: '2026-07-21T10:40:00.000Z' },
    });
  });

  it("the factory's late answer wins over the lapse", () => {
    const late = press('approve', 'j@x', { collectedAt: '2026-07-21T10:30:00Z', answer: said('done', 'Made part of ARCA.') });
    expect(stateFrom([late], Date.parse('2026-07-22T00:00:00Z'))).toMatchObject({ kind: 'approved', answer: { outcome: 'done' } });
  });

  it('when the box did a lapsed press after all and the press after it too, the card shows the later', () => {
    const presses = [
      press('approve', 'j@x', { collectedAt: '2026-07-21T10:00:00Z', answer: said('done', 'Made part of ARCA.') }),
      press('try-again', 'j@x', { answer: said('done', 'Building it again.') }),
    ];
    expect(stateFrom(presses, NOW)).toMatchObject({ kind: 'decided', action: 'try-again', answer: { message: 'Building it again.' } });
  });

  it('says who pressed in the words the viewer reads', () => {
    expect(stateFrom([press('accept', 'f@x')], NOW, (e) => (e === 'f@x' ? 'you' : e))).toMatchObject({ by: 'you' });
  });
});

describe('when the factory goes quiet (FB-278)', () => {
  it('is quiet only after five minutes without a report, and never before the first', () => {
    const last = '2026-11-04T10:42:00Z';
    expect(quietSince(null, Date.parse(last))).toBeNull();
    expect(quietSince(last, Date.parse(last) + QUIET_MS)).toBeNull();
    expect(quietSince(last, Date.parse(last) + QUIET_MS + 1)).toBe(last);
  });

  it('names the time it last reported, in London time, and the day when it was not today', () => {
    const now = Date.parse('2026-11-04T10:50:00Z');
    expect(quietLine('2026-11-04T10:42:10Z', now)).toBe("The factory hasn't reported since 10:42. These may be out of date.");
    expect(quietLine('2026-11-03T10:42:10Z', now)).toBe("The factory hasn't reported since 3 Nov, 10:42. These may be out of date.");
    // Summer time: London is an hour ahead of the clock the box signs with.
    expect(quietLine('2026-07-21T09:42:00Z', Date.parse('2026-07-21T10:00:00Z'))).toContain('since 10:42.');
  });
});
