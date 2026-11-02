import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync, createECDH, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { rememberPhone, phones, type Querier } from '../push-store';
import {
  CLAIM_OUTCOMES, MESSAGE_SQL, claimCardMessage, dueCardMessages, reportGivenUp, setMessagesOff, takeCardMessage,
} from '../founder-message-store';
import { MESSAGE_STATES, messageKey } from '../founder-message';
import { messageFounder, retryFounderMessages, type MessageDeps, type RetryDeps } from '../founder-message-send';
import { b64url, type PushTarget } from '../webpush';
import type { Mail, MailSettings } from '../mail';
import type { StoredCard } from '../card-store';
import { storedCard } from './review-fixtures';

/**
 * A founder hears once about their team's work (FB-279), against real Postgres under the studio's
 * own role, as `push-store.test.ts` does. Pushes go to a spy, and email to a spy: nothing leaves.
 */
const SQL = ['001_read_model.sql', '005_push.sql', '012_schema_record.sql', '014_founder_messages.sql']
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
  /** The heartbeat's retry, with the cards the studio holds now. */
  const retry = (cards: StoredCard[] = [card()], over: Partial<RetryDeps> = {}) => retryFounderMessages({
    ...deps(),
    card: async (repo, number) => cards.find((c) => c.repo === repo && c.number === number) ?? null,
    ...over,
  });
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
  return { posted, mailed, logged, deps, retry };
}

/** Ten minutes and more pass for every claim of the venture's. */
const later = (venture = 'arca') => as(venture, (q) => q.query(`update pushstore.card_messages set tried_at = tried_at - interval '11 minutes'`));

/** The same card, with one more event on its trail. */
const withEvent = (c: StoredCard, at: string): StoredCard => ({ ...c, plain: { ...c.plain, trail: [...c.plain.trail, { at, tone: 'blocked', text: 'Stopped again.' }] } });

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

  it('a finished card sent again on the same commit, with something new on its trail, sends nothing more', async () => {
    await as('arca', (q) => rememberPhone(q, ARCA_FOUNDER, phone(1)));
    const h = harness();
    expect(await messageFounder(h.deps())).toBe('notification');
    expect(await messageFounder(h.deps({ card: withEvent(card(), '2026-07-21T10:00:00.000Z') }))).toBe('already');
    expect(h.posted).toHaveLength(1);
  });

  it('a run stuck twice on the same commit sends a message each time; the same stuck card again sends nothing', async () => {
    await as('arca', (q) => rememberPhone(q, ARCA_FOUNDER, phone(1)));
    const h = harness();
    const stuck = card({ state: 'stuck' });
    expect(await messageFounder(h.deps({ card: stuck }))).toBe('notification');
    expect(await messageFounder(h.deps({ card: stuck }))).toBe('already');
    expect(await messageFounder(h.deps({ card: withEvent(stuck, '2026-07-22T08:00:00.000Z') }))).toBe('notification');
    expect(h.posted).toHaveLength(2);
  });

  it('a card with no commit still gets its message, and one more for each new event', async () => {
    await as('arca', (q) => rememberPhone(q, ARCA_FOUNDER, phone(1)));
    const h = harness();
    const noCommit = card({ headSha: '' });
    expect(await messageFounder(h.deps({ card: noCommit }))).toBe('notification');
    expect(await messageFounder(h.deps({ card: noCommit }))).toBe('already');
    expect(await messageFounder(h.deps({ card: withEvent(noCommit, '2026-07-22T08:00:00.000Z') }))).toBe('notification');
    expect(h.posted).toHaveLength(2);
  });

  it('a card with no trail is told apart by when it was sent', () => {
    const bare = card({ state: 'sent-back' });
    expect(messageKey({ ...bare, state: 'sent-back', plain: { ...bare.plain, trail: [] } }).occasion).toBe(bare.sentAt);
    expect(messageKey({ ...card(), state: 'finished' }).occasion).toBe('');
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

  it('a fault after the email went says the founder was sent it', async () => {
    const h = harness();
    let calls = 0;
    const run: MessageDeps['run'] = (fn) => (++calls === 2 ? Promise.reject(new Error('the database went away')) : as(ARCA.id, fn));
    expect(await messageFounder(h.deps({ keys: null, run }))).toBe('email');
    expect(h.mailed).toHaveLength(1);
    expect(h.logged).toEqual(['[founder-messages] arca arca#21 finished: the founder was sent an email, but that could not be written down, so it may be sent again: the database went away']);
  });

  it('logs name no address', async () => {
    const h = harness();
    await messageFounder(h.deps({ mail: null }));
    await messageFounder(h.deps({ card: card({ headSha: '1'.repeat(40) }), send: async () => 'failed' }));
    expect(h.logged.join('\n')).not.toMatch(/@/);
  });
});

describe('the database and the code list the same states and outcomes', () => {
  // A state or outcome the database refuses would make every claim fail, and the founder hear nothing.
  const claim = (n: number, state: string, outcome: string) =>
    as('arca', (q) => q.query(MESSAGE_SQL.claim, ['wealthcx01/arca', n, state, 'a'.repeat(40), '', ARCA_FOUNDER, outcome]));

  it('accepts every state and outcome the code can write', async () => {
    let n = 0;
    for (const state of MESSAGE_STATES) {
      for (const outcome of CLAIM_OUTCOMES) {
        expect((await claim(++n, state, outcome)).rows).toHaveLength(1);
      }
    }
  });

  it('refuses a state or an outcome the code does not know', async () => {
    await expect(claim(1, 'done', 'pending')).rejects.toThrow(/check constraint/);
    await expect(claim(2, 'finished', 'sent')).rejects.toThrow(/check constraint/);
  });
});

describe('a message that did not go is tried again on a heartbeat', () => {
  it('a message lost in a restart, between the claim and the send, is sent once, ten minutes on', async () => {
    await as('arca', (q) => rememberPhone(q, ARCA_FOUNDER, phone(1)));
    await as('arca', (q) => claimCardMessage(q, messageKey({ ...card(), state: 'finished' }), ARCA_FOUNDER)); // and then the studio stopped
    const h = harness();
    expect(await h.retry()).toEqual([]); // not ten minutes yet
    await later();
    expect(await h.retry()).toEqual(['notification']);
    await later();
    expect(await h.retry()).toEqual([]);
    expect(h.posted).toEqual(['https://fcm.googleapis.com/fcm/send/phone-1']);
    expect(h.mailed).toEqual([]); // never both
  });

  it('one that could not be sent is tried three times in all, then given up with its reason, and reported once', async () => {
    const h = harness();
    const failing = { keys: null, mail: null };
    expect(await messageFounder(h.deps(failing))).toBe('none');
    await later();
    expect(await h.retry(undefined, failing)).toEqual(['none']);
    await later();
    expect(await h.retry(undefined, failing)).toEqual(['given-up']);
    await later();
    expect(await h.retry(undefined, failing)).toEqual([]);
    const rows = await as('arca', (q) => q.query('select outcome, attempts, why from pushstore.card_messages'));
    expect(rows.rows).toEqual([{ outcome: 'given-up', attempts: 3, why: 'this studio cannot send notifications, and this studio has no email settings, so no email was sent.' }]);

    expect(await as('arca', (q) => reportGivenUp(q))).toEqual([
      { repo: 'arca', number: 21, state: 'finished', why: 'this studio cannot send notifications, and this studio has no email settings, so no email was sent.' },
    ]);
    expect(await as('arca', (q) => reportGivenUp(q))).toEqual([]);
  });

  it('a later try that works sends it, and only then', async () => {
    await as('arca', (q) => rememberPhone(q, ARCA_FOUNDER, phone(1)));
    const h = harness();
    expect(await messageFounder(h.deps({ keys: null, mail: null }))).toBe('none');
    await later();
    expect(await h.retry()).toEqual(['notification']);
    expect(h.posted).toHaveLength(1);
    expect(await outcomes('arca')).toEqual([{ state: 'finished', outcome: 'notification' }]);
  });

  it('two heartbeats at once can take it only once', async () => {
    await messageFounder(harness().deps({ keys: null, mail: null }));
    await later();
    const [due] = await as('arca', (q) => dueCardMessages(q));
    expect(await as('arca', (q) => takeCardMessage(q, due))).toBe(2);
    expect(await as('arca', (q) => takeCardMessage(q, due))).toBeNull();
  });

  it('a card that has moved on is marked outdated, and nothing is sent', async () => {
    await as('arca', (q) => rememberPhone(q, ARCA_FOUNDER, phone(1)));
    const h = harness();
    await messageFounder(h.deps({ keys: null, mail: null }));
    await later();
    expect(await h.retry([card({ headSha: 'n'.repeat(40) })])).toEqual(['outdated']);
    expect([...h.posted, ...h.mailed]).toEqual([]);
    expect(await outcomes('arca')).toEqual([{ state: 'finished', outcome: 'outdated' }]);
  });

  it('a stuck card with a new event since is outdated too: the new event has its own message', async () => {
    const h = harness();
    const stuck = card({ state: 'stuck' });
    await messageFounder(h.deps({ card: stuck, keys: null, mail: null }));
    await later();
    expect(await h.retry([withEvent(stuck, '2026-07-22T08:00:00.000Z')])).toEqual(['outdated']);
  });

  it('a founder who has stopped messages since gets nothing', async () => {
    const h = harness();
    await messageFounder(h.deps({ keys: null, mail: null }));
    await as('arca', (q) => setMessagesOff(q, ARCA_FOUNDER, true));
    await later();
    expect(await h.retry()).toEqual(['off']);
    expect([...h.posted, ...h.mailed]).toEqual([]);
  });

  it('goes only to the manifest’s founder: a claim for anybody else is outdated', async () => {
    const h = harness();
    await messageFounder(h.deps({ keys: null, mail: null, venture: { ...ARCA, founderEmail: ROSS } }));
    await later();
    expect(await h.retry()).toEqual(['outdated']);
    expect(h.mailed).toEqual([]);
  });

  it('a third try cut off by a restart is given up, not left waiting for ever', async () => {
    await messageFounder(harness().deps({ keys: null, mail: null }));
    await as('arca', (q) => q.query(`update pushstore.card_messages set attempts = 3, outcome = 'pending'`));
    await later();
    const h = harness();
    expect(await h.retry()).toEqual(['given-up']);
    expect([...h.posted, ...h.mailed]).toEqual([]);
    expect((await as('arca', (q) => reportGivenUp(q)))[0].why).toBe('the studio stopped before it finished sending it');
  });

  it('only this venture’s messages are tried, and only its own are reported', async () => {
    await messageFounder(harness().deps({ keys: null, mail: null }));
    await later();
    expect(await as('the-reset', (q) => dueCardMessages(q))).toEqual([]);
    await as('arca', (q) => q.query(`update pushstore.card_messages set outcome = 'given-up'`));
    expect(await as('the-reset', (q) => reportGivenUp(q))).toEqual([]);
  });

  it('reports at most the number asked for, the rest on a later heartbeat', async () => {
    for (let n = 1; n <= 3; n += 1) await messageFounder(harness().deps({ keys: null, mail: null, card: card({ number: n }) }));
    await as('arca', (q) => q.query(`update pushstore.card_messages set outcome = 'given-up'`));
    expect(await as('arca', (q) => reportGivenUp(q, 2))).toHaveLength(2);
    expect(await as('arca', (q) => reportGivenUp(q, 2))).toHaveLength(1);
  });

  it('a why never names an address', async () => {
    const h = harness();
    await messageFounder(h.deps({ mail: null }));
    await messageFounder(h.deps({ card: card({ number: 2 }), send: async () => 'failed' }));
    const whys = (await as('arca', (q) => q.query<{ why: string }>('select why from pushstore.card_messages'))).rows.map((r) => r.why);
    expect(whys).toHaveLength(2);
    expect(whys.join('\n')).not.toMatch(/@/);
  });
});

describe('the schema file, loaded over its first version', () => {
  // A preview may have loaded the first version of db/014 into staging's database. Loading this one
  // over it, twice, must bring it up to date and keep what it held.
  const FIRST = `
    create schema if not exists pushstore;
    create table if not exists pushstore.card_messages (
      venture_id  text not null,
      repo        text not null,
      number      integer not null,
      state       text not null check (state in ('finished', 'stuck', 'sent-back')),
      head_sha    text not null,
      email       text not null,
      outcome     text not null default 'pending'
                  check (outcome in ('pending', 'notification', 'email', 'none', 'off')),
      created_at  timestamptz not null default now(),
      primary key (venture_id, repo, number, state, head_sha)
    );
    create table if not exists pushstore.messages_off (
      venture_id  text not null,
      email       text not null,
      since       timestamptz not null default now(),
      primary key (venture_id, email)
    );
    alter table pushstore.card_messages enable row level security;
    alter table pushstore.card_messages force row level security;
    insert into pushstore.card_messages (venture_id, repo, number, state, head_sha, email, outcome)
      values ('arca', 'arca', 9, 'stuck', 'sha-9', 'arca.founder@bruntsfield.capital', 'notification');`;
  const before = ['001_read_model.sql', '005_push.sql', '012_schema_record.sql'].map((f) => readFileSync(join(process.cwd(), 'db', f), 'utf8')).join('\n');
  const now = readFileSync(join(process.cwd(), 'db', '014_founder_messages.sql'), 'utf8');

  beforeEach(async () => {
    db = await PGlite.create();
    await db.exec(before);
    await db.exec(FIRST);
    await db.exec(now);
    await db.exec(now);
    await db.exec('set role foundry_studio');
  });

  it('keeps the old rows, and lets a second stuck on the same commit be its own message', async () => {
    expect((await as('arca', (q) => q.query('select number, occasion, attempts, outcome from pushstore.card_messages'))).rows)
      .toEqual([{ number: 9, occasion: '', attempts: 1, outcome: 'notification' }]);
    const key = { repo: 'arca', number: 9, state: 'stuck' as const, headSha: 'sha-9' };
    expect(await as('arca', (q) => claimCardMessage(q, { ...key, occasion: '2026-11-01T10:00:00.000Z' }, ARCA_FOUNDER))).toBe('claimed');
    expect(await as('arca', (q) => claimCardMessage(q, { ...key, occasion: '2026-11-01T10:00:00.000Z' }, ARCA_FOUNDER))).toBe('already');
  });

  it('takes the new outcomes and still refuses unknown ones', async () => {
    const claim = (n: number, outcome: string) =>
      as('arca', (q) => q.query(MESSAGE_SQL.claim, ['arca', n, 'finished', 'a', '', ARCA_FOUNDER, outcome]));
    expect((await claim(1, 'given-up')).rows).toHaveLength(1);
    expect((await claim(2, 'outdated')).rows).toHaveLength(1);
    await expect(claim(3, 'sent')).rejects.toThrow(/check constraint/);
  });

  it('keeps every venture’s rows apart, as strictly as before', async () => {
    expect((await as('the-reset', (q) => q.query('select * from pushstore.card_messages'))).rows).toEqual([]);
    await expect(as('arca', (q) => q.query(
      `insert into pushstore.card_messages (venture_id, repo, number, state, head_sha, email) values ('the-reset', 'x', 1, 'stuck', 'a', 'x')`,
    ))).rejects.toThrow(/row-level security/);
    const forced = await db.query<{ relforcerowsecurity: boolean }>(`select relforcerowsecurity from pg_class where oid = 'pushstore.card_messages'::regclass`);
    expect(forced.rows[0].relforcerowsecurity).toBe(true);
  });
});
