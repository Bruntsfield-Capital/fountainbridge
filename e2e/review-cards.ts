import { createHmac } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { request, type APIRequestContext, type Browser } from '@playwright/test';
import { studioTestEnv } from './server-env.mjs';

/**
 * FB-275: the test cards, put into the studio the way the planning box will, through its door.
 *
 * Each card in `e2e/fixtures/review` is a card in the door's own format (`docs/factory-cards.md`),
 * sent signed with the rig's test secret. Then each of its pictures is drawn, turned into a PNG by
 * the browser, and sent the same way. Nothing reaches the studio by any other route.
 *
 * The signature is made here from the recipe in the doc, not with the studio's own code, so these
 * tests also show that a sender following the doc gets in.
 *
 * Safe to run more than once: the same card again replaces itself.
 *
 * FB-276: this is also the stand-in factory's side of a press. It collects what the studio recorded
 * (`collect`), says what happened to each (`answerPress`), and reports a tap made on Telegram
 * (`reportTelegram`), all through the same door, signed the same way.
 *
 * FB-278: and it reports, as the box does once a minute (`reportHeartbeat`). Every `putReviewCards`
 * reports first, so each spec starts with a factory that is reporting, whatever the one before did.
 */

const FIXTURES = 'e2e/fixtures/review';
const SECRET = studioTestEnv().FACTORY_DOOR_SECRET;

/** Which pictures each test card has. THE RESET's has no "before": it is a new screen. */
const PICTURES: Record<string, string[]> = {
  'arca/20': ['before-computer', 'after-computer', 'before-phone', 'after-phone'],
  'arca/21': ['before-computer', 'after-computer', 'before-phone', 'after-phone'],
  'thereset-platform/5': ['after-computer', 'after-phone'],
};
const VENTURE_NAME: Record<string, string> = { arca: 'ARCA', 'thereset-platform': 'THE RESET' };

export interface TestCard {
  repo: string;
  number: number;
  title: string;
  headSha: string;
  finishedAt: string;
  [part: string]: unknown;
}

export function testCards(): TestCard[] {
  return readdirSync(FIXTURES).flatMap((repo) =>
    readdirSync(join(FIXTURES, repo))
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(FIXTURES, repo, f), 'utf8')) as TestCard),
  );
}

/** Send one thing through the door, signed as the box signs it. */
export async function sendToDoor(api: APIRequestContext, body: string, secret: string = SECRET, at: number = Date.now()) {
  const timestamp = String(Math.floor(at / 1000));
  const signature = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
  return api.post('/api/factory', {
    data: body,
    headers: { 'content-type': 'application/json', 'x-factory-timestamp': timestamp, 'x-factory-signature': signature },
  });
}

/**
 * Every test card and its pictures, into the studio at `baseURL`. Fails loudly if the door says no.
 *
 * Each call sends a new version of each card (a new `headSha`), as the factory does when the work
 * changes. Presses belong to one version of the work (FB-276), so every call starts the cards with no
 * presses, whatever earlier tests pressed, and a retry sees the cards as the factory sent them.
 */
export async function putReviewCards(browser: Browser, baseURL: string): Promise<void> {
  const api = await request.newContext({ baseURL });
  const version = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  try {
    const beat = await reportHeartbeat(api);
    if (!beat.ok()) throw new Error(`the door refused a heartbeat: ${beat.status()} ${await beat.text()}`);
    for (const fixture of testCards()) {
      const card = { ...fixture, headSha: `${fixture.headSha}-${version}` };
      const sent = await sendToDoor(api, JSON.stringify(card));
      if (!sent.ok()) throw new Error(`the door refused ${card.repo}#${card.number}: ${sent.status()} ${await sent.text()}`);
      for (const name of PICTURES[`${card.repo}/${card.number}`] ?? []) {
        const png = await drawn(browser, card, name);
        const body = JSON.stringify({
          kind: 'screenshot', repo: card.repo, number: card.number, name,
          headSha: card.headSha, takenAt: card.finishedAt, png: png.toString('base64'),
        });
        const pic = await sendToDoor(api, body);
        if (!pic.ok()) throw new Error(`the door refused ${name} of ${card.repo}#${card.number}: ${pic.status()} ${await pic.text()}`);
      }
    }
  } finally {
    await api.dispose();
  }
}

/** One press, as the stand-in collects it (`docs/factory-cards.md`, "collect"). */
export interface CollectedPress {
  id: string;
  venture: string;
  repo: string;
  number: number;
  action: string;
  by: string;
  byJohn: boolean;
  note: string;
  seenHeadSha: string;
  pressedAt: string;
}

/** What the stand-in collects: the presses, and the founders' sign-offs on their own. */
export async function collect(api: APIRequestContext): Promise<{ presses: CollectedPress[]; signOffs: CollectedPress[]; more: boolean }> {
  const r = await sendToDoor(api, JSON.stringify({ kind: 'collect' }));
  if (!r.ok()) throw new Error(`the door refused a collect: ${r.status()} ${await r.text()}`);
  return r.json();
}

/** The stand-in says what happened to a press it collected. */
export async function answerPress(api: APIRequestContext, id: string, outcome: 'done' | 'out-of-date' | 'refused', message: string) {
  return sendToDoor(api, JSON.stringify({ kind: 'press-result', id, outcome, message }));
}

/**
 * The stand-in's heartbeat. The studio keeps the time it was signed at, so `at` a little under five
 * minutes ago (the most the door allows) is a box that is about to go quiet.
 */
export async function reportHeartbeat(api: APIRequestContext, at: number = Date.now()) {
  return sendToDoor(api, JSON.stringify({ kind: 'heartbeat' }), SECRET, at);
}

/** The stand-in reports a tap John made on Telegram. */
export async function reportTelegram(api: APIRequestContext, tap: { repo: string; number: number; action: string; at: string; message?: string }) {
  return sendToDoor(api, JSON.stringify({ kind: 'answered-elsewhere', ...tap }));
}

/** One test picture, as a PNG of its own size. */
async function drawn(browser: Browser, card: TestCard, name: string): Promise<Buffer> {
  const phone = name.endsWith('phone');
  const [width, height] = phone ? [393, 851] : [1440, 1000];
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    const page = await ctx.newPage();
    await page.setContent(`<!doctype html><html><body style="margin:0">${testPicture(card.title, name, width, height, VENTURE_NAME[card.repo] ?? card.repo)}</body></html>`);
    return await page.screenshot({ type: 'png' });
  } finally {
    await ctx.close();
  }
}

/**
 * A test picture, drawn from the card's own words (FB-274).
 *
 * The real pictures are taken by the planning box (cowgate CG-0065). These are plain stand-ins of
 * the right size: a light page with the venture's name, which picture it is, and its size. Nothing
 * in them is a real screen, which is why they may be made from this public repository.
 */
export function testPicture(cardTitle: string, name: string, w: number, h: number, ventureName: string): string {
  const phone = name.endsWith('phone');
  const after = name.startsWith('after');
  const pad = phone ? 24 : 48;
  // A phone's width holds about 24 letters of the title a line; two lines at most.
  const title = phone && cardTitle.length > 24
    ? [cardTitle.slice(0, cardTitle.lastIndexOf(' ', 24)), cardTitle.slice(cardTitle.lastIndexOf(' ', 24) + 1)]
    : [cardTitle];
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
  const rows = Array.from({ length: phone ? 6 : 5 }, (_, i) => {
    const y = (phone ? 220 : 240) + i * (phone ? 92 : 120);
    return `<rect x="${pad}" y="${y}" width="${w - pad * 2}" height="${phone ? 76 : 96}" fill="#f4f1ec" stroke="#e4ded4"/>` +
      `<rect x="${pad + 16}" y="${y + 16}" width="${phone ? 44 : 60}" height="${phone ? 44 : 64}" fill="#e4ded4"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block">` +
    `<rect width="${w}" height="${h}" fill="#ffffff"/>` +
    `<rect width="${w}" height="${phone ? 56 : 64}" fill="#f4f1ec"/>` +
    `<text x="${pad}" y="${phone ? 36 : 40}" font-family="sans-serif" font-size="${phone ? 16 : 18}" font-weight="600" fill="#22201c">${esc(ventureName)}</text>` +
    title.map((line, i) =>
      `<text x="${pad}" y="${(phone ? 112 : 136) + i * 30}" font-family="sans-serif" font-size="${phone ? 22 : 32}" font-weight="600" fill="#22201c">${esc(line)}</text>`).join('') +
    `<text x="${pad}" y="176" font-family="sans-serif" font-size="${phone ? 14 : 16}" fill="#77716a">Test picture · ${after ? 'after' : 'before'} · ${w}×${h}</text>` +
    (after ? rows : `<text x="${pad}" y="${phone ? 260 : 300}" font-family="sans-serif" font-size="${phone ? 15 : 18}" fill="#77716a">Not built yet.</text>`) +
    `</svg>`;
}
