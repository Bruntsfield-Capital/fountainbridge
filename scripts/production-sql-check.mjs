#!/usr/bin/env node
// The "Production SQL" check (FB-287), run by .github/workflows/production-sql.yml on every pull
// request event. The rules are in scripts/production-sql-lib.mjs.
//
// What it does, in order:
//   1. On a push to the pull request (`synchronize`), compares what the pull request did to `db/`
//      before the push and after it. If that changed, it takes the label `production-sql-run` off:
//      John's word was about the SQL as it was.
//   2. Reads what the pull request does to `db/` now, whether it carries the label, and who added
//      the label last.
//   3. Passes or fails, with one line saying why.
//
// The workflow runs main's copy of this file, never the pull request's, so a pull request cannot
// change the rules it is checked by. It reads GitHub only, and needs no secret but the workflow's
// own token.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LABEL, lastLabeller, pushResetsLabel, schemaChanges, verdict } from './production-sql-lib.mjs';

/** A small GitHub client: just the four calls the check makes. */
export function githubApi({ repo, token, fetchImpl = fetch }) {
  const call = async (method, path) => {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    });
    if (!res.ok) throw new Error(`GitHub said ${res.status} to ${method} ${path}`);
    return res.status === 204 ? null : res.json();
  };
  const pages = async (path) => {
    const all = [];
    for (let page = 1; ; page++) {
      const rows = await call('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      all.push(...rows);
      if (rows.length < 100) return all;
    }
  };
  return {
    compareFiles: async (base, head) => (await call('GET', `/compare/${base}...${head}`)).files ?? [],
    labels: async (n) => (await pages(`/issues/${n}/labels`)).map((l) => l.name),
    events: (n) => pages(`/issues/${n}/events`),
    removeLabel: (n) => call('DELETE', `/issues/${n}/labels/${encodeURIComponent(LABEL)}`),
  };
}

/** The check itself, given the workflow's event and a GitHub client. Exported for the tests. */
export async function check({ event, api, log = console.log }) {
  const pr = event.pull_request;
  const base = pr.base.sha;
  if (event.action === 'synchronize' && event.before && event.after) {
    let reset;
    try {
      reset = pushResetsLabel(schemaChanges(await api.compareFiles(base, event.before)), schemaChanges(await api.compareFiles(base, event.after)));
    } catch {
      // The commit before a force push can be gone. Not knowing counts as a change.
      reset = true;
    }
    if (reset && (await api.labels(pr.number)).includes(LABEL)) {
      await api.removeLabel(pr.number);
      log(`This push changed the pull request's db/ files, so the label ${LABEL} was taken off.`);
    }
  }
  const changes = schemaChanges(await api.compareFiles(base, pr.head.sha));
  const labelled = (await api.labels(pr.number)).includes(LABEL);
  const labeller = labelled ? lastLabeller(await api.events(pr.number)) : null;
  const v = verdict({ changes, labelled, labeller });
  log(v.line);
  return v;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const api = githubApi({ repo: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN });
  check({ event, api }).then(
    (v) => process.exit(v.pass ? 0 : 1),
    (e) => {
      console.error(`[production-sql] ${e.message}`);
      process.exit(1);
    },
  );
}
