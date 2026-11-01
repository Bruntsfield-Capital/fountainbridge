import type { VentureSummary } from './ventures';
import { approvalRepos } from './venture-repos';
import { checkedPreview } from './preview-check';
import { reviewFor, stateFrom, type ReviewCardFile, type ReviewView } from './review';
import { toReviewCard, type CardStore } from './card-store';
import { namer } from './factory-work';
import { factoryQuietLine } from './press';

/**
 * Where the Review screen's cards come from: the card store (FB-275), which the planning box fills
 * through its door (`app/api/factory/route.ts`). `lib/card-store-live.ts` says which store a studio
 * uses; with none, every Review address answers "That work isn't here".
 */

/**
 * One finished card of this venture's, or null.
 *
 * Null both when there is no such card and when it belongs to another venture. The repository must
 * be one of this venture's own (CLAUDE.md #6), and the store is read scoped to this venture, so the
 * database itself will not hand over another venture's card (FB-170). Either way a card that is not
 * yours gets the same answer as one that does not exist.
 *
 * Only a finished card has a Review screen. One the factory has since marked done, stuck or sent
 * back gets the same "isn't here", which says it may have been decided already.
 */
export async function cardOf(venture: VentureSummary, repo: string, number: number, store: CardStore | null): Promise<ReviewCardFile | null> {
  if (!store || !Number.isInteger(number) || number <= 0) return null;
  if (!approvalRepos(venture).includes(repo)) return null;
  const card = await store.card(venture.id, repo, number);
  return card && card.state === 'finished' ? toReviewCard(card) : null;
}

/** Everything the Review screen shows for one card, for one viewer. Null when it is not theirs to see. */
export async function loadReview(
  venture: VentureSummary,
  repo: string,
  number: number,
  viewer: { email: string; isJohn: boolean; admins: string[] },
  store: CardStore | null,
  env: Record<string, string | undefined> = process.env,
  // The real clock, not `studioNow()`: press times and heartbeats are the real clock's.
  now: number = Date.now(),
): Promise<ReviewView | null> {
  const card = await cardOf(venture, repo, number, store);
  if (!card || !store) return null;

  // Where it stands: the presses on it, from the press store, with the box's answers (FB-276), and
  // any press the box let lapse (FB-278).
  const state = stateFrom(
    await store.presses(venture.id, repo, number),
    now,
    namer(viewer.email, viewer.admins, { email: venture.founderEmail, name: venture.founderName }),
  );

  // "1 of 6 pieces of finished work": every card of the venture's still waiting on someone, in the
  // order of the venture's repositories, lowest number first.
  const repos = approvalRepos(venture);
  // One at a time: a venture has a handful of finished cards, and each read is its own transaction.
  const waiting: { repo: string; number: number }[] = [];
  for (const w of await store.finished(venture.id, repos)) {
    const s = w.repo === repo && w.number === number ? null : stateFrom(await store.presses(venture.id, w.repo, w.number), now);
    if (!s || s.kind === 'finished' || s.kind === 'signed-off') waiting.push(w);
  }
  waiting.sort((a, b) => repos.indexOf(a.repo) - repos.indexOf(b.repo) || a.number - b.number);
  const index = waiting.findIndex((w) => w.repo === repo && w.number === number);
  const next = waiting[index + 1] ?? (index > 0 ? waiting[0] : null);

  // Opened before it is drawn as a link (FB-184), the same as on the work page.
  const preview = card.previewUrl ? await checkedPreview(card.previewUrl, env) : null;
  const quiet = await factoryQuietLine(store, now);

  return reviewFor(card, {
    ventureId: venture.id,
    ventureName: venture.name,
    repo,
    number,
    preview,
    state,
    place: {
      index: index + 1,
      of: waiting.length,
      next: next ? `/venture/${venture.id}/review/${next.repo}/${next.number}` : null,
    },
    viewer: { isJohn: viewer.isJohn },
    quiet,
  });
}
