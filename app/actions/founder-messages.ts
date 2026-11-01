'use server';

import { requireVenture } from '@/lib/venture-access';
import { withVenture, NoDatabaseError } from '@/lib/db';
import { setMessagesOff } from '@/lib/founder-message-store';
import { MESSAGE_WORDS } from '@/lib/founder-message';
import { founderAddress, isFounder } from '@/lib/authz';

/**
 * A founder starting or stopping the messages about their team's work (FB-279).
 *
 * A server action is a public endpoint (FB-127), so the venture is checked against the session here,
 * and only the venture's own founder may switch: the messages are theirs alone. John, looking at the
 * venture, is refused rather than allowed to stop the founder's messages for them.
 */
export type MessagesResult = { ok: true } | { ok: false; message: string };

export async function setFounderMessages(ventureId: string, on: unknown): Promise<MessagesResult> {
  const access = await requireVenture(ventureId);
  if (!access.ok) return { ok: false, message: access.error };
  if (typeof on !== 'boolean') return { ok: false, message: MESSAGE_WORDS.failed };
  const founder = founderAddress(access.venture);
  if (!founder || !isFounder(access.venture, access.email)) return { ok: false, message: MESSAGE_WORDS.notFounder };
  try {
    await withVenture(ventureId, (q) => setMessagesOff(q, founder, !on));
    return { ok: true };
  } catch (e) {
    if (e instanceof NoDatabaseError) return { ok: false, message: MESSAGE_WORDS.noStore };
    console.error('[founder-messages] could not save the founder’s choice', { venture: ventureId, message: (e as Error).message });
    return { ok: false, message: MESSAGE_WORDS.failed };
  }
}
