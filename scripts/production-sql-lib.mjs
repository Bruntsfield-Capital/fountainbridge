// The rules of the "Production SQL" check (FB-287), kept apart from the command in
// scripts/production-sql-check.mjs so they can be tested without GitHub.
//
// A pull request that adds or changes a file in `db/` needs that SQL run on production by hand
// before it merges, because production's schema is kept by hand on Supabase. The check fails until
// John says he has run it, by adding the label `production-sql-run`. Two more rules (John,
// 1 November 2026):
//   - Only John's label counts. The factory's GitHub App can add labels too, so if anyone else was
//     the last to add it, the check fails.
//   - If a later push changes the pull request's `db/` files, the label is taken off, and the check
//     fails until John adds it again.

/** The label that means "John has run this pull request's SQL on production". */
export const LABEL = 'production-sql-run';

/** The only account whose label counts. */
export const JOHN = 'wealthcx01';

const inDb = (path) => typeof path === 'string' && path.startsWith('db/');

/**
 * What a pull request does to `db/`, from GitHub's compare of its base with one of its commits:
 * each db file it adds, changes or removes, with the contents it leaves there (GitHub's blob id),
 * or `removed`. A file renamed out of `db/` counts as removed from it.
 */
export function schemaChanges(compareFiles) {
  const out = {};
  for (const f of compareFiles ?? []) {
    if (inDb(f.filename)) out[f.filename] = f.status === 'removed' ? 'removed' : f.sha;
    if (f.status === 'renamed' && inDb(f.previous_filename)) out[f.previous_filename] = 'removed';
  }
  return out;
}

/** True when two `schemaChanges` results are the same files with the same contents. */
export function sameChanges(a, b) {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

/** Who added the label last, from the pull request's events, or null if nobody ever has. */
export function lastLabeller(events) {
  const added = (events ?? []).filter((e) => e.event === 'labeled' && e.label?.name === LABEL);
  return added.length ? added[added.length - 1].actor?.login ?? null : null;
}

/**
 * Pass or fail, and the one line that says why.
 *
 *   changes      — `schemaChanges` for the pull request as it stands now.
 *   labelled     — whether the pull request carries the label now.
 *   labeller     — `lastLabeller`: who added it last.
 */
export function verdict({ changes, labelled, labeller }) {
  const files = Object.keys(changes).sort();
  if (!files.length) return { pass: true, line: 'This pull request changes nothing in db/, so it needs no production SQL.' };
  const what = files.map((f) => (changes[f] === 'removed' ? `${f} (removed)` : f)).join(', ');
  if (!labelled) {
    return { pass: false, line: `This changes ${what}. John runs it on production, then adds the label ${LABEL}.` };
  }
  if (labeller !== JOHN) {
    return {
      pass: false,
      line: `This changes ${what}. The label ${LABEL} was added by ${labeller ?? 'someone unknown'}, and only John's counts. John runs the SQL on production, then takes the label off and adds it again.`,
    };
  }
  return { pass: true, line: `This changes ${what}, and John has said it has run on production.` };
}

/**
 * Whether a push should take the label off: when it changed what the pull request does to `db/`.
 * Bringing main's own new files in (updating the branch) changes nothing here, because both sides
 * are compared with the same base.
 */
export function pushResetsLabel(before, after) {
  return !sameChanges(before, after);
}
