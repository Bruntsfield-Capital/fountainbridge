import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync, createECDH, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { rememberPhone, forgetPhone, phones, type Querier } from '../push-store';
import { checkQueue } from '../push-send';
import { b64url, type PushTarget } from '../webpush';

/**
 * Phones and pushes, against real Postgres (FB-141).
 *
 * PGlite is PostgreSQL in-process, with the same row-level security. The connection drops to
 * `foundry_studio` — the role the studio actually connects as, with exactly the grants 005 gives it —
 * because a superuser reads straight through every policy and the isolation tests would pass for the
 * wrong reason (FB-170's note).
 */
const SQL = ['001_read_model.sql', '005_push.sql']
  .map((f) => readFileSync(join(process.cwd(), 'db', f), 'utf8')).join('\n');

/** A phone with real keys, so the sender can genuinely encrypt for it. */
function phone(n: number): PushTarget {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/phone-${n}`,
    keys: { p256dh: b64url.encode(ecdh.getPublicKey()), auth: b64url.encode(randomBytes(16)) },
  };
}

function vapid() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pub = publicKey.export({ format: 'jwk' });
  return {
    publicKey: b64url.encode(Buffer.concat([Buffer.from([4]), b64url.decode(pub.x!), b64url.decode(pub.y!)])),
    privateKey: privateKey.export({ format: 'jwk' }).d!,
    subject: 'mailto:studio@bruntsfield.capital',
  };
}

let db: PGlite;
beforeEach(async () => {
  db = await PGlite.create();
  await db.exec(SQL);
  await db.exec('set role foundry_studio');
});

/** The same thing `withVenture` does: one transaction, scoped to one venture. */
async function as<T>(venture: string, fn: (q: Querier) => Promise<T>): Promise<T> {
  await db.exec('begin');
  await db.query('select set_config($1, $2, true)', ['app.venture_id', venture]);
  try {
    const out = await fn(db as unknown as Querier);
    await db.exec('commit');
    return out;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
}

describe('a phone belongs to one venture', () => {
  it('a venture sees its own phones and nobody else’s', async () => {
    const mine = phone(1);
    const theirs = phone(2);
    await as('arca', (q) => rememberPhone(q, 'arca.founder@bruntsfield.capital', mine));
    await as('the-reset', (q) => rememberPhone(q, 'ross@bruntsfield.capital', theirs));

    expect((await as('arca', phones)).map((p) => p.endpoint)).toEqual([mine.endpoint]);
    expect((await as('the-reset', phones)).map((p) => p.endpoint)).toEqual([theirs.endpoint]);
  });

  it('a connection that names no venture sees no phones at all', async () => {
    await as('arca', (q) => rememberPhone(q, 'a@bruntsfield.capital', phone(1)));
    const { rows } = await db.query('select * from pushstore.subscriptions');
    expect(rows).toEqual([]);
  });

  it('cannot write a phone under another venture, even by naming it', async () => {
    await expect(as('arca', (q) => q.query(
      `insert into pushstore.subscriptions (venture_id, email, endpoint, p256dh, auth) values ('the-reset','x','https://fcm.googleapis.com/x','k','a')`,
    ))).rejects.toThrow(/row-level security/);
  });

  it('turning it off removes it, and only from this venture', async () => {
    const p = phone(1);
    await as('arca', (q) => rememberPhone(q, 'a@bruntsfield.capital', p));
    await as('the-reset', (q) => rememberPhone(q, 'a@bruntsfield.capital', p)); // same phone, two ventures
    await as('arca', (q) => forgetPhone(q, p.endpoint));
    expect(await as('arca', phones)).toEqual([]);
    expect((await as('the-reset', phones)).length).toBe(1);
  });

  it('refuses an endpoint that is not https', async () => {
    await expect(as('arca', (q) => rememberPhone(q, 'a@b', { ...phone(1), endpoint: 'http://fcm.googleapis.com/x' })))
      .rejects.toThrow(/endpoint_is_https/);
  });
});

describe('the one push, end to end', () => {
  const ARCA = { id: 'arca', name: 'ARCA' };
  const THE_RESET = { id: 'the-reset', name: 'The Reset' };

  it('buzzes once on zero → something, and never for the first look or the items after', async () => {
    const keys = vapid();
    const posted: string[] = [];
    const post = async (url: string) => { posted.push(url); return { status: 201 }; };
    await as('arca', (q) => rememberPhone(q, 'a@bruntsfield.capital', phone(1)));

    // First look: six waiting, a week-old backlog. Not a push.
    expect((await as('arca', (q) => checkQueue(q, ARCA, 6, keys, { post }))).sent).toBe(0);
    // Cleared.
    await as('arca', (q) => checkQueue(q, ARCA, 0, keys, { post }));
    // Became the blocker: one push.
    expect((await as('arca', (q) => checkQueue(q, ARCA, 1, keys, { post }))).sent).toBe(1);
    // More arrives in the same run: silence.
    expect((await as('arca', (q) => checkQueue(q, ARCA, 9, keys, { post }))).sent).toBe(0);
    expect(posted).toHaveLength(1);
  });

  it('a push for one venture never reaches a phone that only subscribed to another', async () => {
    const keys = vapid();
    const posted: string[] = [];
    const post = async (url: string) => { posted.push(url); return { status: 201 }; };
    const resetPhone = phone(7);
    await as('the-reset', (q) => rememberPhone(q, 'ross@bruntsfield.capital', resetPhone));
    await as('arca', (q) => rememberPhone(q, 'a@bruntsfield.capital', phone(1)));

    await as('arca', (q) => checkQueue(q, ARCA, 0, keys, { post }));
    await as('arca', (q) => checkQueue(q, ARCA, 3, keys, { post }));
    expect(posted).toEqual(['https://fcm.googleapis.com/fcm/send/phone-1']);
    expect(posted).not.toContain(resetPhone.endpoint);
    // And the other venture's queue has its own memory: ARCA's history is not a first look for it.
    expect((await as('the-reset', (q) => checkQueue(q, THE_RESET, 2, keys, { post }))).before).toBeNull();
  });

  it('an unreadable queue is not zero, so the next good read cannot fake a transition', async () => {
    const keys = vapid();
    const post = async () => ({ status: 201 });
    await as('arca', (q) => rememberPhone(q, 'a@bruntsfield.capital', phone(1)));
    await as('arca', (q) => checkQueue(q, ARCA, 4, keys, { post }));
    await as('arca', (q) => checkQueue(q, ARCA, null, keys, { post })); // GitHub hiccupped
    expect((await as('arca', (q) => checkQueue(q, ARCA, 4, keys, { post }))).sent).toBe(0);
  });

  it('removes a phone that has unsubscribed itself', async () => {
    const keys = vapid();
    await as('arca', (q) => rememberPhone(q, 'a@bruntsfield.capital', phone(1)));
    await as('arca', (q) => checkQueue(q, ARCA, 0, keys));
    const r = await as('arca', (q) => checkQueue(q, ARCA, 2, keys, { post: async () => ({ status: 410 }) }));
    expect(r.removed).toBe(1);
    expect(await as('arca', phones)).toEqual([]);
  });
});

describe('nothing else ever pushes', () => {
  it('sendWebPush is called from exactly one file', () => {
    // The design's rule is one event. The easiest way to break it is a well-meant second caller —
    // "your lane finished", a digest — so any new caller anywhere in the app fails this test.
    // FB-279's card messages are sent from lib/push-send.ts too, beside the blocker buzz.
    const roots = ['app', 'lib', 'components'];
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); continue; }
        if (!/\.(ts|tsx|js|mjs)$/.test(e.name)) continue;
        if (/sendWebPush\s*\(/.test(readFileSync(p, 'utf8'))) callers.push(p);
      }
    };
    roots.forEach((r) => walk(join(process.cwd(), r)));
    expect(callers.sort()).toEqual(['lib/push-send.ts', 'lib/webpush.ts'].map((f) => join(process.cwd(), f)));
  });

  it('the service worker shows only what the server sent, and does nothing else on a push', () => {
    const sw = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8');
    expect(sw.match(/showNotification\(/g)).toHaveLength(1);
  });
});
