'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { Decision, type DecisionResult, type ReviewNotes } from './Decision';
import { isSettled, noteFrom, pictureWords, type CardState, type Pin, type PictureName, type ReviewView } from '@/lib/review';
import { BUTTONS_OFF } from '@/lib/presses';

/**
 * The Review screen (FB-274), drawn as the "Studios, aligned" canvas draws it, in the Bruntsfield
 * Studios design system (`bs-` classes in `app/globals.css`).
 *
 * Everything it shows came through `reviewFor` on the server, so a founder's copy of this component
 * never holds John's parts. What it keeps for itself is what the person is doing right now: which
 * picture they are looking at, and the notes they have pinned but not yet sent.
 *
 * A note is pinned by clicking a spot on any of the four pictures. Each pin keeps its picture and
 * its place, and `noteFrom` writes them into the one note that goes with Send back (or with a
 * sign-off): "1. On the "after" picture, on a phone, 82% across and 41% down: …".
 */

type When = 'before' | 'after';
type Size = 'computer' | 'phone';

const pictureName = (when: When, size: Size) => `${when}-${size}` as PictureName;

/** "2 Oct". In London time, so the server's page and the browser's agree about the day. */
function day(iso: string | null): string {
  if (!iso) return '';
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(at);
}

/** "2 Oct, 16:40". */
function dayAndTime(iso: string | null): string {
  if (!iso) return '';
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' }).format(at);
  return `${day(iso)}, ${time}`;
}

/** "2 October". */
function longDay(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/London' }).format(at);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** John's other presses, as the screen names them once made (FB-276). */
const DECIDED: Record<Extract<CardState, { kind: 'decided' }>['action'], string> = {
  stop: 'Stopped',
  reject: 'Rejected',
  'try-again': 'Sent to try again',
  split: 'Sent to be split',
};

/** The state, as the flag at the top of the screen says it. */
function stateFlag(state: CardState, isJohn: boolean): { tone: string; text: string } {
  // The box said the press did nothing, or never answered it: the card says so first.
  if ('answer' in state && state.answer && state.answer.outcome !== 'done') return { tone: 'is-attention', text: 'Nothing was done' };
  if ('lapsed' in state && state.lapsed) return { tone: 'is-attention', text: 'Nothing was done' };
  switch (state.kind) {
    case 'finished':
      return { tone: 'is-attention', text: 'Ready for review' };
    case 'signed-off':
      return isJohn ? { tone: 'is-attention', text: 'Signed off · your decision' } : { tone: 'is-ok', text: 'Signed off · waiting for John' };
    case 'sent-back':
      return { tone: 'is-attention', text: 'Sent back' };
    case 'approved':
      return state.answer ? { tone: 'is-ok', text: 'Part of the product' } : { tone: 'is-working', text: 'Approved · waiting for the factory' };
    case 'decided':
      return state.answer
        ? { tone: 'is-attention', text: DECIDED[state.action] }
        : { tone: 'is-working', text: `${DECIDED[state.action]} · waiting for the factory` };
  }
}

export function ReviewScreen({ view }: { view: ReviewView }) {
  const isJohn = view.viewer.isJohn;
  const [state, setState] = useState<CardState>(view.state);
  const [when, setWhen] = useState<When>('after');
  const [size, setSize] = useState<Size>('computer');
  const [pins, setPins] = useState<Pin[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [whole, setWhole] = useState('');
  const noteBoxes = useRef(new Map<number, HTMLTextAreaElement>());
  const focusPin = useRef<number | null>(null);

  // On a phone, start on the phone pictures, as the design's phone screen does.
  useEffect(() => {
    if (window.matchMedia('(max-width: 45rem)').matches) setSize('phone');
  }, []);

  useEffect(() => {
    if (focusPin.current === null) return;
    noteBoxes.current.get(focusPin.current)?.focus({ preventScroll: true });
    focusPin.current = null;
  }, [pins]);

  const shown = pictureName(when, size);
  const picture = view.pictures.find((p) => p.name === shown) ?? null;
  const settled = isSettled(state);
  // Notes go with a press, so they are offered only to someone who still has one to make: not once
  // the card is settled, and not to a founder who has already signed it off.
  const canNote = !settled && !(state.kind === 'signed-off' && !isJohn);

  const drop = (e: MouseEvent<HTMLDivElement>) => {
    if (!canNote || !picture) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((e.clientX - box.left) / box.width) * 100));
    const y = Math.min(100, Math.max(0, ((e.clientY - box.top) / box.height) * 100));
    focusPin.current = pins.length;
    setActive(pins.length);
    setPins([...pins, { picture: shown, x, y, text: '' }]);
  };

  const pick = (i: number) => {
    setActive(i);
    const [w, s] = pins[i].picture.split('-') as [When, Size];
    setWhen(w);
    setSize(s);
  };

  const writePin = (i: number, text: string) => setPins(pins.map((p, j) => (j === i ? { ...p, text } : p)));
  const removePin = (i: number) => {
    setPins(pins.filter((_, j) => j !== i));
    setActive(null);
  };

  // What goes with a press. A founder sends their own notes. John sends his own, or, when he has
  // written none, the notes the founder signed off with, so "Send it back with the founder's notes" means it.
  const written = pins.filter((p) => p.text.trim()).length + (whole.trim() ? 1 : 0);
  const own = noteFrom(pins, whole);
  const founderNote = state.kind === 'signed-off' ? state.note : '';
  const reviewNotes: ReviewNotes | null = own
    ? { text: own, sendBackLabel: `Send it back with my ${plural(written, 'note')}`, sendBackShort: 'Send it back' }
    : isJohn && founderNote
      ? { text: founderNote, sendBackLabel: `Send it back with ${state.kind === 'signed-off' ? state.by : 'the founder'}’s notes`, sendBackShort: 'Send it back' }
      : null;

  const decided = (r: DecisionResult) => {
    const at = new Date().toISOString();
    if (r.decided === 'send-back') {
      setState({ kind: 'sent-back', by: 'you', at, note: reviewNotes?.text ?? '', signedOffBy: state.kind === 'signed-off' ? state.by : null, answer: null });
    } else if (r.signedOff) {
      setState({ kind: 'signed-off', by: 'you', at, note: own });
    } else {
      // Recorded, not yet done: the factory makes it part of the product, and says so (FB-276).
      setState({ kind: 'approved', by: 'you', at, signedOffBy: state.kind === 'signed-off' ? state.by : null, answer: null });
    }
    setPins([]);
    setWhole('');
    setActive(null);
  };

  const flag = stateFlag(state, isJohn);
  const pinsHere = pins.map((p, i) => ({ ...p, i })).filter((p) => p.picture === shown);
  const preview = view.preview;
  const opens = preview?.state === 'opens';
  const lastLine = trailLast(state, isJohn);

  return (
    <div className={`bs-root rv${isJohn ? ' rv-for-john' : ''}`} data-testid="review-screen" data-state={state.kind}>
      <div className="bs-page rv-page">
        <header className="bs-head">
          <Link className="bs-link rv-back" href={`/venture/${view.ventureId}/tickets`} data-testid="review-back">
            ← Back to Needs you
          </Link>
          <div className="bs-eyebrow">
            <span className="bs-cat">{view.ref}</span>
            <span>
              <span className="rv-wide">{view.ventureName} · </span>Finished work
              {state.kind === 'finished' ? <span className="rv-wide"> · <span className="rv-eyebrow-state">ready for you to look at</span></span> : null}
            </span>
          </div>
          <div className="bs-head__row">
            <h1 className="bs-title" data-testid="review-title">{view.title}, finished.</h1>
            <span className="bs-meta rv-meta">
              Finished {longDay(view.finishedAt)}
              {view.place.of > 0 ? ` · ${view.place.index} of ${plural(view.place.of, 'piece')} of finished work` : ''}
            </span>
          </div>
          <p className="bs-summary" data-testid="review-summary">
            {view.summary}
            {canNote ? (
              <span className="rv-wide">
                {isJohn
                  ? ' Try it, mark anything on the picture that looks wrong, then make it part of the product or send it back.'
                  : ' Try it, mark anything on the picture that looks wrong, then sign it off or send it back with your notes.'}
              </span>
            ) : null}
          </p>
          <div className="rv-flags">
            {view.quiet ? <span className="bs-flag is-attention" data-testid="review-quiet" role="status">{view.quiet}</span> : null}
            <span className={`bs-flag ${flag.tone}`} data-testid="review-state">{flag.text}</span>
            {opens ? <span className="bs-flag is-working rv-wide">Preview running</span> : null}
            <span className={`bs-flag ${view.checks.passed === view.checks.total ? 'is-ok' : 'is-attention'}`}>
              {view.checks.passed} of {view.checks.total} checks passed
            </span>
            {view.demo ? <span className="bs-flag is-watermark">Demo record · illustrative picture</span> : null}
          </div>
        </header>

        <div className="rv-tools">
          <div className="rv-try">
            {opens && preview ? (
              <a className="bs-btn bs-btn--primary" href={preview.url} target="_blank" rel="noreferrer" data-testid="review-preview">
                Try it yourself ↗
              </a>
            ) : null}
            {canNote ? <span className="help rv-quiet rv-narrow">Tap a picture to pin a note.</span> : null}
            <span className={`help rv-try__help${opens ? ' rv-wide' : ''}`} data-testid={opens ? undefined : 'review-preview-why'}>
              {opens
                ? `Opens ${view.ventureName} as it will look. Nothing you do there reaches your real customers.`
                : preview?.state === 'does-not-open'
                  ? `The preview did not open when the studio checked, because ${preview.reason}. The pictures below were taken from it.`
                  : 'There is no preview to try for this one. The pictures below show the change.'}
            </span>
          </div>
          <div className="rv-switches">
            <div className="bs-segmented rv-switch" role="radiogroup" aria-label="Which picture">
              {(['before', 'after'] as const).map((w) => (
                <button key={w} type="button" role="radio" aria-checked={when === w} data-testid={`review-show-${w}`}
                        className={`bs-option${when === w ? ' is-selected' : ''}`} onClick={() => setWhen(w)}>
                  <b>{w === 'before' ? 'Before' : 'After'}</b>
                </button>
              ))}
            </div>
            <div className="bs-segmented rv-switch" role="radiogroup" aria-label="Screen size">
              {(['computer', 'phone'] as const).map((s) => (
                <button key={s} type="button" role="radio" aria-checked={size === s} data-testid={`review-show-${s}`}
                        className={`bs-option${size === s ? ' is-selected' : ''}`} onClick={() => setSize(s)}>
                  <b>{s === 'computer' ? 'Computer' : 'Phone'}</b>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rv-grid">
          <section className="bs-case rv-case" aria-label="The picture">
            <div className="rv-case__head">
              <span className="label rv-case__label">
                {when === 'before' ? 'Before' : 'After'} · on a {size === 'phone' ? 'phone' : 'computer'}
              </span>
              {view.picturesTakenAt ? <span className="mono rv-case__when rv-wide">taken from the preview · {dayAndTime(view.picturesTakenAt)}</span> : null}
            </div>

            {picture ? (
              <div className={size === 'phone' ? 'rv-phone' : undefined}>
                <div
                  className={`rv-shot${canNote ? ' is-pinnable' : ''}`}
                  data-testid="review-shot"
                  onClick={drop}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a picture served by the studio's own route, behind its venture check */}
                  <img
                    src={picture.src}
                    width={picture.width}
                    height={picture.height}
                    alt={`${view.title}: ${pictureWords(picture.name)}`}
                    data-testid="review-picture"
                    data-picture={picture.name}
                    draggable={false}
                  />
                  {pinsHere.map((p) => (
                    <button
                      key={p.i}
                      type="button"
                      className={`rv-pin${active === p.i ? ' is-active' : ''}`}
                      style={{ left: `${p.x}%`, top: `${p.y}%` }}
                      aria-label={`Note ${p.i + 1}`}
                      data-testid={`review-pin-${p.i + 1}`}
                      onClick={(e) => { e.stopPropagation(); pick(p.i); }}
                    >
                      {p.i + 1}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="ui rv-nopicture" data-testid="review-no-picture">
                There is no picture of this one. The preview is the way to see it.
              </p>
            )}

            {view.changes.length ? (
              <ul className="rv-changes">
                {view.changes.map((c, i) => (
                  <li key={i} className="rv-diff">
                    <span className="bs-mark is-ok" />
                    <span><b>{c.label}:</b> {c.text}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <aside className="rv-side">
            {canNote ? (
              <section className="bs-section rv-notes" aria-labelledby="rv-notes-h">
                <div className="bs-section__head">
                  <h2 className="heading rv-h" id="rv-notes-h">Your notes</h2>
                  <span className="mono rv-quiet">{plural(pins.length, 'note')} on the pictures</span>
                </div>
                <p className="help rv-quiet rv-notes__help">
                  Click or tap anywhere on a picture to drop a note there. Your team sees exactly where you clicked.
                </p>
                {pins.length ? (
                  <ol className="rv-notes__list">
                    {pins.map((p, i) => (
                      <li key={i} className={`rv-note${active === i ? ' is-active' : ''}`} data-testid={`review-note-${i + 1}`}>
                        <button type="button" className={`rv-pin rv-note__n${active === i ? ' is-active' : ''}`} aria-label={`Show note ${i + 1}`} onClick={() => pick(i)}>
                          {i + 1}
                        </button>
                        <div className="rv-note__body">
                          <textarea
                            ref={(el) => { if (el) noteBoxes.current.set(i, el); else noteBoxes.current.delete(i); }}
                            className="rv-note__text"
                            rows={2}
                            value={p.text}
                            placeholder="What should change here?"
                            aria-label={`Note ${i + 1}, on ${pictureWords(p.picture)}`}
                            data-testid={`review-note-text-${i + 1}`}
                            onFocus={() => setActive(i)}
                            onChange={(e) => writePin(i, e.target.value)}
                          />
                          <span className="mono rv-quiet">
                            On {pictureWords(p.picture)} ·{' '}
                            <button type="button" className="rv-remove" onClick={() => removePin(i)}>Remove</button>
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : null}
                {founderNote && isJohn ? <SignedOffNotes by={state.kind === 'signed-off' ? state.by : ''} note={founderNote} /> : null}
                <div className="rv-whole">
                  <label className="label rv-whole__label" htmlFor="rv-whole">A note about the whole thing</label>
                  <textarea
                    id="rv-whole"
                    className="bs-input rv-whole__box"
                    rows={3}
                    value={whole}
                    placeholder="Anything that isn’t about one spot on a picture"
                    data-testid="review-whole-note"
                    onChange={(e) => setWhole(e.target.value)}
                  />
                </div>
              </section>
            ) : null}

            <DecisionPanel view={view} state={state} reviewNotes={reviewNotes} written={written} onDecided={decided} />
          </aside>
        </div>

        <section className="bs-section rv-trail" aria-labelledby="rv-trail-h">
          <h2 className="heading rv-h" id="rv-trail-h">Follow the change</h2>
          <ol className="bs-feed">
            {view.trail.map((t, i) => (
              <li key={i} className="bs-feed__row">
                <span className="bs-feed__time">{day(t.at)}</span>
                <span className={`bs-mark is-${t.tone}`} />
                <span className="bs-feed__text">{t.text}</span>
              </li>
            ))}
            {opens && preview ? (
              <li className="bs-feed__row">
                <span className="bs-feed__time">{day(view.picturesTakenAt)}</span>
                <span className="bs-mark is-working" />
                <span className="bs-feed__text"><a href={preview.url} target="_blank" rel="noreferrer">A preview is running</a> ↗</span>
              </li>
            ) : null}
            {isJohn && view.forJohn?.runUrl ? (
              <li className="bs-feed__row" data-testid="review-run">
                <span className="bs-feed__time">{day(view.finishedAt)}</span>
                <span className="bs-mark is-ok" />
                {/* copy-lint-ok: John only — a founder's copy of this screen is never given the run's address */}
                <span className="bs-feed__text"><a href={view.forJohn.runUrl} target="_blank" rel="noreferrer">The factory’s run</a> ↗</span>
              </li>
            ) : null}
            <li className="bs-feed__row" data-testid="review-trail-last">
              <span className="bs-feed__time">{state.kind === 'finished' ? 'now' : day(state.at)}</span>
              <span className={`bs-mark ${settled ? 'is-ok' : 'is-attention'}`} />
              <span className="bs-feed__text">{lastLine}</span>
            </li>
          </ol>
        </section>
      </div>
    </div>
  );
}

/** The last line of "Follow the change": where it stands now, for whoever is reading. */
function trailLast(state: CardState, isJohn: boolean): string {
  // What the factory said, when it says the press did nothing. When it did it, the line says so already.
  const said = 'answer' in state && state.answer && state.answer.outcome !== 'done' ? ` ${state.answer.message}` : '';
  const lapsed = 'lapsed' in state && state.lapsed ? `${state.lapsed.message} ` : '';
  switch (state.kind) {
    case 'finished':
      return `${lapsed}${isJohn ? 'Waiting for the founder’s sign-off. You can decide now.' : 'Waiting for your sign-off.'}`;
    case 'signed-off':
      return `${lapsed}${state.by === 'you' ? 'Signed off by you. Waiting for John.' : `Signed off by ${state.by}. Waiting for your decision.`}`;
    case 'sent-back':
      return said ? `Sent back by ${state.by}.${said}` : `Sent back by ${state.by}. Your team is on it.`;
    case 'approved':
      if (!state.answer) return `Approved by ${state.by}. Waiting for the factory to make it part of the product.`;
      return said ? `Approved by ${state.by}.${said}` : `Made part of the product by ${state.by}.`;
    case 'decided':
      return `${DECIDED[state.action]} by ${state.by}.${state.answer ? said : ' Waiting for the factory.'}`;
  }
}

/** The notes a founder signed off with, as John reads them before he decides. */
function SignedOffNotes({ by, note }: { by: string; note: string }) {
  return (
    <div className="rv-theirs" data-testid="review-founder-notes">
      <span className="label rv-whole__label">Notes from {by}</span>
      <p className="ui rv-theirs__text">{note}</p>
    </div>
  );
}

function DecisionPanel({
  view, state, reviewNotes, written, onDecided,
}: {
  view: ReviewView;
  state: CardState;
  reviewNotes: ReviewNotes | null;
  written: number;
  onDecided: (r: DecisionResult) => void;
}) {
  const isJohn = view.viewer.isJohn;
  const work = { repo: view.repo, number: view.number, headSha: view.headSha };
  const count = view.place.of > 0 ? `${view.place.index} of ${view.place.of}` : '';
  const product = `${view.ventureName}`;

  if (state.kind === 'sent-back') {
    return (
      <section className="bs-decision rv-decision" aria-label="Sent back" data-testid="review-decision">
        <div className="bs-decision__head"><span className="label rv-head-attention">Sent back</span><span className="mono rv-quiet">{day(state.at)}</span></div>
        <div className="rv-flags"><span className="bs-flag is-attention">Sent back by {state.by}</span></div>
        {state.answer ? <BoxSaid answer={state.answer} /> : <p className="ui rv-ink">Your team has the notes and starts again. It comes back here when they finish.</p>}
        {state.note ? <p className="ui rv-theirs__text" data-testid="review-sent-note">{state.note}</p> : null}
        <NextLink view={view} />
      </section>
    );
  }

  if (state.kind === 'approved') {
    const done = state.answer?.outcome === 'done';
    const head = done ? 'Part of the product' : state.answer ? 'Nothing was done' : 'Approved';
    return (
      <section className={`bs-decision${done ? ' is-done' : ''} rv-decision`} aria-label={head} data-testid="review-decision">
        <div className="bs-decision__head"><span className={`label ${state.answer && !done ? 'rv-head-attention' : 'rv-head-ok'}`}>{head}</span><span className="mono rv-quiet">{day(state.at)}</span></div>
        <div className="rv-flags">
          {state.signedOffBy ? <span className="bs-flag is-ok">Signed off by {state.signedOffBy}</span> : null}
          <span className="bs-flag is-ok">Approved by {state.by === 'you' ? 'you' : state.by}</span>
        </div>
        {state.answer ? <BoxSaid answer={state.answer} /> : (
          <p className="ui rv-ink">The factory makes it part of the product next. This page says when it has.</p>
        )}
        {done ? <p className="ui rv-ink">Nothing more is needed. It appears in What happened.</p> : null}
        <NextLink view={view} />
      </section>
    );
  }

  if (state.kind === 'decided') {
    // Stop, Reject, Try again or Split it, pressed here or on Telegram (FB-276). Drawn as a Send back is.
    const words = DECIDED[state.action];
    return (
      <section className="bs-decision rv-decision" aria-label={words} data-testid="review-decision">
        <div className="bs-decision__head"><span className="label rv-head-attention">{words}</span><span className="mono rv-quiet">{day(state.at)}</span></div>
        <div className="rv-flags"><span className="bs-flag is-attention">{words} by {state.by}</span></div>
        {state.answer ? <BoxSaid answer={state.answer} /> : <p className="ui rv-ink">The factory does this next. This page says when it has.</p>}
        <NextLink view={view} />
      </section>
    );
  }

  if (!isJohn && state.kind === 'signed-off') {
    return (
      <section className="bs-decision is-done rv-decision" aria-label="Your sign-off" data-testid="review-decision">
        <div className="bs-decision__head"><span className="label rv-head-ok">Signed off</span><span className="mono rv-quiet">{day(state.at)}</span></div>
        <div className="rv-flags">
          <span className="bs-flag is-ok" data-testid="review-signed-by">Signed off by {state.by}</span>
          <span className="bs-flag is-attention">Waiting for John</span>
        </div>
        <Lapsed state={state} />
        <p className="ui rv-ink">Nothing more is needed from you. When John makes it part of {product}, it appears in What happened.</p>
        <NextLink view={view} primary />
      </section>
    );
  }

  return (
    <section className="bs-decision rv-decision" aria-label={isJohn ? 'Your decision' : 'Your sign-off'} data-testid="review-decision">
      <div className="bs-decision__head">
        <span className="label rv-head-attention">{isJohn ? 'Your decision' : 'Your sign-off'}</span>
        <span className="mono rv-quiet">{count}</span>
      </div>
      {isJohn && state.kind === 'signed-off' ? (
        <div className="rv-flags"><span className="bs-flag is-ok" data-testid="review-signed-by">Signed off by {state.by} · {day(state.at)}</span></div>
      ) : null}
      <dl className="bs-decision__facts">
        <dt>Reaches</dt><dd>{view.reaches}</dd>
        {isJohn ? (
          <>
            <dt>Costs</dt><dd data-testid="review-cost">{view.forJohn?.cost ?? 'Not reported'}</dd>
            <dt>Notes</dt><dd>{state.kind === 'signed-off' && state.note ? `From ${state.by}, below` : 'None from the founder'}</dd>
          </>
        ) : (
          <>
            <dt>Checked</dt><dd>{view.checks.passed} of {view.checks.total} checks passed</dd>
            <dt>Next</dt><dd>John makes it part of {product}</dd>
          </>
        )}
      </dl>
      {isJohn && view.forJohn?.nextStep ? <p className="help rv-quiet" data-testid="review-next-step">{view.forJohn.nextStep}</p> : null}
      <Lapsed state={state} />
      <Decision
        look="review" ventureId={view.ventureId} work={work} isJohn={isJohn} reviewNotes={reviewNotes} onDecided={onDecided}
        off={view.quiet ? BUTTONS_OFF : null}
      />
      <p className="help rv-quiet rv-decision__help">
        {isJohn
          ? 'Only your decision makes it part of the product.'
          : written
            ? `${plural(written, 'note')} go${written === 1 ? 'es' : ''} with it either way.`
            : 'You can sign it off and still leave notes. Your team picks them up next time.'}
      </p>
    </section>
  );
}

/** The last press, when the factory let it lapse (FB-278): what became of it, above the buttons that are back. */
function Lapsed({ state }: { state: CardState }) {
  if (!('lapsed' in state) || !state.lapsed) return null;
  return <p className="ui rv-ink" data-testid="review-lapsed">{state.lapsed.message}</p>;
}

/** What the factory said happened, once it has (FB-276). */
function BoxSaid({ answer }: { answer: NonNullable<Extract<CardState, { kind: 'approved' }>['answer']> }) {
  return <p className="ui rv-ink" data-testid="review-answer" data-outcome={answer.outcome}>{answer.message}</p>;
}

function NextLink({ view, primary = false }: { view: ReviewView; primary?: boolean }) {
  const href = view.place.next ?? `/venture/${view.ventureId}/tickets`;
  return (
    <div className="bs-toolbar">
      <Link className={primary ? 'bs-btn bs-btn--primary' : 'bs-link'} href={href} data-testid="review-next">
        {view.place.next ? 'Next piece of finished work →' : 'Back to Needs you →'}
      </Link>
    </div>
  );
}
