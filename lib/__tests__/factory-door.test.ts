import { describe, expect, it, vi } from 'vitest';
import {
  MAX_BODY_BYTES, MAX_CARD_BYTES, MAX_PICTURE_BYTES, SIGNATURE_HEADER, TIMESTAMP_HEADER, handleDoor, pngSize, signatureFor,
  type DoorAnswer, type DoorDeps,
} from '../factory-door';
import { memoryCardStore, type CardStore } from '../card-store';
import { PLAIN_PARTS } from '../review';
import type { VentureSummary } from '../ventures';
import { sentCard, testPng } from './review-fixtures';

/**
 * FB-275: the planning box's door. Every way in that is not the box, signed, now, about a repository
 * a venture lists, is refused, and nothing is kept.
 */

const SECRET = 'door-test-secret';
const JOHN = 'john.gallagher@wealthcx.com';
const NOW = Date.parse('2026-11-04T09:00:00Z');
const VENTURES = [
  { id: 'arca', name: 'ARCA', repos: ['arca', 'arca-marketing'], departments: [] },
  { id: 'the-reset', name: 'THE RESET', repos: ['thereset-platform'], departments: [] },
] as unknown as VentureSummary[];

function setUp(patch: Partial<DoorDeps> = {}) {
  const store = memoryCardStore(() => new Date(NOW));
  const logged: string[] = [];
  const deps: DoorDeps = { secret: SECRET, ventures: VENTURES, store, org: 'wealthcx01', now: () => NOW, log: (l) => logged.push(l), john: JOHN, ...patch };
  return { deps, store: (patch.store === undefined ? store : patch.store) as CardStore, logged };
}

/** Send `body` the way the box does. `sign` changes what is signed or sent, to forge it. */
async function send(
  deps: DoorDeps,
  body: unknown,
  sign: { secret?: string; at?: number; headers?: Record<string, string>; read?: (max: number) => Promise<Uint8Array | null> } = {},
): Promise<DoorAnswer> {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const bytes = new TextEncoder().encode(text);
  const ts = String(Math.floor((sign.at ?? NOW) / 1000));
  const headers = new Map(Object.entries({
    [TIMESTAMP_HEADER]: ts,
    [SIGNATURE_HEADER]: signatureFor(sign.secret ?? SECRET, ts, bytes),
    'content-length': String(bytes.byteLength),
    ...sign.headers,
  }));
  return handleDoor(deps, { get: (n) => headers.get(n) ?? null }, sign.read ?? (async (max) => (bytes.byteLength > max ? null : bytes)));
}

const status = (a: DoorAnswer) => ('closed' in a ? 'closed' : a.status);
const card = (patch: Record<string, unknown> = {}) => ({ ...sentCard('arca', 21), sentAt: '2026-11-04T08:59:00Z', ...patch });

function png(width: number, height: number): string {
  return Buffer.from(testPng(width, height)).toString('base64');
}

describe('the signature', () => {
  it('is HMAC-SHA256 over the timestamp, a full stop and the body, as docs/factory-cards.md shows', () => {
    // The worked example in the doc. If this changes, the box's side must change with it.
    expect(signatureFor('example-secret', '1793782800', '{"kind":"heartbeat"}')).toBe(
      'sha256=33fb545d78ddc9df7b1428e21a112c6776d67017c2ba13186f8b66664d200f0a',
    );
  });
});

describe('a closed door', () => {
  it.each([[undefined], [''], ['   ']])('with the secret %j, answers as an address that does not exist, and reads nothing', async (secret) => {
    const { deps } = setUp({ secret });
    const read = vi.fn(async () => new Uint8Array());
    expect(await send(deps, card(), { read })).toEqual({ closed: true });
    expect(read).not.toHaveBeenCalled();
  });
});

describe('a request that is not from the box is refused before its body is read', () => {
  const cases: [string, Parameters<typeof send>[2]][] = [
    ['unsigned', { headers: { [TIMESTAMP_HEADER]: '', [SIGNATURE_HEADER]: '' } }],
    ['with no timestamp', { headers: { [TIMESTAMP_HEADER]: '' } }],
    ['with a signature that is not one', { headers: { [SIGNATURE_HEADER]: 'sha256=nope' } }],
    ['signed six minutes ago', { at: NOW - 6 * 60_000 }],
    ['signed six minutes from now', { at: NOW + 6 * 60_000 }],
  ];
  it.each(cases)('%s', async (_why, sign) => {
    const { deps, store } = setUp();
    const read = vi.fn(async () => new Uint8Array());
    const a = await send(deps, card(), { ...sign, read });
    expect(status(a)).toBe(401);
    expect(read).not.toHaveBeenCalled();
    expect(await store.card('arca', 'arca', 21)).toBeNull();
  });

  it('signed with another secret: refused, nothing kept', async () => {
    const { deps, store } = setUp();
    expect(await send(deps, card(), { secret: 'not-the-secret' })).toEqual({
      status: 401, body: { ok: false, message: 'The signature does not match. Nothing was kept.' },
    });
    expect(await store.card('arca', 'arca', 21)).toBeNull();
  });

  it('a body changed after it was signed: refused', async () => {
    const { deps, store } = setUp();
    const signedText = JSON.stringify(card());
    const ts = String(NOW / 1000);
    const changed = new TextEncoder().encode(JSON.stringify(card({ title: 'Changed on the way' })));
    const headers = new Map([[TIMESTAMP_HEADER, ts], [SIGNATURE_HEADER, signatureFor(SECRET, ts, signedText)]]);
    const a = await handleDoor(deps, { get: (n) => headers.get(n) ?? null }, async () => changed);
    expect(status(a)).toBe(401);
    expect(await store.card('arca', 'arca', 21)).toBeNull();
  });

  it('a timestamp four minutes old still gets in', async () => {
    const { deps } = setUp();
    expect(status(await send(deps, card(), { at: NOW - 4 * 60_000 }))).toBe(200);
  });
});

describe('sizes', () => {
  it('a request that says it is too big is refused before it is read', async () => {
    const { deps } = setUp();
    const read = vi.fn(async () => new Uint8Array());
    expect(status(await send(deps, card(), { headers: { 'content-length': String(MAX_BODY_BYTES + 1) }, read }))).toBe(413);
    expect(read).not.toHaveBeenCalled();
  });

  it('a body that turns out too big while it is read is refused', async () => {
    const { deps } = setUp();
    expect(status(await send(deps, card(), { headers: { 'content-length': '10' }, read: async () => null }))).toBe(413);
  });

  it('a card over 64 KB is refused, signed or not', async () => {
    const { deps, store } = setUp();
    const big = card({ padding: 'x'.repeat(MAX_CARD_BYTES) });
    expect(status(await send(deps, big))).toBe(413);
    expect(await store.card('arca', 'arca', 21)).toBeNull();
  });

  it('a picture over 4 MB is refused', async () => {
    const { deps, store } = setUp();
    await send(deps, card());
    const tooBig = Buffer.alloc(MAX_PICTURE_BYTES + 1);
    Buffer.from(png(2, 2), 'base64').copy(tooBig);
    const r = await send(deps, { kind: 'screenshot', repo: 'arca', number: 21, name: 'after-phone', headSha: 'sha-arca-21', takenAt: '2026-11-04T08:59:00Z', png: tooBig.toString('base64') });
    expect(status(r)).toBe(413);
    expect(await store.picture('arca', 'arca', 21, 'after-phone')).toBeNull();
  });
});

describe('whose card it is comes from its repository, never from the box', () => {
  it('a card is kept under the venture that lists its repository', async () => {
    const { deps, store } = setUp();
    expect(await send(deps, card())).toEqual({ status: 200, body: { ok: true, message: 'Card kept.' } });
    expect((await store.card('arca', 'arca', 21))?.state).toBe('finished');
    expect(await store.card('the-reset', 'arca', 21)).toBeNull();
  });

  it("the full name in the studio's organisation is the same repository", async () => {
    const { deps, store } = setUp();
    expect(status(await send(deps, card({ repo: 'wealthcx01/arca' })))).toBe(200);
    expect(await store.card('arca', 'arca', 21)).not.toBeNull();
  });

  it.each([
    ['a repository no venture lists', { repo: 'nobodys-repo' }],
    ['the same name in another organisation', { repo: 'someone-else/arca' }],
    ["a venture named that is not the repository's", { venture: 'the-reset' }],
    ['a venture named that does not exist', { venture: 'nobody' }],
  ])('refuses %s, and keeps nothing anywhere', async (_why, patch) => {
    const { deps, store } = setUp();
    expect(status(await send(deps, card(patch)))).toBe(422);
    for (const v of ['arca', 'the-reset', 'nobody']) expect(await store.finished(v, ['arca', 'nobodys-repo'])).toEqual([]);
  });

  it("a venture named that is the repository's own is fine", async () => {
    const { deps } = setUp();
    expect(status(await send(deps, card({ venture: 'arca' })))).toBe(200);
  });

  it('a repository two ventures list is refused, because whose it is cannot be told', async () => {
    const twice = [...VENTURES, { id: 'copycat', name: 'Copycat', repos: ['arca'], departments: [] }] as unknown as VentureSummary[];
    const { deps } = setUp({ ventures: twice });
    expect(status(await send(deps, card()))).toBe(422);
  });
});

describe('a card', () => {
  it("keeps the plain parts by name, and everything else as John's", async () => {
    const { deps, store } = setUp();
    await send(deps, card({ budgetLeft: '$21.60', archonRun: 'run-21' }));
    const kept = (await store.card('arca', 'arca', 21))!;
    expect(Object.keys(kept.plain).sort()).toEqual([...PLAIN_PARTS].sort());
    expect(JSON.stringify(kept.plain)).not.toMatch(/budgetLeft|run-21|archon|What to do next/i);
    expect(kept.forJohn).toEqual({
      budgetLeft: '$21.60',
      archonRun: 'run-21',
      forJohn: { cost: '$2.10, of a $15 budget', nextStep: "What to do next: approve it once ARCA's founder has signed it off.", runUrl: 'https://archon.example.invalid/runs/arca-21' },
    });
  });

  it('an older version arriving late changes nothing', async () => {
    const { deps, store } = setUp();
    await send(deps, card({ title: 'Newer' }));
    expect(status(await send(deps, card({ title: 'Older', sentAt: '2026-11-04T08:00:00Z' })))).toBe(409);
    expect((await store.card('arca', 'arca', 21))?.plain.title).toBe('Newer');
  });

  it.each([
    ['a state it does not know', { state: 'merged' }],
    ['no title', { title: '' }],
    ['a sentAt in the future', { sentAt: '2026-11-05T09:00:00Z' }],
    ['checks that passed more than ran', { checks: { passed: 4, total: 3 } }],
    ['a trail line with a tone it does not know', { trail: [{ at: '2026-11-04T08:00:00Z', tone: 'shouting', text: 'x' }] }],
    ["a run link for John that is not a web address", { forJohn: { runUrl: 'javascript:alert(1)' } }],
  ])('with %s is refused', async (_why, patch) => {
    const { deps, store } = setUp();
    expect(status(await send(deps, card(patch)))).toBe(400);
    expect(await store.card('arca', 'arca', 21)).toBeNull();
  });

  it('with a preview that is not a preview address is refused', async () => {
    const { deps } = setUp();
    expect(status(await send(deps, card({ previewUrl: 'http://169.254.169.254/?a.up.railway.app' })))).toBe(422);
  });

  it('not JSON, or of a kind the door does not know, is refused', async () => {
    const { deps } = setUp();
    expect(status(await send(deps, 'not json'))).toBe(400);
    expect(status(await send(deps, { kind: 'press' }))).toBe(400);
  });

  it('a studio with nowhere to keep cards says so', async () => {
    const { deps } = setUp({ store: null });
    expect(status(await send(deps, card()))).toBe(503);
  });
});

describe('the founder hears of a card once it is kept (FB-279)', () => {
  it('a kept card is passed on once, under the venture its repository belongs to', async () => {
    const onCard = vi.fn();
    const { deps, store } = setUp({ onCard });
    expect(status(await send(deps, card()))).toBe(200);
    expect(onCard).toHaveBeenCalledTimes(1);
    expect(onCard.mock.calls[0][0]).toBe('arca');
    expect(onCard.mock.calls[0][1]).toEqual(await store.card('arca', 'arca', 21).then((c) => { const { pictures: _, ...rest } = c!; return rest; }));
  });

  it('an older card, a refused card, and a studio with nowhere to keep cards pass nothing on', async () => {
    const onCard = vi.fn();
    const { deps } = setUp({ onCard });
    await send(deps, card());
    onCard.mockClear();
    expect(status(await send(deps, card({ sentAt: '2026-11-04T08:00:00Z' })))).toBe(409);
    expect(status(await send(deps, card({ title: '' })))).toBe(400);
    expect(status(await send(setUp({ onCard, store: null }).deps, card()))).toBe(503);
    expect(onCard).not.toHaveBeenCalled();
  });
});

describe('a picture', () => {
  const shot = (patch: Record<string, unknown> = {}) => ({
    kind: 'screenshot', repo: 'arca', number: 21, name: 'after-phone', headSha: 'sha-arca-21', takenAt: '2026-11-04T08:59:00Z', png: png(393, 851), ...patch,
  });

  it('is kept as bytes, with its size read from the PNG itself', async () => {
    const { deps, store } = setUp();
    await send(deps, card());
    expect(await send(deps, shot())).toEqual({ status: 200, body: { ok: true, message: 'Picture kept.' } });
    expect(Buffer.from((await store.picture('arca', 'arca', 21, 'after-phone'))!).toString('base64')).toBe(shot().png);
    expect((await store.card('arca', 'arca', 21))?.pictures).toEqual([{ name: 'after-phone', width: 393, height: 851, takenAt: '2026-11-04T08:59:00.000Z' }]);
  });

  it('that is not a PNG is refused, whatever it is called', async () => {
    const { deps, store } = setUp();
    await send(deps, card());
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(0)]).toString('base64');
    expect(status(await send(deps, shot({ png: svg })))).toBe(415);
    expect(status(await send(deps, shot({ png: jpeg })))).toBe(415);
    expect(await store.picture('arca', 'arca', 21, 'after-phone')).toBeNull();
  });

  it('of a card that is not here yet, or of another version of the work, is refused', async () => {
    const { deps, store } = setUp();
    expect(status(await send(deps, shot()))).toBe(409);
    await send(deps, card());
    expect(status(await send(deps, shot({ headSha: 'sha-something-older' })))).toBe(409);
    expect(await store.picture('arca', 'arca', 21, 'after-phone')).toBeNull();
  });

  it('with a name that is not one of the four is refused', async () => {
    const { deps } = setUp();
    await send(deps, card());
    expect(status(await send(deps, shot({ name: '../../etc/passwd' })))).toBe(400);
  });

  it("goes when a newer card is about another version of the work", async () => {
    const { deps, store } = setUp();
    await send(deps, card());
    await send(deps, shot());
    await send(deps, card({ headSha: 'sha-arca-21-again', sentAt: '2026-11-04T08:59:30Z' }));
    expect(await store.picture('arca', 'arca', 21, 'after-phone')).toBeNull();
  });
});

describe('pngSize', () => {
  it('reads the width and height from the header', () => {
    expect(pngSize(Buffer.from(png(1440, 1000), 'base64'))).toEqual({ width: 1440, height: 1000 });
  });
  it('is null for anything else', () => {
    expect(pngSize(new Uint8Array(8))).toBeNull();
    expect(pngSize(Buffer.from('GIF89a........................................'))).toBeNull();
  });
});

describe('a preview link', () => {
  it('is kept when it is a preview address, and refused otherwise', async () => {
    const { deps, store } = setUp();
    await send(deps, card({ previewUrl: null }));
    expect(status(await send(deps, { kind: 'preview', repo: 'arca', number: 21, url: 'https://arca-pr-21.up.railway.app' }))).toBe(200);
    expect((await store.card('arca', 'arca', 21))?.previewUrl).toBe('https://arca-pr-21.up.railway.app');
    for (const url of ['https://example.com', 'http://arca-pr-21.up.railway.app', 'https://localhost', 'javascript:alert(1)']) {
      expect(status(await send(deps, { kind: 'preview', repo: 'arca', number: 21, url }))).toBe(422);
    }
    expect((await store.card('arca', 'arca', 21))?.previewUrl).toBe('https://arca-pr-21.up.railway.app');
  });

  it('for a card that is not here is refused', async () => {
    const { deps } = setUp();
    expect(status(await send(deps, { kind: 'preview', repo: 'arca', number: 99, url: 'https://arca-pr-99.up.railway.app' }))).toBe(409);
  });
});

describe('a heartbeat', () => {
  it('records when the box reported, by its own signed clock', async () => {
    const { deps, store } = setUp();
    expect(await send(deps, { kind: 'heartbeat' })).toEqual({ status: 200, body: { ok: true, message: 'Heard.' } });
    expect(await store.lastBeat('planning-box')).toMatchObject({ box: 'planning-box', reportedAt: '2026-11-04T09:00:00.000Z' });
  });

  it('needs no repository, and still needs the signature', async () => {
    const { deps, store } = setUp();
    expect(status(await send(deps, { kind: 'heartbeat' }, { secret: 'wrong' }))).toBe(401);
    expect(await store.lastBeat('planning-box')).toBeNull();
  });
});

describe('what the door writes in the log', () => {
  it('never the secret, a signature or a body', async () => {
    const { deps, logged } = setUp();
    await send(deps, card());
    await send(deps, card(), { secret: 'wrong' });
    await send(deps, card({ repo: 'nobodys-repo' }));
    const all = logged.join('\n');
    expect(all).not.toContain(SECRET);
    expect(all).not.toMatch(/sha256=|[0-9a-f]{64}/);
    expect(all).not.toMatch(/Prices in pounds|\$2\.10|archon/i);
  });
});

describe('presses, through the door (FB-276)', () => {
  const FOUNDER = 'arca.founder@bruntsfield.capital';

  /** The door with ARCA's #21 and THE RESET's #5 already sent, as the box sends them. */
  async function withCards() {
    const set = setUp();
    await send(set.deps, card());
    await send(set.deps, { ...sentCard('thereset-platform', 5), sentAt: '2026-11-04T08:59:00Z' });
    return set;
  }
  const press = (store: CardStore, action: 'accept' | 'approve' | 'stop', by: string, byJohn: boolean, venture = 'arca', repo = 'arca', number = 21) =>
    store.press(venture, { repo, number, action, by, byJohn, note: '', seenHeadSha: null });
  const body = (a: DoorAnswer) => ('closed' in a ? null : a.body);

  describe('collect', () => {
    it('hands out the presses not yet collected, oldest first, across ventures, and sign-offs on their own', async () => {
      const { deps, store } = await withCards();
      await press(store, 'accept', FOUNDER, false);
      await press(store, 'stop', 'ross@bruntsfield.capital', false, 'the-reset', 'thereset-platform', 5);
      await press(store, 'approve', JOHN, true);

      const got = await send(deps, { kind: 'collect' });
      expect(status(got)).toBe(200);
      const b = body(got)!;
      expect((b.presses as { venture: string; action: string }[]).map((p) => [p.venture, p.action])).toEqual([['the-reset', 'stop'], ['arca', 'approve']]);
      expect(b.signOffs).toEqual([expect.objectContaining({ venture: 'arca', repo: 'arca', number: 21, action: 'accept', by: FOUNDER, byJohn: false })]);
      expect(Object.keys((b.presses as object[])[0]).sort()).toEqual(['action', 'by', 'byJohn', 'id', 'note', 'number', 'pressedAt', 'repo', 'seenHeadSha', 'venture']);
      expect(b.more).toBe(false);
    });

    it("a founder's sign-off is never a press: the box collects no press for it", async () => {
      const { deps, store } = await withCards();
      await press(store, 'accept', FOUNDER, false);
      const b = body(await send(deps, { kind: 'collect' }))!;
      expect(b.presses).toEqual([]);
      expect(b.signOffs).toHaveLength(1);
    });

    it('sent again, even the very same signed request, hands out nothing twice', async () => {
      const { deps, store } = await withCards();
      await press(store, 'approve', JOHN, true);
      expect((body(await send(deps, { kind: 'collect' }))!.presses as unknown[])).toHaveLength(1);
      expect(body(await send(deps, { kind: 'collect' }))).toMatchObject({ ok: true, presses: [], signOffs: [], more: false });
    });

    it('stays inside the door’s 64 KB, and says when more are waiting', async () => {
      const { deps, store } = await withCards();
      const long = 'é'.repeat(2000);
      for (let n = 100; n < 130; n++) {
        await send(deps, card({ number: n }));
        await store.press('arca', { repo: 'arca', number: n, action: 'stop', by: FOUNDER, byJohn: false, note: long, seenHeadSha: null });
      }
      const first = await send(deps, { kind: 'collect' });
      expect(Buffer.byteLength(JSON.stringify(body(first)))).toBeLessThan(MAX_CARD_BYTES);
      expect(body(first)!.more).toBe(true);
      let all = (body(first)!.presses as unknown[]).length;
      for (let i = 0; i < 5 && all < 30; i++) all += (body(await send(deps, { kind: 'collect' }))!.presses as unknown[]).length;
      expect(all).toBe(30);
    });

    it('unsigned or wrongly signed, collects nothing', async () => {
      const { deps, store } = await withCards();
      await press(store, 'approve', JOHN, true);
      expect(status(await send(deps, { kind: 'collect' }, { secret: 'wrong' }))).toBe(401);
      expect(status(await send(deps, { kind: 'collect' }, { headers: { [SIGNATURE_HEADER]: '' } }))).toBe(401);
      expect((body(await send(deps, { kind: 'collect' }))!.presses as unknown[])).toHaveLength(1);
    });

    it('a studio with nowhere to keep presses says so', async () => {
      const { deps } = setUp({ store: null });
      expect(status(await send(deps, { kind: 'collect' }))).toBe(503);
    });
  });

  describe('press-result', () => {
    async function collected() {
      const set = await withCards();
      await press(set.store, 'approve', JOHN, true);
      const [p] = body(await send(set.deps, { kind: 'collect' }))!.presses as { id: string }[];
      return { ...set, id: p.id };
    }

    it('keeps what happened, and the card shows it', async () => {
      const { deps, store, id } = await collected();
      expect(await send(deps, { kind: 'press-result', id, outcome: 'done', message: 'Made part of ARCA.' })).toEqual({ status: 200, body: { ok: true, message: 'Answer kept.' } });
      expect((await store.presses('arca', 'arca', 21))[0].answer).toMatchObject({ outcome: 'done', message: 'Made part of ARCA.' });
    });

    it('the same answer again is fine; a different one is 409 and changes nothing', async () => {
      const { deps, store, id } = await collected();
      const answer = { kind: 'press-result', id, outcome: 'done', message: 'Made part of ARCA.' };
      await send(deps, answer);
      expect(status(await send(deps, answer))).toBe(200);
      expect(status(await send(deps, { ...answer, outcome: 'out-of-date' }))).toBe(409);
      expect(status(await send(deps, { ...answer, message: 'Something else.' }))).toBe(409);
      expect((await store.presses('arca', 'arca', 21))[0].answer?.outcome).toBe('done');
    });

    it.each([
      ['no id', { id: undefined }],
      ['an id that is not one', { id: "1' or '1'='1" }],
      ['an outcome it does not know', { outcome: 'merged' }],
      ['no message', { message: '' }],
      ['a message too long', { message: 'x'.repeat(1001) }],
    ])('with %s is refused', async (_why, patch) => {
      const { deps, store, id } = await collected();
      expect(status(await send(deps, { kind: 'press-result', id, outcome: 'done', message: 'Done.', ...patch }))).toBe(400);
      expect((await store.presses('arca', 'arca', 21))[0].answer).toBeNull();
    });

    it('for a press that is not there, or a sign-off, is 409', async () => {
      const { deps, store } = await withCards();
      expect(status(await send(deps, { kind: 'press-result', id: '00000000-0000-4000-8000-000000000000', outcome: 'done', message: 'Done.' }))).toBe(409);
      await press(store, 'accept', FOUNDER, false);
      const [s] = body(await send(deps, { kind: 'collect' }))!.signOffs as { id: string }[];
      expect(status(await send(deps, { kind: 'press-result', id: s.id, outcome: 'done', message: 'Done.' }))).toBe(409);
    });

    it('signed with another secret, keeps nothing', async () => {
      const { deps, store, id } = await collected();
      expect(status(await send(deps, { kind: 'press-result', id, outcome: 'done', message: 'Done.' }, { secret: 'wrong' }))).toBe(401);
      expect((await store.presses('arca', 'arca', 21))[0].answer).toBeNull();
    });
  });

  describe('answered-elsewhere', () => {
    const tap = (patch: Record<string, unknown> = {}) => ({ kind: 'answered-elsewhere', repo: 'arca', number: 21, action: 'approve', at: '2026-11-04T08:58:00Z', ...patch });

    it("keeps a tap on Telegram as John's, done, and the card's buttons go", async () => {
      const { deps, store } = await withCards();
      expect(await send(deps, tap())).toEqual({ status: 200, body: { ok: true, message: 'Kept.' } });
      const [p] = await store.presses('arca', 'arca', 21);
      expect(p).toMatchObject({ source: 'telegram', action: 'approve', by: JOHN, byJohn: true, answer: { outcome: 'done', message: 'Done on Telegram.' } });
      expect(await press(store, 'accept', FOUNDER, false)).toBe('out-of-date');
      expect(body(await send(deps, { kind: 'collect' }))).toMatchObject({ presses: [], signOffs: [] });
    });

    it('reported twice is kept once; with a different answer, 409', async () => {
      const { deps, store } = await withCards();
      await send(deps, tap({ message: 'Approved on Telegram.' }));
      expect(await send(deps, tap({ message: 'Approved on Telegram.' }))).toEqual({ status: 200, body: { ok: true, message: 'That tap was already kept.' } });
      expect(status(await send(deps, tap({ outcome: 'refused', message: 'No.' })))).toBe(409);
      expect(await store.presses('arca', 'arca', 21)).toHaveLength(1);
    });

    it.each([
      ['an Accept: Telegram has no sign-off', { action: 'accept' }],
      ['an action it does not know', { action: 'merge' }],
      ['an outcome it does not know', { outcome: 'merged' }],
      ['no time', { at: undefined }],
      ['a time in the future', { at: '2026-11-05T09:00:00Z' }],
    ])('with %s is refused', async (_why, patch) => {
      const { deps, store } = await withCards();
      expect(status(await send(deps, tap(patch)))).toBe(400);
      expect(await store.presses('arca', 'arca', 21)).toEqual([]);
    });

    it('for a card not here is 409; for a repository no venture lists, 422', async () => {
      const { deps } = await withCards();
      expect(status(await send(deps, tap({ number: 99 })))).toBe(409);
      expect(status(await send(deps, tap({ repo: 'nobodys-repo' })))).toBe(422);
      expect(status(await send(deps, tap({ venture: 'the-reset' })))).toBe(422);
    });

    it('unsigned, keeps nothing', async () => {
      const { deps, store } = await withCards();
      expect(status(await send(deps, tap(), { secret: 'wrong' }))).toBe(401);
      expect(await store.presses('arca', 'arca', 21)).toEqual([]);
    });
  });
});

describe("the factory's own cards (FB-277)", () => {
  const cowgate = (patch: Record<string, unknown> = {}) => card({ repo: 'cowgate', number: 40, ref: 'CG-0066', title: 'The second inbox', state: 'done', ...patch });

  it('are kept under _factory, by the short name or the full one, and under no venture', async () => {
    const { deps, store } = setUp();
    expect(status(await send(deps, cowgate()))).toBe(200);
    expect(status(await send(deps, cowgate({ repo: 'wealthcx01/cowgate', number: 41 })))).toBe(200);
    expect((await store.card('_factory', 'cowgate', 40))?.plain.title).toBe('The second inbox');
    expect(await store.card('_factory', 'cowgate', 41)).not.toBeNull();
    for (const v of ['arca', 'the-reset']) {
      expect(await store.card(v, 'cowgate', 40)).toBeNull();
      expect(await store.newest(v, 50)).toEqual([]);
    }
  });

  it('stay the factory\'s even when a manifest lists cowgate', async () => {
    const ventures = [...VENTURES, { id: 'greedy', name: 'Greedy', repos: ['cowgate'], departments: [] }] as unknown as VentureSummary[];
    const { deps, store } = setUp({ ventures });
    expect(status(await send(deps, cowgate()))).toBe(200);
    expect(await store.card('greedy', 'cowgate', 40)).toBeNull();
    expect(await store.card('_factory', 'cowgate', 40)).not.toBeNull();
  });

  it('refuse a venture named that is not _factory, and cowgate in another organisation', async () => {
    const { deps, store } = setUp();
    expect(status(await send(deps, cowgate({ venture: 'arca' })))).toBe(422);
    expect(status(await send(deps, cowgate({ repo: 'someone-else/cowgate' })))).toBe(422);
    expect(await store.newest('_factory', 50)).toEqual([]);
    expect(await store.newest('arca', 50)).toEqual([]);
  });

  it("are collected and answered like any venture's", async () => {
    const { deps, store } = setUp();
    await send(deps, cowgate({ state: 'finished' }));
    await store.press('_factory', { repo: 'cowgate', number: 40, action: 'approve', by: JOHN, byJohn: true, note: '', seenHeadSha: null });
    const got = await send(deps, { kind: 'collect' });
    const presses = ('closed' in got ? [] : got.body.presses) as { id: string; venture: string }[];
    expect(presses.map((p) => p.venture)).toEqual(['_factory']);
    expect(status(await send(deps, { kind: 'press-result', id: presses[0].id, outcome: 'done', message: 'Merged.' }))).toBe(200);
    expect((await store.presses('_factory', 'cowgate', 40))[0].answer?.outcome).toBe('done');
  });
});
