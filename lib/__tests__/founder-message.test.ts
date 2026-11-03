import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { cardEmail, cardMessage, cardTag, isFounderMessage, MESSAGE_STATES } from '../founder-message';
import { pushPayload } from '../push-send';
import { CARD_STATES, type StoredCard } from '../card-store';
import { storedCard } from './review-fixtures';

/** What a founder is told about a card (FB-279): the words, the link, and what can never be in them. */
const ARCA = { id: 'arca', name: 'ARCA' };
const as = (state: StoredCard['state']): StoredCard & { state: 'finished' | 'stuck' | 'sent-back' } =>
  ({ ...storedCard('arca', 21), state }) as StoredCard & { state: 'finished' | 'stuck' | 'sent-back' };

describe('which cards make a message', () => {
  it('only finished, stuck and sent back, and only a venture’s own', () => {
    const made = CARD_STATES.filter((s) => isFounderMessage('arca', { state: s }));
    expect(made).toEqual([...MESSAGE_STATES]);
    for (const s of CARD_STATES) expect(isFounderMessage('_factory', { state: s })).toBe(false);
  });
});

describe('the words and the link', () => {
  it('a finished card says so, and opens its Review screen', () => {
    expect(cardMessage(ARCA, as('finished'))).toEqual({
      title: 'ARCA: your team finished something',
      body: 'It is ready for you to look at and decide.',
      url: '/venture/arca/review/arca/21',
      tag: 'card-arca-arca-21',
    });
  });

  it('a stuck card and a sent-back card open their row on Tickets', () => {
    const stuck = cardMessage(ARCA, as('stuck'));
    expect(stuck.title).toBe('ARCA: your team is stuck');
    expect(stuck.body).toBe('They stopped and need a person to decide how the work goes on.');
    expect(stuck.url).toMatch(/^\/venture\/arca\/tickets\?filter=needs&t=/);
    const back = cardMessage(ARCA, as('sent-back'));
    expect(back.title).toBe('ARCA: work went back to your team');
    expect(back.url).toBe(stuck.url);
  });

  it('the email is the same message, with the full link and how to stop them', () => {
    const message = cardMessage(ARCA, as('finished'));
    const email = cardEmail(message, { studioUrl: 'https://studio.example/', venture: ARCA, to: 'matthew@bruntsfield.capital', from: 'Foundry Studio <john@bruntsfield.capital>' });
    expect(email.subject).toBe(message.title);
    expect(email.to).toBe('matthew@bruntsfield.capital');
    expect(email.from).toBe('Foundry Studio <john@bruntsfield.capital>');
    expect(email.text).toContain(message.body);
    expect(email.text).toContain('Open it in the studio: https://studio.example/venture/arca/review/arca/21');
    expect(email.text).toContain('https://studio.example/venture/arca/tickets and press "Stop these messages"');
  });

  it('carries no dollar figure, none of John’s lines, and not the work’s title', () => {
    const card = as('finished');
    expect(JSON.stringify(card.forJohn)).toContain('$');
    for (const state of MESSAGE_STATES) {
      const message = cardMessage(ARCA, as(state));
      const email = cardEmail(message, { studioUrl: 'https://studio.example', venture: ARCA, to: 'a@b', from: 'c@d' });
      const said = JSON.stringify(message) + email.subject + email.text;
      expect(said).not.toContain('$');
      for (const line of Object.values(card.forJohn)) expect(said).not.toContain(String(line));
      expect(said).not.toContain(card.plain.title);
    }
  });
});

describe('each card has its own tag on the phone', () => {
  it('two cards never share a tag, and neither shares the blocker buzz’s', () => {
    const first = cardMessage(ARCA, as('finished'));
    const second = cardMessage(ARCA, { ...as('stuck'), number: 22 });
    expect(first.tag).not.toBe(second.tag);
    expect([first.tag, second.tag]).not.toContain(pushPayload(ARCA, 1, null).tag);
  });

  it('is letters, digits, dashes and underscores only, whatever the repository is called', () => {
    expect(cardTag('arca', { repo: 'arca marketing/../x', number: 7 })).toBe('card-arca-arca-marketing----x-7');
  });
});

describe('the service worker', () => {
  /** What the phone is asked to show for one push, from public/sw.js itself. */
  function shown(payload: unknown) {
    const on: Record<string, (event: unknown) => void> = {};
    const notes: { title: string; options: Record<string, unknown> }[] = [];
    const self = {
      addEventListener: (name: string, fn: (event: unknown) => void) => { on[name] = fn; },
      registration: { showNotification: async (title: string, options: Record<string, unknown>) => { notes.push({ title, options }); } },
      location: { origin: 'https://studio.example' },
    };
    runInNewContext(readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8'), { self, URL });
    on.push({ data: { json: () => payload }, waitUntil: () => {} });
    return notes[0];
  }

  it('alerts again for a new message about the same card', () => {
    const note = shown(cardMessage(ARCA, as('stuck')));
    expect(note.options).toMatchObject({ tag: 'card-arca-arca-21', renotify: true });
  });

  it('lets the blocker buzz replace itself quietly, as before', () => {
    expect(shown(pushPayload(ARCA, 2, null)).options).toMatchObject({ tag: 'blocker-arca', renotify: false });
  });
});
