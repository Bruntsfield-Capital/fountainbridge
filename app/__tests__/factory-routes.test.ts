import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signatureFor } from '@/lib/factory-door';

/**
 * FB-275: the door and the picture route, as Next.js calls them.
 *
 * The door, with no secret set, must answer as an address that does not exist, for every way of
 * asking. The picture route must give a founder nothing of another venture's, by any address, and
 * the same nothing as a picture that does not exist. Only the sign-in is a stand-in here.
 */

const auth = vi.fn();
vi.mock('@/auth', () => ({ auth: () => auth() }));

const door = await import('../api/factory/route');
const pictureRoute = await import('../venture/[id]/review/[repo]/[number]/picture/[name]/route');
const { cardStore } = await import('@/lib/card-store-live');
const { putTestCards, testPng } = await import('@/lib/__tests__/review-fixtures');

const SECRET = 'route-test-secret';
const FOUNDER = 'arca.founder@bruntsfield.capital';
const JOHN = 'john.gallagher@wealthcx.com';

/** What Next.js's `notFound()` throws: the same 404 as an address with no route behind it. */
const NOT_FOUND = expect.objectContaining({ digest: expect.stringMatching(/404/) });

function signed(body: string, secret = SECRET): Request {
  const ts = String(Math.floor(Date.now() / 1000));
  return new Request('http://studio.test/api/factory', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'x-factory-timestamp': ts, 'x-factory-signature': signatureFor(secret, ts, body) },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DATABASE_URL;
  Object.assign(process.env, { E2E_TEST_LOGIN: '1', STUDIO_ADMIN_EMAILS: JOHN });
});
afterEach(() => {
  for (const k of ['E2E_TEST_LOGIN', 'STUDIO_ADMIN_EMAILS', 'FACTORY_DOOR_SECRET']) delete process.env[k];
});

describe('the door, with no secret set', () => {
  it.each([[undefined], ['']])('answers every request as a missing address (secret %j)', async (secret) => {
    if (secret === undefined) delete process.env.FACTORY_DOOR_SECRET;
    else process.env.FACTORY_DOOR_SECRET = secret;
    await expect(door.POST(signed('{"kind":"heartbeat"}'))).rejects.toEqual(NOT_FOUND);
    await expect(door.POST(new Request('http://studio.test/api/factory', { method: 'POST', body: 'x' }))).rejects.toEqual(NOT_FOUND);
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const) {
      expect(() => door[method]()).toThrow(expect.objectContaining({ digest: expect.stringMatching(/404/) }));
    }
  });
});

describe('the door, with a secret set', () => {
  beforeEach(() => {
    process.env.FACTORY_DOOR_SECRET = SECRET;
  });

  it('takes a signed heartbeat', async () => {
    const r = await door.POST(signed('{"kind":"heartbeat"}'));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, message: 'Heard.', givenUp: [] });
  });

  it('stops reading a body that never said how long it is, once it is too long', async () => {
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        sent += 1;
        c.enqueue(new Uint8Array(1024 * 1024));
        if (sent > 50) c.close();
      },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const r = await door.POST(new Request('http://studio.test/api/factory', {
      method: 'POST', body: endless, duplex: 'half',
      headers: { 'x-factory-timestamp': ts, 'x-factory-signature': `sha256=${'0'.repeat(64)}` },
    } as RequestInit));
    expect(r.status).toBe(413);
    expect(sent).toBeLessThan(10);
  });
});

describe("the picture route gives a founder nothing of another venture's", () => {
  const get = (path: string) => {
    const [id, repo, number, name] = path.split('/');
    return pictureRoute.GET(new Request(`http://studio.test/venture/${path}`), { params: Promise.resolve({ id, repo, number, name }) });
  };

  beforeEach(async () => {
    const store = cardStore()!;
    await putTestCards(store);
    const png = testPng(393, 851);
    for (const [v, repo, n, sha] of [['arca', 'arca', 21, 'sha-arca-21'], ['the-reset', 'thereset-platform', 5, 'sha-thereset-platform-5']] as const) {
      await store.putPicture(v, repo, n, { name: 'after-phone', headSha: sha, width: 393, height: 851, takenAt: '2026-07-21T09:15:00.000Z', bytes: png });
    }
  });

  it("serves ARCA's founder ARCA's picture, as a PNG that is never cached", async () => {
    auth.mockResolvedValue({ user: { email: FOUNDER } });
    const r = await get('arca/arca/21/after-phone');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(r.headers.get('cache-control')).toBe('private, no-store');
  });

  it("answers THE RESET's picture, by every address, exactly as a picture that does not exist", async () => {
    auth.mockResolvedValue({ user: { email: FOUNDER } });
    const answers = await Promise.all([
      get('the-reset/thereset-platform/5/after-phone'), // THE RESET's own address
      get('arca/thereset-platform/5/after-phone'), // THE RESET's card, under ARCA
      get('arca/arca/999/after-phone'), // a card that does not exist
      get('arca/arca/21/../../etc'), // not a picture's name
    ]);
    const said = await Promise.all(answers.map(async (r) => [r.status, await r.text()]));
    expect(said).toEqual(Array(4).fill([404, 'That picture is not here.']));
  });

  it('John reaches both', async () => {
    auth.mockResolvedValue({ user: { email: JOHN } });
    expect((await get('arca/arca/21/after-phone')).status).toBe(200);
    expect((await get('the-reset/thereset-platform/5/after-phone')).status).toBe(200);
  });

  it('nobody signed in gets nothing', async () => {
    auth.mockResolvedValue(null);
    expect((await get('arca/arca/21/after-phone')).status).toBe(401);
  });
});
