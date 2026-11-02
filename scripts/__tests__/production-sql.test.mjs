// FB-287, lock 1: the "Production SQL" check. A pull request that changes db/ cannot pass until
// John has added the label production-sql-run, and only John's label counts; a later push that
// changes its db/ files takes the label off again.
//
// The check runs here against a stand-in GitHub that keeps a pull request's commits, labels and
// label history, so each rule is tested the way it runs: a sequence of events on one pull request.
import { describe, expect, it } from 'vitest';
import { check, githubApi } from '../production-sql-check.mjs';
import { JOHN, LABEL, lastLabeller, schemaChanges, verdict } from '../production-sql-lib.mjs';

const APP = 'bruntsfield-factory[bot]';
const BASE = 'base0';

/** One pull request on a stand-in GitHub. `commits` maps a commit to its files, compared with BASE. */
function fakeGithub(commits) {
  const state = { labels: [], events: [], removed: 0 };
  const api = {
    compareFiles: async (base, head) => {
      if (base !== BASE) throw new Error(`compared with ${base}`);
      if (!(head in commits)) throw new Error('GitHub said 404');
      return commits[head];
    },
    labels: async () => [...state.labels],
    events: async () => [...state.events],
    removeLabel: async () => {
      state.labels = state.labels.filter((l) => l !== LABEL);
      state.events.push({ event: 'unlabeled', label: { name: LABEL }, actor: { login: 'github-actions[bot]' } });
      state.removed++;
    },
  };
  const addLabel = (who, name = LABEL) => {
    if (!state.labels.includes(name)) state.labels.push(name);
    state.events.push({ event: 'labeled', label: { name }, actor: { login: who } });
  };
  return { api, state, addLabel };
}

const event = (head, action = 'labeled', extra = {}) => ({
  action,
  pull_request: { number: 7, base: { sha: BASE }, head: { sha: head } },
  ...extra,
});
const push = (before, after) => event(after, 'synchronize', { before, after });
const run = (gh, ev) => check({ event: ev, api: gh.api, log: () => {} });

const sql = (sha) => ({ filename: 'db/013_new.sql', status: 'added', sha });
const code = { filename: 'lib/x.ts', status: 'modified', sha: 'c1' };

describe('a pull request that does not touch db/', () => {
  it('passes at once, with no label', async () => {
    const gh = fakeGithub({ h1: [code] });
    expect(await run(gh, event('h1', 'opened'))).toEqual({ pass: true, line: expect.stringMatching(/changes nothing in db\//) });
  });
});

describe('a pull request that adds a db/ file', () => {
  it('fails until it has the label, naming the file', async () => {
    const gh = fakeGithub({ h1: [code, sql('s1')] });
    const v = await run(gh, event('h1', 'opened'));
    expect(v.pass).toBe(false);
    expect(v.line).toBe(`This changes db/013_new.sql. John runs it on production, then adds the label ${LABEL}.`);
  });

  it("passes once John has added the label", async () => {
    const gh = fakeGithub({ h1: [sql('s1')] });
    gh.addLabel(JOHN);
    expect((await run(gh, event('h1'))).pass).toBe(true);
  });

  it("does not count the label when the factory's GitHub App added it", async () => {
    const gh = fakeGithub({ h1: [sql('s1')] });
    gh.addLabel(APP);
    const v = await run(gh, event('h1'));
    expect(v.pass).toBe(false);
    expect(v.line).toMatch(new RegExp(`added by ${APP.replace(/[[\]]/g, '\\$&')}, and only John's counts`));
  });

  it('does not count it when someone else added it again after John', async () => {
    const gh = fakeGithub({ h1: [sql('s1')] });
    gh.addLabel(JOHN);
    gh.state.labels = [];
    gh.addLabel(APP);
    expect((await run(gh, event('h1'))).pass).toBe(false);
  });

  it('counts a change or a removal in db/, and a file renamed out of it', () => {
    expect(schemaChanges([
      { filename: 'db/005_crm.sql', status: 'modified', sha: 'a' },
      { filename: 'db/006_voice_usage.sql', status: 'removed', sha: 'b' },
      { filename: 'old/007.sql', previous_filename: 'db/007_ticket_machines.sql', status: 'renamed', sha: 'c' },
      code,
    ])).toEqual({ 'db/005_crm.sql': 'a', 'db/006_voice_usage.sql': 'removed', 'db/007_ticket_machines.sql': 'removed' });
  });
});

describe('a push after John added the label', () => {
  it('that changes a db/ file takes the label off, and the check fails until John adds it again', async () => {
    const gh = fakeGithub({ h1: [sql('s1')], h2: [sql('s2')] });
    gh.addLabel(JOHN);
    expect((await run(gh, event('h1'))).pass).toBe(true);

    const v = await run(gh, push('h1', 'h2'));
    expect(v.pass).toBe(false);
    expect(gh.state.labels).not.toContain(LABEL);
    expect(gh.state.removed).toBe(1);

    gh.addLabel(JOHN);
    expect((await run(gh, event('h2'))).pass).toBe(true);
  });

  it('that adds a second db/ file takes it off too', async () => {
    const gh = fakeGithub({ h1: [sql('s1')], h2: [sql('s1'), { filename: 'db/014_more.sql', status: 'added', sha: 't' }] });
    gh.addLabel(JOHN);
    expect((await run(gh, push('h1', 'h2'))).pass).toBe(false);
  });

  it('that changes only other files leaves the label on, and the check passes', async () => {
    const gh = fakeGithub({ h1: [sql('s1')], h2: [sql('s1'), code] });
    gh.addLabel(JOHN);
    expect((await run(gh, push('h1', 'h2'))).pass).toBe(true);
    expect(gh.state.removed).toBe(0);
  });

  it('that only brings in main (main has the db/ files of its own) leaves the label on', async () => {
    // Compared with the same base, a branch brought up to date with main shows only its own changes.
    const gh = fakeGithub({ h1: [sql('s1')], h2: [sql('s1')] });
    gh.addLabel(JOHN);
    expect((await run(gh, push('h1', 'h2'))).pass).toBe(true);
  });

  it('when the commit before the push is gone (a force push), takes the label off to be safe', async () => {
    const gh = fakeGithub({ h2: [sql('s1')] });
    gh.addLabel(JOHN);
    expect((await run(gh, push('gone', 'h2'))).pass).toBe(false);
    expect(gh.state.removed).toBe(1);
  });
});

describe('the parts', () => {
  it('reads who added the label last, ignoring other labels', () => {
    expect(lastLabeller([])).toBeNull();
    expect(lastLabeller([
      { event: 'labeled', label: { name: LABEL }, actor: { login: APP } },
      { event: 'labeled', label: { name: LABEL }, actor: { login: JOHN } },
      { event: 'labeled', label: { name: 'archon-ready' }, actor: { login: APP } },
    ])).toBe(JOHN);
  });

  it('fails a labelled pull request whose labeller cannot be read', () => {
    expect(verdict({ changes: { 'db/013_new.sql': 's' }, labelled: true, labeller: null }).pass).toBe(false);
  });

  it("asks GitHub for every page of a pull request's events, and stops when GitHub says no", async () => {
    const asked = [];
    const fetchImpl = async (url) => {
      asked.push(url);
      const page = Number(new URL(url).searchParams.get('page'));
      if (url.includes('/compare/')) return { ok: false, status: 404 };
      const rows = Array.from({ length: page === 1 ? 100 : 3 }, () => ({ event: 'labeled', label: { name: LABEL }, actor: { login: JOHN } }));
      return { ok: true, status: 200, json: async () => rows };
    };
    const api = githubApi({ repo: 'wealthcx01/fountainbridge', token: 't', fetchImpl });
    expect(await api.events(7)).toHaveLength(103);
    expect(asked).toHaveLength(2);
    await expect(api.compareFiles(BASE, 'h1')).rejects.toThrow(/404/);
  });
});
