'use client';

import { useState } from 'react';
import type { PreviewCheck } from '@/lib/result-link';
import { SeeIt } from './SeeIt';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { WorkItem } from '@/lib/work';
import { acceptability, describeChange, isReadable, summariseChanges } from '@/lib/work';
import { toneColor } from '@/lib/status';
import { CHECK_LABEL } from '@/lib/glossary';
import { readEvidence } from '@/lib/work-evidence';
import { showAngleBrackets } from '@/lib/markdown';
import { howLongMs } from '@/lib/when';
import { Mark } from './Mark';
import { Decision } from './Decision';

/**
 * A piece of work, as the founder reads and accepts it (FB-064, reordered by FB-107).
 *
 * The rule this component exists to keep: **show what can be judged, describe what cannot.** Prose —
 * a ticket, a piece of copy, something the founder deposited — is rendered so they can read it. Code
 * is described: what it touches, how big it is, and whether the checks passed. Rendering a
 * TypeScript diff and calling it a review would be asking a founder to rubber-stamp something they
 * cannot read.
 *
 * ## The order is the ticket
 *
 * The page grew bottom-up out of what the machinery could show (FB-064 → FB-081 → FB-071). John read
 * it top-down as a person making a decision, and every complaint he had was the same complaint: the
 * order was inverted. A decision reads
 *
 *   what did I ask for → what did they do → what does it look like → am I OK with it → and, for the
 *   day it matters, the whole record.
 *
 * So that is the order of this file, and the sections below are in it deliberately. The ask used to
 * be at the BOTTOM, rendered as a diff fragment of its own ticket.
 */

const KIND_LABEL: Record<string, string> = {
  description: 'The description of the work',
  writing: 'Writing',
  knowledge: 'Something your venture knows',
  code: 'A change to the app',
  settings: 'Settings',
};

/**
 * A knowledge deposit riding along in the same change needs saying out loud (FB-107).
 *
 * "Something your venture knows" appeared under "What changed" with no introduction, so it read as a
 * category of file rather than as a thing that happened.
 */
const KIND_INTRO: Record<string, string> = {
  knowledge: 'This work also added to what your venture knows:',
};

// FB-076 moved the check labels to lib/glossary: the attention queue shows the same fact, and while
// each surface owned its own copy they drifted — one said "no automatic checks", the other `CI UNKNOWN`.

/** 1. What you asked for. The originating ticket, whole and rendered — never a diff of itself. */
function TheAsk({ ask }: { ask: NonNullable<WorkItem['ask']> }) {
  return (
    <section data-testid="work-ask" style={{ marginBottom: '1.5rem' }}>
      <p className="eyebrow" style={{ marginBottom: '0.4rem' }}>What you asked for</p>
      <div className="card">
        <p style={{ margin: 0, fontSize: 'var(--fs-subhead)', fontWeight: 600 }}>
          <span className="mono muted" style={{ fontSize: 'var(--fs-meta)' }}>{ask.id}</span>{' '}
          {ask.title}
        </p>
        <div className="ticket-body" data-testid="work-ask-body" style={{ fontSize: 'var(--fs-body-sm)', marginTop: '0.6rem' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{ask.bodyMd}</ReactMarkdown>
        </div>
      </div>
    </section>
  );
}

/**
 * 2. What your team did — the team's notes, as a decision (FB-081).
 *
 * Three things in order: what it did, whether it was checked, and what was unusual. The whole record
 * moves to the bottom of the page (FB-107) rather than sitting inside this section: it is the thing
 * a founder reads on the day something went wrong, not part of the decision.
 */
function WhatTheyDid({ body }: { body: string }) {
  const e = readEvidence(body);
  if (!e.did && !e.verdict && e.exceptions.length === 0) return null;

  return (
    <section data-testid="work-description" style={{ marginBottom: '1.5rem' }}>
      <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>What your team did</p>

      {e.did ? (
        <p data-testid="work-did" style={{ fontSize: 'var(--fs-body-sm)', maxWidth: 'var(--content-narrow)', margin: '0 0 0.5rem' }}>
          {e.did}
        </p>
      ) : null}

      {e.verdict ? (
        <p data-testid="work-verdict" style={{ fontSize: 'var(--fs-body-sm)', margin: '0 0 0.5rem', color: toneColor('ok') }}>
          {e.verdict}
        </p>
      ) : null}

      {/* The point of FB-081. "All eight gates passed" is one line; "it took three attempts" is the
          line worth reading, and it used to be indistinguishable from the routine. */}
      {e.exceptions.length > 0 ? (
        <div data-testid="work-exceptions">
          <p className="eyebrow" style={{ marginBottom: '0.25rem' }}>Worth knowing before you decide</p>
          {e.exceptions.map((x, i) => (
            <p key={i} data-testid="work-exception"
               style={{ fontSize: 'var(--fs-meta-lg)', margin: '0.15rem 0 0 0.9rem', textIndent: '-0.9rem',
                        color: toneColor('attention'), maxWidth: 'var(--content-narrow)' }}>
              <span aria-hidden="true">· </span>{x}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * 6. The record — everything the team wrote, last and closed (FB-107).
 *
 * Never hidden, and never in the way. When the summary could not be made (`summarised` is false) it
 * opens by default: a page that quietly collapsed the one paragraph explaining why something is risky
 * would be worse than the wall of text it replaced.
 */
function TheRecord({ body }: { body: string }) {
  const e = readEvidence(body);
  const [showAll, setShowAll] = useState(false);
  const open = showAll || !e.summarised;

  return (
    <section style={{ marginTop: '2rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
      <button
        type="button"
        className="btn"
        data-testid="work-record-toggle"
        aria-expanded={open}
        onClick={() => setShowAll((v) => !v)}
      >
        {open ? 'Hide the full record' : 'Show me everything the team recorded'}
      </button>
      {/* FB-100's item 3: this was a <pre>, so `**Status:**` and `##` reached the founder as literal
          asterisks and hashes while the summary directly above them rendered properly — one
          document, two renderers. It is the same markdown either way; formatting it loses nothing
          and stops the record reading as a machine dump. */}
      {open ? (
        <div
          className="ticket-body"
          data-testid="work-record"
          style={{
            fontSize: 'var(--fs-meta-lg)', overflowX: 'auto',
            background: 'var(--color-paper-raised)', border: '1px solid var(--color-border)',
            padding: '0.7rem', margin: '0.5rem 0 0',
          }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{showAngleBrackets(e.record)}</ReactMarkdown>
        </div>
      ) : null}
    </section>
  );
}

export function WorkDetail({
  ventureId,
  work,
  launch = null,
  waitingMs = null,
  previewCheck = null,
  launchCheck = null,
  off = null,
}: {
  ventureId: string;
  work: WorkItem;
  /** Where this surface's running product opens (FB-093's target), when the venture declares one. */
  launch?: { label: string | null; url: string } | null;
  /**
   * How long this has waited, worked out on the server (FB-241). This component renders in the
   * browser, where the test clock does not exist, so it is handed the age and never the timestamp.
   */
  waitingMs?: number | null;
  /** What opening `work.previewUrl` found (FB-184). Linked only when it opens. */
  previewCheck?: PreviewCheck | null;
  /** What opening `launch.url` found (FB-184). Linked only when it opens. */
  launchCheck?: PreviewCheck | null;
  /** Why the buttons are off: the work is a factory card and the factory is quiet (FB-278). */
  off?: string | null;
}) {
  // Decided here from what was rendered, and decided AGAIN server-side against what is current —
  // this one gives the founder a reason, the server one makes a stale accept impossible.
  const verdict = acceptability(work, { seenHeadSha: work.headSha, configured: true });
  const waiting = waitingMs === null ? null : howLongMs(waitingMs);
  const checkTone = work.checks === 'failure' || work.checks === 'unavailable' ? 'blocked'
    : work.checks === 'success' ? 'ok' : 'working';

  // When the page names the required action, the note starts written. The audit found the page
  // saying "the team needs to bring it up to date" beside no control that could ask for that.
  const suggestion = !verdict.ok && verdict.reason === 'conflicts'
    ? 'Please bring this up to date so it can be accepted.'
    : null;

  // The changed file that IS the ask, so the list below does not print a diff of what the page
  // already renders whole above it.
  const isAsk = (f: { kind: string }) => Boolean(work.ask) && f.kind === 'description';

  return (
    <section data-testid={`work-${work.repo}/${work.number}`}>
      <p className="eyebrow">
        <span className="eyebrow-id">Work</span> — waiting for you
      </p>
      {/* The ticket's title where there is one. The work's own title is branch-speak — John met
          "build: show-set-name-card-pages (Foundry lane)" as the heading of his own product's work. */}
      <h1 style={{ margin: '0 0 0.5rem' }}>{work.ask?.title ?? work.title}</h1>
      <p className="muted" style={{ fontSize: 'var(--fs-body-sm)', marginTop: 0 }}>
        {summariseChanges(work.files, work.moreFiles)}
        {/* FB-081: the queue said "17h old" and this page said nothing about time at all, so a
            founder deciding whether to read it now or later had nothing to decide with. */}
        {waiting ? <> · Waiting {waiting} for you.</> : null}
      </p>

      <p
        data-testid="work-checks"
        data-checks={work.checks}
        style={{
          fontSize: 'var(--fs-body-sm)',
          color: checkTone === 'blocked' ? toneColor('blocked') : undefined,
          fontWeight: checkTone === 'blocked' ? 600 : undefined,
        }}
      >
        {work.checks === 'failure' || work.checks === 'unavailable' ? (
          <>
            <Mark />
            <span className="sr-only">Warning: </span>
          </>
        ) : null}
        {CHECK_LABEL[work.checks] ?? CHECK_LABEL.unknown}
      </p>

      {/* 1. What you asked for. */}
      {work.ask ? <TheAsk ask={work.ask} /> : null}

      {/* 2. What your team did. */}
      {work.description ? <WhatTheyDid body={work.description} /> : null}

      {/* 3. See it. Each address is a link only when the studio opened it and it worked (FB-184). */}
      <SeeIt previewCheck={previewCheck} launch={launch} launchCheck={launchCheck} />

      {/* 4. The changes. After the human summary, never instead of it. */}
      <div data-testid="work-changes" style={{ marginBottom: '1.5rem' }}>
        <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>The changes in detail</p>
        {work.files.length === 0 ? (
          <p className="card muted" style={{ fontSize: 'var(--fs-body-sm)' }}>
            No changes were recorded for this work.
          </p>
        ) : (
          work.files.map((f, i) => (
            <div key={f.path} data-testid={`work-file-${i}`} data-kind={f.kind} style={{ marginBottom: '0.6rem' }}>
              {KIND_INTRO[f.kind] ? (
                <p className="muted" style={{ fontSize: 'var(--fs-body-sm)', margin: '0 0 0.3rem' }}>{KIND_INTRO[f.kind]}</p>
              ) : null}
              <div className="card">
                <p className="eyebrow" style={{ margin: 0 }}>{KIND_LABEL[f.kind] ?? f.kind}</p>
                {/* The ask is rendered whole at the top of the page. Its diff here is a fragment of
                    itself, and a fragment of markdown shown as plain text is where the founder met
                    a literal `# ARCA-44 —` and `**Status:**`. Point at it instead. */}
                {isAsk(f) ? (
                  <p className="muted" style={{ fontSize: 'var(--fs-body-sm)', margin: '0.4rem 0 0' }}>
                    What you asked for, written down as part of this work — it is at the top of this page.
                  </p>
                ) : isReadable(f.kind) && f.preview ? (
                  <p style={{ fontSize: 'var(--fs-body-sm)', whiteSpace: 'pre-wrap', margin: '0.4rem 0 0', maxWidth: 'var(--content-narrow)' }}>
                    {f.preview}
                  </p>
                ) : (
                  <p className="muted" style={{ fontSize: 'var(--fs-body-sm)', margin: '0.4rem 0 0' }}>
                    {describeChange(f)}
                  </p>
                )}
              </div>
            </div>
          ))
        )}
        {work.moreFiles > 0 ? (
          <p className="muted" data-testid="work-more" style={{ fontSize: 'var(--fs-meta)' }}>
            Showing the first {work.files.length} of {work.files.length + work.moreFiles} files.
          </p>
        ) : null}
        {/* A reference, not a requirement. The drawer over-linked to the code host and this page did
            not link at all; both are wrong in the same way — the founder decides here, and the
            original is one quiet click away for the day they want it. */}
        {work.url ? (
          <p className="muted" style={{ fontSize: 'var(--fs-meta)', marginTop: '0.5rem' }}>
            <a href={work.url} target="_blank" rel="noreferrer" data-testid="work-source-link">
              See the original ↗
            </a>
          </p>
        ) : null}
      </div>

      {/* 5. The decision. Two ways out of this page, and the page must offer both: before FB-107 a
          founder who did not want the work could only leave it sitting there.
          Same shape as the approve card, on purpose — one pattern for agreeing to something. */}
      <Decision
        look="work"
        ventureId={ventureId}
        work={work}
        merged={work.merged}
        suggestion={suggestion}
        off={off}
        blocked={verdict.ok ? null : (
          <p
            data-testid="work-blocked"
            data-reason={verdict.reason}
            style={{ fontSize: 'var(--fs-body-sm)', margin: 0, maxWidth: 'var(--content-narrow)', color: toneColor('attention') }}
          >
            {verdict.text}
            {verdict.nextStep ? <> <strong>What to do:</strong> {verdict.nextStep}</> : null}
          </p>
        )}
      />

      {/* 6. The record. */}
      {work.description ? <TheRecord body={work.description} /> : null}
    </section>
  );
}
