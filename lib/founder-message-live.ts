import 'server-only';
import { studioDatabase, withVenture } from './db';
import type { CardStore, StoredCard } from './card-store';
import type { Querier } from './push-store';
import { founderAddress, isFounder } from './authz';
import type { VentureSummary } from './ventures';
import { vapidFromEnv } from './webpush';
import { isProduction, mailFromEnv, notProduction, whyNoMail } from './mail';
import { messageFounder, retryFounderMessages, type SendDeps } from './founder-message-send';
import { messagesOff, reportGivenUp, RETRY_LIMIT, type GivenUpMessage } from './founder-message-store';

type Env = Record<string, string | undefined>;

/** A given-up message, as the heartbeat's answer lists it for the box (`docs/factory-cards.md`). */
export type GivenUpForBox = GivenUpMessage & { venture: string };

export interface FounderMessenger {
  /** A card was kept: tell its founder, if it is one they hear about. */
  onCard(ventureId: string, card: StoredCard): Promise<void>;
  /** A heartbeat came: try again the messages that did not go, for every venture with a founder. */
  retry(): Promise<void>;
  /** The given-up messages not reported yet, at most 20 across every venture, each marked reported. */
  givenUp(): Promise<GivenUpForBox[]>;
}

/**
 * What the door uses to message founders (FB-279), or null when this studio must message nobody:
 *
 *   - anywhere but production (`RAILWAY_ENVIRONMENT_NAME` exactly `production`), so staging and the
 *     previews, which copy production's settings, never claim or send a message;
 *   - with no database, because there is nowhere to record that a message went. The browser tests'
 *     studio has no database, so it never messages.
 */
export function founderMessenger(env: Env, ventures: VentureSummary[], cards: Pick<CardStore, 'card'> | null): FounderMessenger | null {
  if (!isProduction(env) || !studioDatabase(env) || !cards) return null;
  const mail = mailFromEnv(env);
  const sendDeps = (venture: VentureSummary): SendDeps => ({
    venture,
    run: (fn) => withVenture(venture.id, (c) => fn(c as unknown as Querier), env),
    keys: vapidFromEnv(env),
    mail,
    noMail: mail ? undefined : whyNoMail(env),
    studioUrl: (env.STUDIO_PUBLIC_URL ?? env.AUTH_URL ?? '').trim() || null,
    log: (line) => console.log(line),
  });
  const withFounder = () => ventures.filter((v) => founderAddress(v) !== null);
  return {
    async onCard(ventureId, card) {
      const venture = ventures.find((v) => v.id === ventureId);
      if (!venture) return; // cowgate's own cards, which belong to no venture
      await messageFounder({ ...sendDeps(venture), card });
    },
    async retry() {
      for (const venture of withFounder()) {
        await retryFounderMessages({ ...sendDeps(venture), card: (repo, number) => cards.card(venture.id, repo, number) });
      }
    },
    async givenUp() {
      const out: GivenUpForBox[] = [];
      for (const venture of withFounder()) {
        if (out.length >= RETRY_LIMIT) break;
        try {
          const got = await withVenture(venture.id, (c) => reportGivenUp(c as unknown as Querier, RETRY_LIMIT - out.length), env);
          out.push(...got.map((m) => ({ venture: venture.id, ...m })));
        } catch (e) {
          // Not marked, so they are reported on a later heartbeat.
          console.log(`[founder-messages] ${venture.id}: the given-up messages could not be read: ${(e as Error)?.message ?? 'unknown fault'}`);
        }
      }
      return out;
    },
  };
}

/** Why `founderMessenger` gave nothing, in words safe for a log, or null when it gives something. */
export function whyNoMessenger(env: Env): string | null {
  if (!isProduction(env)) return `${notProduction(env)}, and only production messages founders`;
  if (!studioDatabase(env)) return 'this studio has no database to record the messages in';
  return null;
}

export type MessagesLine = { off: boolean; email: string; byEmail: boolean } | { unread: true };

/**
 * The switch line for "Needs you", or null to draw nothing: for anyone but the venture's founder,
 * anywhere but production (which alone messages founders), and on a studio that has nowhere to
 * keep the choice or no way to send a message.
 */
export async function founderMessagesLine(venture: Pick<VentureSummary, 'id' | 'founderEmail'>, viewerEmail: string, env: Env = process.env): Promise<MessagesLine | null> {
  const founder = founderAddress(venture);
  if (!founder || !isFounder(venture, viewerEmail)) return null;
  if (!isProduction(env) || !studioDatabase(env)) return null;
  const byEmail = mailFromEnv(env) !== null;
  if (!byEmail && !vapidFromEnv(env)) return null;
  try {
    const off = await withVenture(venture.id, (c) => messagesOff(c as unknown as Querier, founder), env);
    return { off, email: founder, byEmail };
  } catch (e) {
    console.error('[founder-messages] could not read whether messages are on', { venture: venture.id, message: (e as Error).message });
    return { unread: true };
  }
}
