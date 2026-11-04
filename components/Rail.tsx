import Link from 'next/link';
import { RailNav } from './RailNav';
import { formatMoney } from '@/lib/budgets';
import { toneColor } from '@/lib/status';
import { railWords, type RailData } from '@/lib/rail';
import { builtByFactory } from '@/lib/factory-built';

/**
 * The persistent rail (FB-124).
 *
 * The studio used to be pages a founder navigated between. This makes it a desk they keep open: one
 * column that never goes away, carrying the venture's state — what waits on them, what is being
 * spent, whether the engine is alive — so it is answered on every screen without being asked for.
 *
 * Everything here is a fact or it is absent. A budget with no envelope says "not open" rather than
 * "£0", an engine nobody can hear from says so, and the office is drawn as a placeholder that admits
 * what it is. The rail is the most-seen surface in the product; a number invented here would be
 * believed everywhere.
 */

/**
 * The surface's own short name (FB-203, item 12).
 *
 * A manifest calls it "Build — Product", which is right on the desk where there is room for it and
 * wrong in a 250px rail beside a money figure, where it wraps onto two lines and pushes the figure
 * out of sight. The design's line is `Build £140/£500`.
 *
 * Taken from the manifest's own name rather than from the id: the id is a key, and capitalising a
 * key to make a label is how `growth-ops` becomes "Growth-ops" on somebody's screen.
 */
const shortName = (name: string) => name.split('—')[0].trim() || name;

export function Rail({
  ventureId,
  ventureName,
  ventureStatus,
  data,
  departments,
}: {
  ventureId: string;
  ventureName: string;
  ventureStatus: string;
  /**
   * The venture's live numbers, or `null` while they are still being read (FB-151).
   *
   * One component renders both states rather than a shell and a copy of it: a fallback that is a
   * second implementation of the same rail is a fallback that drifts, and this one is on every
   * screen under a venture.
   */
  data: RailData | null;
  /**
   * In the venture's declared order, so a department with no envelope still has a name to show.
   *
   * FB-203, item 12: the name as well as the id. The rail printed the raw manifest key — `build`,
   * `sell`, `scale` — beside a money figure, which is the studio showing a founder its own filing
   * system. The design's line is `Build £140/£500`.
   */
  departments: { id: string; name: string }[];
}) {
  // One place where "not known yet" becomes words (lib/rail.ts), so the three facts below cannot
  // each decide differently what an unknown looks like.
  const words = railWords(data);
  return (
    // The rail's layout lives in `.rail` in globals.css, not inline. It used to be inline, and
    // `display: flex` there beat the media query meant to hide it on a phone — so a 250px rail sat on
    // a 393px screen, the board scrolled sideways, and no unit test could see it. An inline style is
    // not overridable, which makes it the wrong place for anything responsive.
    // The waiting shell answers to `rail-waiting`, not `rail` (FB-158).
    //
    // While a Suspense boundary resolves, the fallback and the streamed content are BOTH in the
    // document for an instant — measured: two at `domcontentloaded`, one by the time the board is
    // visible. Sharing one test id made that instant a strict-mode violation, and worse, made the
    // two states indistinguishable to anything asking "is the rail there?". They are different
    // things: one of them knows this venture's numbers and one of them does not.
    <nav className="rail" data-testid={data === null ? 'rail-waiting' : 'rail'} aria-label="Venture">
      <Link href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--fs-h4)', letterSpacing: '0.04em' }}>
          BRUNTSFIELD
        </div>
        <div className="eyebrow" style={{ marginTop: '0.1rem' }}>Foundry Studio</div>
      </Link>

      <div className="eyebrow" data-testid="rail-venture" style={{ margin: '1.6rem 0 0.6rem' }}>
        {ventureName} · {ventureStatus}
      </div>
      <div className="hr" style={{ margin: '0 0 0.6rem' }} />

      <RailNav ventureId={ventureId} needsYou={words.needsYou} />

      {/* The office placeholder that stood here is gone (FB-167).
          It read "Not live yet. Your team's desks appear here once this venture's machine reports
          what they are doing" — and it sat three lines above this same rail's engine line saying
          "Your team checked in 2 minutes ago". Two statements about one machine, one screen apart,
          contradicting each other on every venture page in production.
          It was honest when nothing was live. FB-139 built the live office on the desk and its own
          comment here said "FB-139 replaces this" — the replacement shipped, the placeholder did
          not get deleted, and a true sentence became a false one the moment the office became real.
          The office lives on the desk. The rail already answers "is this venture's machine alive"
          once, below, from the run reports. Answering it twice from two sources is exactly what
          FB-139's own constraint forbids: same events, so they cannot disagree. */}

      {/* FB-295: not for a venture the factory builds. These are the old machine's budgets; the
          factory's money is set per piece of work, on the planning box. */}
      {builtByFactory(ventureId) ? null : (
      <div style={{ marginTop: '1.6rem' }}>
        <div className="eyebrow">Budgets, month</div>
        {/* A department with no envelope renders "not set", never a blank line and never "£0".
            The first version rendered an empty <li> for it, so ARCA's Build surface — the one with
            all the work in it — simply was not there, and nothing said why. A budget nobody has set
            and a budget of nothing are different facts. */}
        <ul data-testid="rail-budgets" style={{ listStyle: 'none', margin: '0.4rem 0 0', padding: 0 }}>
          {departments.map((d, i) => {
            const b = words.budgets?.[i] ?? null;
            return (
              <li
                key={d.id}
                className="mono"
                style={{
                  fontSize: 'var(--fs-meta)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                  // FB-211: amber. Over budget is a decision waiting on this founder, not a fault
                  // they cannot clear — and this rail is on every screen, so a routine state in the
                  // alarm colour is the fastest way to teach somebody to ignore it.
                  color: b?.overLimit ? toneColor('attention') : 'var(--color-ink-muted)',
                }}
              >
                <span>{shortName(d.name)}</span>
                {b ? (
                  <span>
                    {formatMoney(b.reportedMinor + b.queuedMinor, b.currency)}/
                    {formatMoney(b.limitMinor, b.currency)}
                  </span>
                ) : words.budgets === null ? (
                  // Still reading. "not set" would be a statement about this venture's setup, and
                  // "£0" would be a statement about its spending; neither is known yet.
                  <span>checking</span>
                ) : (
                  <span>not set</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      )}

      <div style={{ marginTop: '1.6rem', fontSize: 'var(--fs-meta)' }}>
        {/* FB-203, item 12: a square, in the state's own colour, so a founder can see at a glance
            that their venture's machine is alive without reading a sentence about it. The sentence
            stays and stays first-class — the square is aria-hidden, and a state told only in colour
            is a state some readers never get. */}
        <span
          data-testid="rail-engine"
          data-state={words.engine.state}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: '0.5rem',
            color: words.engine.state === 'stalled' ? toneColor('blocked') : 'var(--color-ink-muted)',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              flex: '0 0 auto',
              width: '0.5rem',
              height: '0.5rem',
              background: words.engine.state === 'stalled'
                ? toneColor('blocked')
                : words.engine.state === 'unknown'
                  ? toneColor('idle')
                  : toneColor('working'),
            }}
          />
          <span>{words.engine.text}</span>
        </span>
      </div>

      {/* No link to the venture box's own chat here, and that is deliberate.
       *
       * The first version of this rail had one, and `e2e/composer.spec.ts` caught it: "nothing on the
       * composer sends the founder to another product". That test is FB-065's whole point — the
       * composer was moved inside the studio precisely so a founder stops being handed to a second
       * application — and a link in the persistent rail would have put that hand-off on every screen.
       *
       * The design's rail does not have one either. It was invented here, and removed. The desk keeps
       * its existing link (FB-128's business); a rail is not the place to leave the studio from.
       *
       * ## Two things item 12 asks for that are not here
       *
       * **"The pocket studio (mobile)", above Sign out.** There is nowhere honest for it to go. The
       * pocket studio is not a route — it is what the desk becomes below 48rem, and `?full=1` is the
       * toggle in the other direction. This rail is `display: none` on a phone, so the link would
       * only ever be visible on a desktop, where pressing it does nothing. FB-138 built the screen;
       * it did not build a place to send somebody from a desktop. A nav row that cannot work where it
       * is shown is a dead control, which the design contract forbids.
       *
       * **The office thumbnail, with "3 at work · 3 waiting on you".** The "waiting on you" half is
       * already three rows above this, on the Needs you badge — and FB-167 deleted an office block
       * from this exact spot because it was a second statement about the same machine, one screen
       * apart from the first, and the two disagreed in production. The "at work" half is not free:
       * it needs one run report per surface, and reading those in the rail is precisely what FB-164
       * removed when every screen under a venture was waiting about six seconds for it — including a
       * handbook page whose own content arrives in 279ms. Half a sentence that duplicates the badge,
       * bought with six seconds on every page, is a bad trade. It is written down in the ticket with
       * what it would take: the box publishing a per-surface summary the rail can read in one file.
       */}
      <div style={{ marginTop: 'auto', paddingTop: '1.6rem', fontSize: 'var(--fs-meta)' }}>
        <div>
          <Link href="/api/auth/signout" data-testid="rail-signout">Sign out</Link>
        </div>
      </div>
    </nav>
  );
}
