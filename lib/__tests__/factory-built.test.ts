import { describe, expect, it } from 'vitest';
import { builtByFactory, factoryLine } from '../factory-built';

// 3 November 2026, 16:00 in London (GMT, so the same as UTC).
const NOW = Date.parse('2026-11-03T16:00:00Z');

describe('builtByFactory (FB-295)', () => {
  it('is true for ARCA, which the factory builds, and false for a venture with its own machine', () => {
    expect(builtByFactory('arca', {})).toBe(true);
    expect(builtByFactory('the-reset', {})).toBe(false);
  });

  it('takes the list from STUDIO_FACTORY_BUILT when it is set, and none when it is empty', () => {
    expect(builtByFactory('arca', { STUDIO_FACTORY_BUILT: '' })).toBe(false);
    expect(builtByFactory('the-reset', { STUDIO_FACTORY_BUILT: 'arca, the-reset' })).toBe(true);
  });
});

describe('factoryLine (FB-295)', () => {
  it('names the last piece of work added, with its time, and never says the old machine stopped', () => {
    const line = factoryLine('ARCA', [
      { standing: 'done', title: 'Clear the Cards page’s filters', at: '2026-11-03T07:57:00Z' },
      { standing: 'done', title: 'The News tab shows real news', at: '2026-10-31T10:00:00Z' },
      { standing: 'finished', title: 'The sign-in line', at: '2026-11-03T15:00:00Z' },
    ], null, NOW);
    expect(line).toEqual({
      state: 'running',
      text: 'The factory builds ARCA. Last added: Clear the Cards page’s filters, 07:57.',
      ageMinutes: null,
    });
  });

  it('gives the day as well when the last addition was not today', () => {
    const line = factoryLine('ARCA', [{ standing: 'done', title: 'News', at: '2026-10-31T10:00:00Z' }], null, NOW);
    expect(line.text).toBe('The factory builds ARCA. Last added: News, 31 Oct, 10:00.');
  });

  it('says nothing has been added when no card is done, rather than inventing a last time', () => {
    const line = factoryLine('ARCA', [{ standing: 'finished', title: 'Waiting', at: '2026-11-03T15:00:00Z' }], null, NOW);
    expect(line).toEqual({ state: 'running', text: 'The factory builds ARCA. Nothing it built has been added yet.', ageMinutes: null });
  });

  it('says the factory is quiet, as the cards do, when it has stopped reporting', () => {
    const quiet = "The factory hasn't reported since 14:10. These may be out of date.";
    const line = factoryLine('ARCA', [{ standing: 'done', title: 'News', at: '2026-10-31T10:00:00Z' }], quiet, NOW);
    expect(line).toEqual({ state: 'stalled', text: quiet, ageMinutes: null });
  });

  it('skips a done card whose time cannot be read', () => {
    const line = factoryLine('ARCA', [
      { standing: 'done', title: 'Bad time', at: 'not a time' },
      { standing: 'done', title: 'News', at: '2026-11-03T09:00:00Z' },
    ], null, NOW);
    expect(line.text).toBe('The factory builds ARCA. Last added: News, 09:00.');
  });
});
