import { after } from 'next/server';
import { notFound } from 'next/navigation';
import { loadVentures } from '@/lib/ventures';
import { parseAdminEmails } from '@/lib/authz';
import { cardStore } from '@/lib/card-store-live';
import { handleDoor, type DoorAnswer } from '@/lib/factory-door';
import { founderMessenger } from '@/lib/founder-message-live';

/**
 * The planning box's door (FB-275): `POST /api/factory`, signed with `FACTORY_DOOR_SECRET`. Cards,
 * pictures, preview links and heartbeats come in; since FB-276 the box also collects presses here
 * and answers them, because it has no address of its own the studio could call.
 *
 * Outside the sign-in gate (`middleware.ts`), because the box has no session. So this is a public
 * address, and `handleDoor` (lib/factory-door.ts) checks the signature before it reads anything the
 * request says. The format is in `docs/factory-cards.md`.
 *
 * Until `FACTORY_DOOR_SECRET` is set, every request here is answered as an address that does not
 * exist, whatever it sends and however it asks. So production and staging stay shut until John sets
 * a secret on each.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const env = process.env;
  const ventures = loadVentures();
  const messenger = founderMessenger(env, ventures);
  const answer = await handleDoor(
    {
      secret: env.FACTORY_DOOR_SECRET,
      ventures,
      store: cardStore(env),
      org: env.GITHUB_ORG ?? 'wealthcx01',
      now: Date.now,
      log: (line) => console.log(`[factory-door] ${line}`),
      // A tap on Telegram is John's. Kept under his address so the studio names him as it names him
      // everywhere else.
      john: parseAdminEmails(env.STUDIO_ADMIN_EMAILS)[0] ?? 'john',
      // FB-279: the founder's message is sent after the box has had its answer, so a slow phone
      // service or mail server never holds the box up.
      onCard: messenger ? (ventureId, card) => after(() => messenger(ventureId, card)) : undefined,
    },
    req.headers,
    (max) => readAtMost(req, max),
  );
  return reply(answer);
}

/**
 * Anything but a POST: there is nothing to read here, so it is never anything but "not here". OPTIONS
 * too, because Next.js would otherwise answer it itself, listing POST, and so say the door is here.
 */
const nothingHere = (): Response => notFound();
export { nothingHere as GET, nothingHere as PUT, nothingHere as PATCH, nothingHere as DELETE, nothingHere as OPTIONS };

function reply(answer: DoorAnswer): Response {
  if ('closed' in answer) notFound();
  return Response.json(answer.body, { status: answer.status, headers: { 'cache-control': 'no-store' } });
}

/**
 * The body, or null if it is longer than `max`. Read a piece at a time and stopped as soon as it is
 * too long, so a request that never says how big it is cannot make the studio hold more than `max`.
 */
async function readAtMost(req: Request, max: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const pieces: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    pieces.push(value);
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of pieces) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}
