import { describe, expect, it, vi } from 'vitest';

// The server actions, replaced: nothing is pressed here, only drawn.
vi.mock('@/app/actions/work', () => ({ acceptWork: vi.fn(), sendBackWork: vi.fn() }));
vi.mock('@/app/actions/press', () => ({ pressFactoryCard: vi.fn() }));

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { reviewFor, stateFrom } from '@/lib/review';
import { toReviewCard } from '@/lib/card-store';
import { LAPSE_MS, NOT_ANSWERED, type StoredPress } from '@/lib/presses';
import { storedCard, withPictures } from './review-fixtures';

/**
 * FB-278: what the Review screen draws for a press the factory let lapse. The rules are proved in
 * `review.test.ts`; this is the half a person sees: "Nothing was done.", and the buttons back.
 */

(globalThis as { React?: typeof React }).React = React;
const { ReviewScreen } = await import('@/components/ReviewScreen');

const CARD = toReviewCard(withPictures(storedCard('arca', 21)));
const APPROVE: StoredPress = {
  id: 'p1', ventureId: 'arca', repo: 'arca', number: 21, action: 'approve', by: 'j@x', byJohn: true, source: 'studio',
  note: '', seenHeadSha: CARD.headSha, pressedAt: '2026-07-21T10:00:00Z', collectedAt: '2026-07-21T10:01:00Z', answer: null,
};

const draw = (now: number) => renderToStaticMarkup(React.createElement(ReviewScreen, {
  view: reviewFor(CARD, {
    ventureId: 'arca', ventureName: 'ARCA', repo: 'arca', number: 21, preview: null,
    state: stateFrom([APPROVE], now), place: { index: 1, of: 1, next: null }, viewer: { isJohn: true }, quiet: null,
  }),
}));

describe('a press the factory never answered, on the Review screen', () => {
  it('before it lapses: decided, and no buttons', () => {
    const html = draw(Date.parse(APPROVE.collectedAt!) + LAPSE_MS - 1);
    expect(html).not.toContain('data-testid="review-lapsed"');
    expect(html).not.toContain('data-testid="review-accept"');
  });

  it('once it lapses: "Nothing was done.", and the buttons are back', () => {
    const html = draw(Date.parse(APPROVE.collectedAt!) + LAPSE_MS);
    expect(html).toContain(`data-testid="review-lapsed">${NOT_ANSWERED}<`);
    expect(html).toMatch(/data-testid="review-state"[^>]*>Nothing was done</);
    expect(html).toContain('data-testid="review-accept"');
    expect(html).not.toMatch(/data-testid="review-accept"[^>]*disabled/);
  });
});
