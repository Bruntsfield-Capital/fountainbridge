import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTicket, looksLikeTicket, mapStatus, parseDependsOn, isStoppedStatus } from '../src/index';

const FIX = join(import.meta.dirname, '..', 'fixtures');
const read = (rel: string) => readFileSync(join(FIX, rel), 'utf8');
const parse = (rel: string, repo: string) =>
  parseTicket(read(rel), { repo, path: `docs/tickets/${rel.split('/').pop()}` });

// --- canonical templates, both real formats -------------------------------------------------

test('grassmarket bullet-list format (GRS-0001) parses to the contract', () => {
  const { ticket, warnings } = parse('real/grassmarket/GRS-0001-scaffold.md', 'grassmarket');
  assert.equal(ticket.id, 'GRS-0001');
  assert.equal(ticket.title, 'Scaffold (Loop 0)');
  assert.equal(ticket.phase, '0');
  assert.equal(ticket.status, 'in-progress'); // "In progress"
  assert.equal(ticket.branch, 'grs-0001-scaffold');
  assert.deepEqual(ticket.depends_on, []);
  assert.equal(ticket.repo, 'grassmarket');
  assert.equal(ticket.pr_url, null);
  assert.equal(warnings.length, 0, JSON.stringify(warnings));
});

test('fountainbridge inline format (FB-004) parses to the contract', () => {
  const { ticket, warnings } = parse('real/fountainbridge/FB-004-ticket-file-parser.md', 'fountainbridge');
  assert.equal(ticket.id, 'FB-004');
  assert.equal(ticket.title, 'Ticket-file parser: docs/tickets markdown → Ticket contract');
  assert.equal(ticket.phase, '1');
  assert.deepEqual(ticket.depends_on, ['FB-002']);
  assert.equal(ticket.branch, 'fb-004-ticket-parser');
  assert.equal(ticket.status, 'todo'); // no Status field → parse-time default
  assert.equal(warnings.length, 0, JSON.stringify(warnings));
});

test('letter-suffix ids (GRS-0147b) and "Implemented" status', () => {
  const { ticket, warnings } = parse(
    'real/grassmarket/GRS-0147b-per-profile-metric-selection.md',
    'grassmarket',
  );
  assert.equal(ticket.id, 'GRS-0147b');
  assert.equal(ticket.status, 'done'); // "Implemented (2026-07-19) …"
  assert.equal(warnings.length, 0, JSON.stringify(warnings));
});

// --- graceful degradation (acceptance: 100% parse without throwing) --------------------------

test('non-ticket markdown is flagged, never mistaken for a ticket', () => {
  const { ticket, warnings } = parse('edge/README-not-a-ticket.md', 'fountainbridge');
  assert.ok(warnings.some((w) => w.code === 'no-id'));
  assert.equal(looksLikeTicket({ ticket, warnings }), false);
  // still a valid Ticket object — required fields present
  assert.ok(ticket.id && ticket.repo && ticket.path && ticket.title);
});

test('missing H1: id + title fall back to the filename, no throw', () => {
  const { ticket, warnings } = parse('edge/FB-099-no-heading.md', 'fountainbridge');
  assert.equal(ticket.id, 'FB-099'); // from filename
  assert.ok(warnings.some((w) => w.code === 'no-h1'));
  assert.ok(!warnings.some((w) => w.code === 'no-id')); // filename carried the id
  assert.equal(ticket.status, 'in-progress'); // metadata block still read
  assert.equal(ticket.branch, 'fb-099-orphan');
});

test('empty file parses without throwing', () => {
  const { ticket, warnings } = parse('edge/empty.md', 'fountainbridge');
  assert.equal(ticket.body_md, '');
  assert.ok(warnings.some((w) => w.code === 'no-h1'));
  assert.ok(looksLikeTicket({ ticket, warnings }) === false); // 'empty' has no id
});

test('odd headings + unmappable status: status flagged, body preserved, no throw', () => {
  const { ticket, warnings } = parse('edge/FB-098-weird-status-and-odd-headings.md', 'fountainbridge');
  assert.equal(ticket.id, 'FB-098');
  assert.equal(ticket.status, 'todo'); // "Frobnicated" → default
  assert.ok(warnings.some((w) => w.code === 'unrecognized-status'));
  assert.deepEqual(ticket.depends_on, []); // "Depends on: —"
  assert.ok(ticket.body_md.includes('An odd heading level'));
});

test('parseTicket throws only on missing caller context (usage error, not data)', () => {
  assert.throws(() => parseTicket('# FB-1 — x', { repo: '', path: 'x.md' }));
  assert.throws(() => parseTicket('# FB-1 — x', { repo: 'r', path: '' }));
});

// --- adversarial-review regressions ---------------------------------------------------------

test('ReDoS: a `**` + long colon-less whitespace run returns fast, does not hang', () => {
  // Pre-fix this backtracked cubically (20k spaces never returned). The test completing is the assertion.
  const evil = '**' + ' '.repeat(50000) + 'x';
  const { ticket } = parseTicket(`# FB-1 — t\n${evil}\n`, { repo: 'r', path: 'docs/tickets/FB-1.md' });
  assert.equal(ticket.id, 'FB-1');
});

test('empty file-stem still yields an on-contract (non-empty) id and title', () => {
  for (const path of ['.md', 'docs/tickets/', 'docs/tickets/.md']) {
    const { ticket } = parseTicket('', { repo: 'r', path });
    assert.ok(ticket.id.length >= 1, `id empty for path ${path}`);
    assert.ok(ticket.title.length >= 1, `title empty for path ${path}`);
  }
});

test('colon-outside-bold metadata (`**Status**: Done`) is read, not silently dropped', () => {
  const md = '# FB-1 — t\n**Status**: Done\n**Branch**: `fb-1-x`\n';
  const { ticket } = parseTicket(md, { repo: 'r', path: 'docs/tickets/FB-1.md' });
  assert.equal(ticket.status, 'done');
  assert.equal(ticket.branch, 'fb-1-x');
});

test('bare "review" no longer over-matches to pr-open', () => {
  assert.equal(mapStatus('design review pending'), 'todo'); // "pending" → todo, not pr-open
  assert.equal(mapStatus('In review'), 'pr-open'); // real phrasing still maps
});

test('bullet value containing `·` is not truncated', () => {
  const md = '# FB-1 — t\n- **Status:** blocked · waiting on FB-2\n';
  const { ticket } = parseTicket(md, { repo: 'r', path: 'docs/tickets/FB-1.md' });
  assert.equal(ticket.status, 'in-progress'); // "blocked" survived the split
});

// --- status vocabulary ----------------------------------------------------------------------

test('mapStatus covers the real free-text vocabulary', () => {
  assert.equal(mapStatus('In progress'), 'in-progress');
  assert.equal(mapStatus('In review — PR #22'), 'pr-open');
  assert.equal(mapStatus('In review — launch ARTIFACTS delivered'), 'pr-open'); // leading clause wins
  assert.equal(mapStatus('Fixed — found in the 2026-07-14 review'), 'done');
  assert.equal(mapStatus('Implemented (2026-07-19).'), 'done');
  assert.equal(mapStatus("⏸ **PAUSED FOR JOHN'S RATIFICATION** — GRS-0004 blocks"), 'in-progress');
  assert.equal(mapStatus('Not started'), 'todo'); // not caught by "started"
  assert.equal(mapStatus('WIP'), 'in-progress');
  assert.equal(mapStatus('Done'), 'done');
  assert.equal(mapStatus('CRITICAL — security'), null); // severity, not a lifecycle state
  assert.equal(mapStatus(''), null);
});

// --- depends_on extraction ------------------------------------------------------------------

test('parseDependsOn extracts ids and handles "none"', () => {
  assert.deepEqual(parseDependsOn('FB-002'), ['FB-002']);
  assert.deepEqual(
    parseDependsOn('GRS-0002/0002a (registry), GRS-0003 (ratified golden master).'),
    ['GRS-0002', 'GRS-0003'],
  );
  assert.deepEqual(parseDependsOn('—'), []);
  assert.deepEqual(parseDependsOn('none'), []);
  assert.deepEqual(parseDependsOn(''), []);
  assert.deepEqual(parseDependsOn('FB-002, FB-002'), ['FB-002']); // de-duped
});

test('an unnumbered ticket parses, and says it needs a number (FB-097)', () => {
  // The composer filed everything as `<PREFIX>-NEW` for weeks. Rejecting those files meant the
  // studio counted them as "not tickets" and dropped them off the board — work a founder asked for,
  // filed successfully, and invisible. That is a stranger failure than showing them.
  const r = parseTicket('# ARCA-NEW — Show set name on card pages\n\n**Status:** Todo\n', {
    repo: 'arca',
    path: 'docs/tickets/ARCA-NEW-show-set-name.md',
  });
  assert.equal(r.ticket.id, 'ARCA-NEW');
  assert.equal(r.ticket.title, 'Show set name on card pages');
  assert.ok(looksLikeTicket(r), 'must parse as a ticket, not be skipped as a stray file');
  assert.ok(r.warnings.some((w) => w.code === 'unnumbered-id'), 'must say it needs a real number');
});

test('a numbered ticket carries no unnumbered warning', () => {
  const r = parseTicket('# ARCA-44 — Seed script\n\n**Status:** Todo\n', {
    repo: 'arca',
    path: 'docs/tickets/ARCA-44-seed.md',
  });
  assert.equal(r.ticket.id, 'ARCA-44');
  assert.ok(!r.warnings.some((w) => w.code === 'unnumbered-id'));
});

test('FB-296: a stopped ticket is settled, and says it was stopped rather than finished', () => {
  const r = parseTicket('# ARCA-068 — Live auction listings\n\n**Status:** Stopped — from ARCA\'s old machine, not carried into the factory\n', { repo: 'arca', path: 'docs/tickets/ARCA-068.md' });
  assert.equal(r.ticket.status, 'done');
  assert.equal(r.stopped, true);
  assert.deepEqual(r.warnings, []);
  for (const s of ['Cancelled', 'Dropped', "Won't do", 'Superseded by ARCA-090']) assert.equal(isStoppedStatus(s), true, s);
  for (const s of ['Done', 'Planned', 'In progress — stopped once, picked up again']) assert.equal(isStoppedStatus(s), false, s);
});

test('FB-296: a finished ticket carries no stopped mark', () => {
  const r = parseTicket('# ARCA-087 — Clear the filters\n\n**Status:** Shipped\n', { repo: 'arca', path: 'docs/tickets/ARCA-087.md' });
  assert.equal(r.ticket.status, 'done');
  assert.equal(r.stopped, undefined);
});
