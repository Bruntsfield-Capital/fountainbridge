import Link from 'next/link';
import { toneColor } from '@/lib/status';
import { degradedNextStep, type DegradedGroup } from '@/lib/desk';

/**
 * The top of the desk (FB-128): the sentence, then the banner, then what could not be read.
 *
 * The order is the argument and it is contractual. A founder opening this screen should learn, in
 * this sequence: where things stand, what they are personally blocking, and only then what the
 * studio could not see.
 *
 * **The degraded strip is last, deliberately.** It reports a condition that clears on its own, and a
 * thing that fixes itself must never sit above a thing that does not. Putting it at the top —
 * which is where a status banner instinctively goes — would push the one item a founder is blocking
 * below a sentence telling them there is nothing to do.
 */
export function DeskSummary({ sentence }: { sentence: string }) {
  return (
    <p
      // FB-160: not on a phone. The amber banner directly beneath it already says what a founder is
      // blocking, which is the one thing the design's pocket studio leads with.
      className="not-in-pocket"
      data-testid="desk-summary"
      style={{
        // `--fs-subhead` is 15px — SMALLER than body. It is a label size, and this is the lead
        // sentence of the screen a founder leaves open, so it takes the next real step up.
        fontFamily: 'var(--font-serif)',
        fontSize: 'var(--fs-h4)',
        lineHeight: 1.45,
        margin: '0.4rem 0 1rem',
        maxWidth: 'var(--content-narrow)',
      }}
    >
      {sentence}
    </p>
  );
}

/**
 * The amber banner (FB-203, item 4).
 *
 * One box, one click target, the full width of the column. Three things changed and each was a
 * sentence the design does not say:
 *
 *   - **A square, not a ⚠.** An emoji is a different typeface at a size nobody chose, and it reads
 *     as a warning about the studio rather than a fact about the founder's own queue.
 *   - **`Decide now →` is pushed right**, not buried in the middle of the sentence. It is the
 *     action, and an action inside prose is a thing people read past.
 *   - **The whole box is the target.** It was a sentence with a link in it, so most of the box did
 *     nothing when pressed — which teaches a founder that this banner is a notice rather than a way
 *     through.
 *
 * The `Needs you:` prefix is gone from the DOM text too. It was there for a screen reader and it
 * duplicated the rail's own label; the sentence already names the founder as the blocker.
 *
 * **And the clear state is drawn**, which it was not. The design gives it the same box in the quiet
 * border, so the page does not change shape when a founder finishes their queue — the one moment
 * they have earned a screen that looks settled rather than one that looks emptier.
 */
export function BlockerBanner({ line, href }: { line: string | null; href: string }) {
  if (!line) {
    return (
      <p className="blocker blocker-clear" data-testid="blocker-none">
        <span className="blocker-marker" aria-hidden="true" />
        <span className="blocker-line">Nothing is waiting on you. Your team runs on.</span>
      </p>
    );
  }
  return (
    <Link className="blocker" data-testid="blocker-banner" href={href}>
      <span className="blocker-marker" aria-hidden="true" />
      <span className="blocker-line">{line}</span>
      <span className="blocker-decide" data-testid="blocker-decide">Decide now →</span>
    </Link>
  );
}

/**
 * What could not be read, grouped by cause.
 *
 * Named as a condition that clears rather than as a failure the founder must chase — when it is
 * one. Since FB-297 a cause that never clears by itself (a repository the studio isn't allowed to
 * read) says so, and who has to act, instead of "it clears on its own". Nothing here is swallowed
 * (CLAUDE.md #10); it is placed, which is different.
 */
export function DegradedStrip({ groups, ventureId }: { groups: DegradedGroup[]; ventureId: string }) {
  if (groups.length === 0) return null;
  return (
    <section
      className="card"
      data-testid="degraded-strip"
      style={{ fontSize: 'var(--fs-body-sm)', margin: '1.5rem 0', maxWidth: 'var(--content-narrow)' }}
    >
      <p className="eyebrow" style={{ marginTop: 0 }}>Part of this venture could not be read</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {groups.map((g) => (
          <li key={g.cause} data-testid="degraded-group" className="muted" style={{ margin: '0 0 0.3rem' }}>
            {g.cause}
            {g.where.length ? <> <span className="mono">({g.where.join(', ')})</span></> : null}
          </li>
        ))}
      </ul>
      <p className="muted" style={{ fontSize: 'var(--fs-meta-lg)', margin: '0.5rem 0 0' }}>
        {degradedNextStep(groups)}{' '}
        <Link href={`/venture/${ventureId}?refresh=1`} className="mono" data-testid="degraded-refresh">refresh</Link>
      </p>
    </section>
  );
}
