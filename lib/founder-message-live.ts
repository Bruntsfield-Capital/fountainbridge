import 'server-only';
import { studioDatabase, withVenture } from './db';
import type { StoredCard } from './card-store';
import type { Querier } from './push-store';
import { founderAddress } from './authz';
import type { VentureSummary } from './ventures';
import { vapidFromEnv } from './webpush';
import { mailFromEnv, whyNoMail } from './mail';
import { messageFounder } from './founder-message-send';
import { messagesOff } from './founder-message-store';

type Env = Record<string, string | undefined>;

/**
 * What the door calls when it has stored a card (FB-279), or null when this studio cannot message
 * anybody: with no database there is nowhere to record that a message went, so none goes. The
 * browser tests' studio has no database, so it never messages.
 */
export function founderMessenger(env: Env, ventures: VentureSummary[]): ((ventureId: string, card: StoredCard) => Promise<void>) | null {
  if (!studioDatabase(env)) return null;
  const mail = mailFromEnv(env);
  return async (ventureId, card) => {
    const venture = ventures.find((v) => v.id === ventureId);
    if (!venture) return; // cowgate's own cards, which belong to no venture
    await messageFounder({
      venture,
      card,
      run: (fn) => withVenture(venture.id, (c) => fn(c as unknown as Querier), env),
      keys: vapidFromEnv(env),
      mail,
      noMail: mail ? undefined : whyNoMail(env),
      studioUrl: (env.STUDIO_PUBLIC_URL ?? env.AUTH_URL ?? '').trim() || null,
      log: (line) => console.log(line),
    });
  };
}

export type MessagesLine = { off: boolean; email: string; byEmail: boolean } | { unread: true };

/**
 * The switch line for "Needs you", or null to draw nothing: for anyone but the venture's founder,
 * and on a studio that has nowhere to keep the choice or no way to send a message.
 */
export async function founderMessagesLine(venture: Pick<VentureSummary, 'id' | 'founderEmail'>, viewerEmail: string, env: Env = process.env): Promise<MessagesLine | null> {
  const founder = founderAddress(venture);
  if (!founder || founder !== viewerEmail.trim().toLowerCase()) return null;
  if (!studioDatabase(env)) return null;
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
