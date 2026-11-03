#!/usr/bin/env node
// copy-lint (FB-103) — enforces the founder vocabulary contract (lib/glossary.ts).
//
//   node scripts/copy-lint.mjs            → lint app/, components/ and the copy-bearing lib/; exit 1
//   node scripts/copy-lint.mjs --list     → print the banned terms and what to say instead
//
// Why a linter and not a style guide: the studio's copy has been fixed by hand four times (FB-024,
// FB-063, FB-068, FB-100) and keeps regressing, because the platform underneath is built out of
// systems with engineer names — lanes, RunReports, ActiveGraph, pull requests — and every new
// surface inherits their vocabulary for free. A rubric nobody runs is a document. This is the
// design-lint (FB-057) treatment applied to words.
//
// It reads only what a founder READS: JSX text and the string literals that reach a screen. Internal
// identifiers, routes, test ids, contract fields, comments and console logs keep their engineering
// names — the mechanism polices the copy, never the code.
//
// Admin-only copy is allowed to be technical (an admin fixing a GitHub credential needs the word
// "token"). Opt a line out with a reason, on the line or the one above it:
//
//   // copy-lint-ok: admin-only wiring diagnostics — Bruntsfield reads this, not the founder
//   {access.isAdmin ? <p>Set a read token</p> : null}
//
// A bare `copy-lint-ok` with no reason is itself a failure: an opt-out nobody had to justify is how
// the banned vocabulary walks back in.
//
// Two boundaries, both deliberate:
//
//   content/ is NOT linted. The Handbook and "How the Foundry works" are where the studio explains
//   its own machinery and maps studio words to git words on purpose — a linter over them would ban
//   the one place the mapping is allowed to exist.
//
//   It reads sentences and phrases, not single words. `'merged'` on its own is indistinguishable
//   from an id at this resolution, so a one-word label is still a judgement for review. Everything
//   with two words in it is this linter's problem.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * The banned vocabulary: engineering words this studio drifts into, and the founder word that means
 * the same thing. `say` is printed in the failure, so the fix travels with the error message.
 *
 * Deliberately narrow, like design-lint. These are terms that have actually reached a founder
 * surface here — not every technical word in English.
 */
export const BANNED = [
  // --- git and GitHub -------------------------------------------------------------------------
  { id: 'pull-request', re: /\bpull requests?\b/i, say: '"the work", or name it — "what your team built"' },
  { id: 'pr', re: /\bPRs?\b/, say: '"the work" (a PR is a piece of work waiting on you)' },
  { id: 'merge', re: /\bmerg(e|es|ed|ing)\b/i, say: '"accept" / "goes live" / "becomes part of your product"' },
  { id: 'repo', re: /\brepos?\b|\brepositor(y|ies)\b/i, say: 'the surface name (Build, Sell, Scale), or "your venture’s records"' },
  { id: 'branch', re: /\bbranch(es)?\b/i, say: '"a piece of work in progress"' },
  { id: 'commit', re: /\bcommits?\b/i, say: '"a change"' },
  { id: 'diff', re: /\bdiffs?\b/i, say: '"the change itself"' },
  { id: 'ref', re: /\brefs?\b/i, say: 'nothing — a founder never needs a git ref' },
  { id: 'sha', re: /\bSHAs?\b/, say: 'nothing — drop it, or say "the exact version"' },
  { id: 'git', re: /\bgit\b|\bGitHub\b/i, say: '"your venture’s records" (admin wiring copy may opt out)' },

  // --- this platform’s own machinery ----------------------------------------------------------
  { id: 'lane', re: /\blanes?\b/i, say: '"your team"' },
  { id: 'agent', re: /\bagents?\b/i, say: '"your team"' },
  { id: 'engine', re: /\bengines?\b/i, say: '"your team"' },
  { id: 'claude', re: /\bClaude\b/i, say: '"your team" — the Handbook is the one place Claude is named' },
  { id: 'activegraph', re: /\bActiveGraph\b/i, say: '"your approval" / "the record of your OK"' },
  { id: 'gbrain', re: /\bgbrain\b|\bgstack\b|\bmeridian\b/i, say: '"what your venture knows"' },
  { id: 'runreport', re: /\brun ?reports?\b/i, say: '"what your team did"' },
  { id: 'manifest', re: /\bmanifests?\b/i, say: '"your venture’s setup"' },
  { id: 'fixture', re: /\bfixtures?\b/i, say: 'nothing — test scaffolding is never founder copy' },
  { id: 'heartbeat', re: /\bheartbeats?\b/i, say: '"last checked in"' },
  { id: 'parser', re: /\bparsers?\b|\bpars(e|ed|es|ing)\b/i, say: '"read" / "could not read"' },
  { id: 'scheduler', re: /\bsystemd\b|\bcron\b|\bschedulers?\b/i, say: '"your team wakes every few minutes"' },

  // --- web plumbing ---------------------------------------------------------------------------
  { id: 'api', re: /\bAPIs?\b/, say: 'nothing — say what it does, not what it is' },
  { id: 'json', re: /\bJSONs?\b/i, say: 'nothing — never show a founder a wire format' },
  { id: 'endpoint', re: /\bendpoints?\b/i, say: '"the studio could not reach it"' },
  { id: 'webhook', re: /\bwebhooks?\b/i, say: '"the studio is told when something changes"' },
  { id: 'token', re: /\btokens?\b/i, say: '"the studio’s access" (admin wiring copy may opt out)' },
  { id: 'nullish', re: /\b(null|undefined|NaN)\b/, say: 'a real sentence — an absent value is never founder copy' },
  { id: 'ci', re: /\bCI\b/, say: '"the automatic checks"' },
  { id: 'http', re: /\bHTTP\b|\b[45]\d\d error\b/i, say: '"the studio could not reach it"' },
];

const OPT_OUT = /copy-lint-ok:\s*\S/;
const BARE_OPT_OUT = /copy-lint-ok(?!:\s*\S)/;
/** A line that is only a comment — `//`, `/* … *\/`, `{/* … *\/}`, or a continuation of one. */
const IS_COMMENT_LINE = /^\s*(\/\/|\{?\/\*|\*)|\*\/\}?\s*$/;

// Attributes whose value never reaches a founder's eye. `title`, `aria-label`, `placeholder` and
// `alt` are deliberately NOT in this list — hovered and read aloud are still read.
const INVISIBLE_ATTR =
  /\b(className|class|data-testid|href|src|id|key|name|type|role|style|rel|target|as|slug|method|action|htmlFor|value|scope|charSet|lang)\s*=\s*\{?\s*$/;

/** A developer's log line is not copy, however English it reads. */
const LOG_CALL = /\b(console\.\w+|logger?\.\w+|new Error|throw new \w+Error)\s*\(\s*$/;

/** Prose looks like prose: two adjacent words of two or more letters. */
const PROSE = /[A-Za-z]{2,}[\s ][A-Za-z]{2,}/;

/**
 * Code punctuation and keywords. A JSX text run is delimited by `>` and `<`, and TypeScript's
 * generics wear the same brackets — `useState<Thing | null>(null); const x = useRef<` reads to the
 * scanner as a sentence between two tags. Anything carrying these is source, not copy.
 */
// `\w\(` is a call — `Date.parse(x)`. Prose puts a space before an opening bracket; code does not,
// and `(r) => now - Date.parse(r.endedAt as string) <= WEEK` is a "sentence" between `>` and `<`.
const IS_CODE = /[;]|=>|\w\(|\)\s*[.;,]|\b(const|let|var|function|return|import|export|interface|type|use[A-Z]\w*)\b/;

/** Shaped like prose, but not copy: ids, paths, imports, css declarations. */
function isNotCopy(value) {
  if (/^[a-z0-9-]+$/.test(value)) return true; // an id or slug
  if (/^[./@#]|^https?:/.test(value)) return true; // a path, an alias import, a URL, an anchor
  if (/^[a-z-]+:\s[^.!?]*$/.test(value)) return true; // a css declaration
  if (/^use (client|server)$/.test(value)) return true;
  return !PROSE.test(value);
}

/**
 * Blank out comments, keeping every other character in place so offsets still map to line numbers.
 * Engineering prose belongs in comments; this linter must never read them as copy — and the JSX
 * text pass below would happily match a comment sitting between two elements.
 */
export function blankComments(text) {
  const blanked = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return blanked
    .split('\n')
    .map((line) => {
      for (let i = 0; i < line.length - 1; i++) {
        if (line[i] !== '/' || line[i + 1] !== '/' || line[i - 1] === ':') continue;
        // An odd number of quotes before it means the `//` is inside a string, not starting a
        // comment. Crude, and it errs toward leaving the line alone.
        const quotes = (line.slice(0, i).match(/['"`]/g) || []).length;
        if (quotes % 2 === 0) return line.slice(0, i) + ' '.repeat(line.length - i);
      }
      return line;
    })
    .join('\n');
}

/**
 * The string literals on one line that a founder can read — attribute values that render, labels,
 * sentences assigned to constants. Anything sitting behind `className=`, a route, an import or a
 * log call is code.
 */
export function visibleLiterals(line) {
  const out = [];
  const lit = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let m;
  while ((m = lit.exec(line))) {
    const before = line.slice(0, m.index);
    if (INVISIBLE_ATTR.test(before) || LOG_CALL.test(before)) continue;
    if (/\b(from|import|require)\s*\(?\s*$/.test(before)) continue;
    // A `${…}` interpolation is code, not copy: `it checked in ${describeGap(engine.ageMinutes)} ago`
    // is a perfectly plain sentence, and the only banned word in it is an identifier the founder
    // never sees. What the expression EVALUATES to is copy — and is caught wherever it was written.
    const value = m[2].replace(/\$\{[^}]*\}/g, ' ').replace(/\\u2019/g, '’').replace(/\\[nt]/g, ' ');
    if (!isNotCopy(value)) out.push({ value, column: m.index });
  }
  return out;
}

/**
 * JSX text runs — what sits between a closing `>` and the next opening `<`. Run over the whole file
 * rather than line by line, because almost all of this studio's prose is wrapped across lines and a
 * per-line reading sees only fragments (which is how "branch protection and whether automatic checks
 * are set up" hid from the first version of this linter).
 */
export function jsxText(text) {
  const out = [];
  const re = />([^<>{}]+)</g;
  let m;
  while ((m = re.exec(text))) {
    const value = m[1].replace(/\s+/g, ' ').trim();
    if (!isNotCopy(value) && !IS_CODE.test(value)) out.push({ value, index: m.index + 1, raw: m[1] });
  }
  return out;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/**
 * Lint one file's contents. Every rule here is about the words alone, so unlike design-lint this
 * needs no path — a sentence is founder copy or it is not, wherever it was written.
 * @param {string} text
 * @returns {{line:number, rule:string, say:string, snippet:string}[]}
 */
export function lintText(text) {
  const violations = [];
  const rawLines = text.split('\n');

  // Opt-outs come from the raw text — they live in the comments the passes below blank out.
  const excused = new Set();
  rawLines.forEach((line, i) => {
    if (BARE_OPT_OUT.test(line)) {
      violations.push({
        line: i + 1,
        rule: 'unreasoned-opt-out',
        say: 'name the reason: `copy-lint-ok: <why this surface is not founder-facing>`',
        snippet: line.trim().slice(0, 80),
      });
      return;
    }
    if (!OPT_OUT.test(line)) return;
    excused.add(i + 1); // the line the opt-out is written on…
    // …and the line it introduces. A comment above the copy is the readable place to put a reason,
    // and a reason worth reading rarely fits on one line — so skip the rest of the comment and
    // excuse the first real line after it, not blindly the next one.
    if (!IS_COMMENT_LINE.test(line)) return;
    for (let j = i + 1; j < rawLines.length; j++) {
      excused.add(j + 1);
      if (!IS_COMMENT_LINE.test(rawLines[j]) && rawLines[j].trim()) break;
    }
  });

  const check = (value, line) => {
    if (excused.has(line)) return;
    for (const term of BANNED) {
      if (term.re.test(value)) {
        violations.push({ line, rule: term.id, say: term.say, snippet: value.trim().slice(0, 90) });
      }
    }
  };

  const blanked = blankComments(text);
  blanked.split('\n').forEach((line, i) => {
    for (const { value } of visibleLiterals(line)) check(value, i + 1);
  });
  for (const run of jsxText(blanked)) {
    // Report where the words are, not where the run began — a wrapped paragraph is one run.
    for (const term of BANNED) {
      const hit = term.re.exec(run.raw);
      if (!hit) continue;
      const line = lineOf(blanked, run.index + hit.index);
      if (excused.has(line)) continue;
      violations.push({ line, rule: term.id, say: term.say, snippet: run.value.slice(0, 90) });
    }
  }

  return violations.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

// --- driver ---------------------------------------------------------------------------------

// app/ and components/ are the screens. lib/ is included only where founder sentences actually live:
// a component importing its copy from lib/ would otherwise be a hole straight through this.
export const COPY_MODULES = [
  'lib/brief.ts',
  'lib/composer.ts',
  'lib/firstrun.ts',
  'lib/founder-message.ts', // FB-279: what a founder's phone and inbox are told
  'lib/glossary.ts',
  'lib/meta-ads.ts', // FB-248: the ads page's statuses and caveats are written here
  'lib/provenance.ts',
  'lib/read-failures.ts',
  'lib/runreports.ts',
  'lib/status.ts',
  'lib/work-evidence.ts',
  'lib/work.ts',
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__' || entry.startsWith('.')) continue;
      walk(full, out);
    } else if (/\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  if (process.argv.includes('--list')) {
    for (const t of BANNED) console.log(`${t.id.padEnd(14)} ${String(t.re).padEnd(40)} say ${t.say}`);
    return 0;
  }

  const root = process.cwd();
  const screens = ['app', 'components'].flatMap((d) => {
    try {
      return walk(join(root, d));
    } catch {
      return []; // the surface does not exist yet — nothing to enforce
    }
  });
  const files = [...screens, ...COPY_MODULES.map((f) => join(root, ...f.split('/')))];

  let total = 0;
  for (const file of files.sort()) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue; // a copy module that has not been written yet
    }
    const rel = relative(root, file).split(sep).join('/');
    for (const v of lintText(text)) {
      console.error(`${rel}:${v.line}  ${v.rule}  "${v.snippet}"\n      say ${v.say}`);
      total++;
    }
  }

  if (total) {
    console.error(`\n${total} founder-vocabulary violation${total === 1 ? '' : 's'}.`);
    console.error('Terms: node scripts/copy-lint.mjs --list · Contract: lib/glossary.ts · Handbook: "Using your studio"');
    console.error('Admin-only copy may opt out per line: // copy-lint-ok: <reason>');
    return 1;
  }
  console.log(`copy-lint: ${files.length} files clean.`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('copy-lint.mjs')) process.exit(main());
