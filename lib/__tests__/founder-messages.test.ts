import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync, createECDH, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { rememberPhone, phones, type Querier } from '../push-store';
import { setMessagesOff } from '../founder-message-store';
import { messageFounder, type MessageDeps } from '../founder-message-send';
import { b64url, type PushTarget } from '../webpush';
import type { Mail, MailSettings } from '../mail';
import type { StoredCard } from '../card-store';
import { storedCard } from './review-fixtures';

/**
 * A founder hears once about their team's work (FB-279), against real Postgres under the studio's
 * own role, as `push-store.test.ts` does. Pushes go to a spy, and email to a spy: nothing leaves.
 */
const SQL = ['001_read_model.sql', '005_push.sql', '011_founder_messages.sql']
  .map((f) => readFileSync(join(process.cwd(), 'db', f), 'utf8')).join('\n');

const ARCA = { id: 'arca', name: 'ARCA', founderEmail: 'Arca.Founder@bruntsfield.capital' };
const ARCA_FOUNDER = 'arca.founder@bruntsfield.capital';
const JOHN = 'john@bruntsfield.capital';
const ROSS = 'ross@bruntsfield.capital';
const MAIL: MailSettings = { host: 'smtp.gmail.com', port: 465, user: JOHN, pass: 'x', from: 'Foundry Studio <john@bruntsfield.capital>' };

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
const KEYS = vapid();

let db: PGlite;
beforeEach(async () => {
  db = await PGlite.create();
  await db.exec(SQL);
  await db.exec('set role foundry_studio');
});

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

const card = (over: Partial<StoredCard> = {}): StoredCard => ({ ...storedCard('arca', 21), ...over });

/** One run of the messenger, with every outside effect caught. */
function harness(status = 201) {
  const posted: string[] = [];
  const mailed: Mail[] = [];
  const logged: string[] = [];
  const deps = (over: Partial<MessageDeps> = {}): MessageDeps => ({
    venture: ARCA,
    card: card(),
    run: (fn) => as(ARCA.id, fn),
    keys: KEYS,
    mail: MAIL,
    studioUrl: 'https://studio.example',
    post: async (url) => { posted.push(url); return { status }; },
    send: async (_settings, mail) => { mailed.push(mail); return 'sent'; },
    log: (line) => logged.push(line),
    ...over,
  });
  return { posted, mailed, logged, deps };
}

async function subscribeEveryone() {
  await as('arca', (q) => rememberPhone(q, ARCA_FOUNDER, phone(1)));
  await as('arca', (q) => rememberPhone(q, JOHN, phone(2))); // John, looking at ARCA
  await as('the-reset', (q) => rememberPhone(q, ROSS, phone(3)));
}

const outcomes = async (venture: string) =>
  (await as(venture, (q) => q.query<{ state: string; outcome: string }>('select state, outcome from pushstore.card_messages order by created_at'))).rows;

describe('a finished ARCA card', () => {
  it('sends exactly one message, to ARCA’s founder, and none to anyone else', async () => {
    await subscribeEveryone();
    const h = harness();
    expect(await messageFounder(h.deps())).toBe('notification');
    expect(h.posted).toEqual(['https://fcm.googleapis.com/fcm/send/phone-1']);
    expect(h.mailed).toEqual([]);
    expect(await outcomes('arca')).toEqual([{ state: 'finished', outcome: 'notification' }]);
  });

  it('with no phone of the founder’s, arrives as an email instead', async () => {
    await as('arca', (q) => rememberPhone(q, JOHN, phone(2)));
    const h = harness();
    expect(await messageFounder(h.deps())).toBe('email');
    expect(h.posted).toEqual([]);
    expect(h.mailed).toHaveLength(1);
    expect(h.mailed[0]).toMatchObject({ to: ARCA_FOUNDER, from: MAIL.from, subject: 'ARCA: your team finished something' });
    expect(h.mailed[0].text).toContain('https://studio.example/venture/arca/review/arca/21');
    expect(await outcomes('arca')).toEqual([{ state: 'finished', outcome: 'email' }]);
  });

  it('a phone that has gone, or that refused, falls back to email; a delivered one never does', async () => {
    await as('arca', (q) => rememberPhone(q, ARCA_FOUNDER, phone(1)));
    const gone = harness(410);
    expect(await messageFounder(gone.deps())).toBe('email');
    expect(gone.mailed).toHaveLength(1);
    expect(await as('arca', phones)).toEqual([]);

    await as('arca', (q) => rememberPhone(q, ARCA_FOUNDER, phone(1)));
    const refused = harness(500);
    expect(await messageFounder(refused.deps({ card: card({ headSha: 'b'.repeat(40) }) }))).toBe('email');
    expect(refused.mailed).toHaveLength(1);

    const delivered = harness(201);
    expect(await messageFounder(delivered.deps({ card: card({ headSha: 'c'.repeat(40) }) }))).toBe('notification');
    expect(delivered.mailed).toEqual([]);
  });

  it('with no way to push, goes by email', async () => {
    await as('arca', (q) => rememberPhone(q, ARCA_FOUNDER, phone(1)));
    const h = harness();
    expect(await messageFounder(h.deps({ keys: null }))).toBe('email');
    expect(h.posted).toEqual([]);
    expect(h.mailed).toHaveLength(1);
  });
});

describe('a founder never hears about another venture', () => {
  it('an ARCA card never reaches The Reset’s phone or Ross’s address', async () => {
    await subscribeEveryone();
    const pushed = harness();
    await messageFounder(pushed.deps());
    const mailed = harness();
    await messageFounder(mailed.deps({ keys: null, card: card({ headSha: 'd'.repeat(40) }) }));
    const everything = [...pushed.posted, ...mailed.posted, ...pushed.mailed.map((m) => m.to), ...mailed.mailed.map((m) => m.to)];
    expect(everything).not.toContain('https://fcm.googleapis.com/fcm/send/phone-3');
    expect(everything).not.toContain(ROSS);
    expect(await outcomes('the-reset')).toEqual([]);
  });

  it('cowgate’s own cards message nobody, and claim nothing', async () => {
    await subscribeEveryone();
    const h = harness();
    expect(await messageFounder(h.deps({ venture: { id: '_factory', name: 'The factory', founderEmail: ARCA_FOUNDER }, run: (fn) => as('_factory', fn) }))).toBe('not-a-message');
    expect(h.posted).toEqual([]);
    expect(h.mailed).toEqual([]);
    expect(await outcomes('_factory')).toEqual([]);
  });

  it('a card in any other state messages nobody', async () => {
    await subscribeEveryone();
    for (const state of ['done', 'failed', 'needs-you'] as const) {
      const h = harness();
      expect(await messageFounder(h.deps({ card: card({ state }) }))).toBe('not-a-message');
      expect([...h.posted, ...h.mailed]).toEqual([]);
    }
  });

  it('rows kept under ARCA cannot be seen under The Reset', async () => {
    await messageFounder(harness().deps({ keys: null }));
    await as('arca', (q) => setMessagesOff(q, ARCA_FOUNDER, true));
    const seen = await as('the-reset', async (q) => [
      ...(await q.query('select * from pushstore.card_messages')).rows,
      ...(await q.query('select * from pushstore.messages_off')).rows,
    ]);
    expect(seen).toEqual([]);
    await expect(as('arca', (q) => q.query(
      `insert into pushstore.messages_off (venture_id, email) values ('the-reset', 'x')`,
    ))).rejects.toThrow(/row-level security/);
  });
});

describe('exactly once', () => {
  it('the same card again sends nothing more; a new version sends one more', async () => {
    await as('arca', (q) => rememberPhone(q, ARCA_FOUNDER, phone(1)));
    const h = harness();
    expect(await messageFounder(h.deps())).toBe('notification');
    expect(await messageFounder(h.deps())).toBe('already');
    expect(await messageFounder(h.deps({ card: card({ headSha: 'e'.repeat(40) }) }))).toBe('notification');
    expect(h.posted).toHaveLength(2);
  });

  it('stuck, then finished, on the same commit sends two messages in all', async () => {
    await as('arca', (q) => rememberPhone(q, ARCA_FOUNDER, phone(1)));
    const h = harness();
    await messageFounder(h.deps({ card: card({ state: 'stuck' }) }));
    await messageFounder(h.deps({ card: card({ state: 'finished' }) }));
    await messageFounder(h.deps({ card: card({ state: 'finished' }) }));
    expect(h.posted).toHaveLength(2);
  });
});

describe('the founder’s switch', () => {
  it('off means nothing is pushed or emailed, and turning it back on does not send old cards', async () => {
    await as('arca', (q) => rememberPhone(q, ARCA_FOUNDER, phone(1)));
    await as('arca', (q) => setMessagesOff(q, 'ARCA.founder@bruntsfield.capital', true));
    const h = harness();
    expect(await messageFounder(h.deps())).toBe('off');
    expect([...h.posted, ...h.mailed]).toEqual([]);
    expect(await outcomes('arca')).toEqual([{ state: 'finished', outcome: 'off' }]);

    await as('arca', (q) => setMessagesOff(q, ARCA_FOUNDER, false));
    expect(await messageFounder(h.deps())).toBe('already');
    expect(await messageFounder(h.deps({ card: card({ headSha: 'f'.repeat(40) }) }))).toBe('notification');
  });

  it('stopping twice, or starting when on, is harmless', async () => {
    await as('arca', (q) => setMessagesOff(q, ARCA_FOUNDER, true));
    await as('arca', (q) => setMessagesOff(q, ARCA_FOUNDER, true));
    await as('arca', (q) => setMessagesOff(q, ARCA_FOUNDER, false));
    await as('arca', (q) => setMessagesOff(q, ARCA_FOUNDER, false));
    expect(await messageFounder(harness().deps({ keys: null }))).toBe('email');
  });
});

describe('when it cannot send', () => {
  it('with no email settings, says so in one line, sends nothing, and does not fail', async () => {
    const h = harness();
    expect(await messageFounder(h.deps({ mail: null }))).toBe('none');
    expect(h.mailed).toEqual([]);
    expect(h.logged).toEqual(['[founder-messages] arca arca#21 finished: no notification was delivered, and this studio has no email settings, so no email was sent.']);
    expect(await outcomes('arca')).toEqual([{ state: 'finished', outcome: 'none' }]);
  });

  it('with no https address for the link, sends no email', async () => {
    const h = harness();
    expect(await messageFounder(h.deps({ studioUrl: 'http://localhost:3000' }))).toBe('none');
    expect(h.mailed).toEqual([]);
  });

  it('a venture whose manifest names no founder messages nobody, and says so', async () => {
    await subscribeEveryone();
    const h = harness();
    expect(await messageFounder(h.deps({ venture: { ...ARCA, founderEmail: null } }))).toBe('no-founder');
    expect([...h.posted, ...h.mailed]).toEqual([]);
    expect(h.logged).toHaveLength(1);
    expect(h.logged[0]).toMatch(/names no founder/);
  });

  it('a fault is one line and never thrown', async () => {
    const h = harness();
    const r = await messageFounder(h.deps({ run: async () => { throw new Error('the database went away'); } }));
    expect(r).toBe('none');
    expect(h.logged).toEqual(['[founder-messages] arca arca#21 finished: no message was sent: the database went away']);
  });

  it('logs name no address', async () => {
    const h = harness();
    await messageFounder(h.deps({ mail: null }));
    await messageFounder(h.deps({ card: card({ headSha: '1'.repeat(40) }), send: async () => 'failed' }));
    expect(h.logged.join('\n')).not.toMatch(/@/);
  });
});
