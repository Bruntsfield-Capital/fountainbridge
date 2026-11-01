import Link from 'next/link';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import type { PrApproval } from '@/lib/attention';
import { loadAccessibleNeedsYou, type WaitingSend } from '@/lib/needs-you-load';
import { loadVentures } from '@/lib/ventures';
import { authorizeVentures, canAccessVenture, parseAdminEmails } from '@/lib/authz';
import { ticketsByRepo } from '@/lib/venture-tickets-index';
import { APPROVAL_REASSURANCE } from '@/lib/glossary';
import { prCiTone, toneColor } from '@/lib/status';
import { groupFailures, needsAction } from '@/lib/read-failures';
import { CHECK_LABEL } from '@/lib/glossary';
import { howLong } from '@/lib/when';
import { Mark } from '@/components/Mark';
import { FactoryQuiet } from '@/components/FactoryQuiet';
import { checkedPreview } from '@/lib/preview-check';
import { whyNoLink } from '@/lib/result-link';
import type { CardRow } from '@/lib/factory-work';

// The attention queue (FB-007): open PRs across every accessible venture, awaiting the human gate.
// Scoping runs server-side in loadAccessibleAttention.
export default async function AttentionPage({
  searchParams,
}: {
  searchParams: Promise<{ refresh?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect('/login');
  const { refresh } = await searchParams;
  // FB-129: absorbed as the Tickets screen's "Needs you" filter. A founder with one venture is sent
  // there, because that screen shows the same work AND lets them decide on it without leaving —
  // which is the whole point of absorbing it. A bookmark must never 404 (its own acceptance
  // criterion), so this is a redirect and not a deletion.
  //
  // Someone who can see more than one venture keeps this page: it is the only cross-venture view of
  // what is waiting, and sending John to one venture's list would quietly lose the other ventures.
  const email = session.user.email;
  const ventures = loadVentures();
  const access = authorizeVentures(email, ventures, parseAdminEmails(process.env.STUDIO_ADMIN_EMAILS));
  const mine = ventures.filter((v) => canAccessVenture(access, v.id));
  if (mine.length === 1) redirect(`/venture/${mine[0].id}/tickets?filter=needs`);

  // FB-099: the queue names work the way the board does. Without the tickets it showed the lane's
  // own branch-speak — "build: bulk-daily-price-feed-plan (Foundry lane)" — for the same items the
  // board listed under their human titles, and a founder had no way to connect the two lists.

  // FB-149: the sends waiting on a founder as well as finished work, from the same rule each
  // venture's desk uses. This page listed finished work only, so an admin's header — which leads
  // here — said 4 while ARCA's desk said 10.
  const needs = await loadAccessibleNeedsYou(session.user.email, {
    refresh: refresh === '1',
    ticketsFor: (venture) => ticketsByRepo(venture, { refresh: refresh === '1' }),
  });
  const { work: approvals, sends, ventureNames, errors, cards } = needs;
  const couldNotRead = errors.length > 0 || needs.sendsUnread.length > 0 || needs.cardsUnread.length > 0;
  const empty = approvals.length === 0 && sends.length === 0 && cards.length === 0;
  // FB-277: the factory's cards are finished work too, so they are rows of the same list, oldest
  // first with the rest. A pull request a card stands for is already gone from `approvals`.
  const finished = [
    ...approvals.map((a) => ({ at: a.createdAt, key: `pr-${a.id}`, pr: a, card: null })),
    ...cards.map((c) => ({ at: c.at, key: `card-${c.ventureId}-${c.key}`, pr: null, card: c })),
  ].sort((x, y) => x.at.localeCompare(y.at) || x.key.localeCompare(y.key));
  // Each venture's own number, as its desk states it. Only when more than one venture has
  // something: one venture's number is the heading's number, and saying it twice is noise.
  const busy = mine.filter((v) => (needs.perVenture[v.id] ?? 0) > 0);

  return (
    <section>
      <p className="eyebrow"><span className="eyebrow-id">Attention</span> — Foundry Studio</p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
        {/* FB-076: one name for one thing. The nav said "Attention", the heading said "Awaiting
            review" and the introduction said "waiting on your OK" — three phrasings, and "review"
            in particular means something specific and different in engineering. */}
        <h1 style={{ margin: 0 }}>Needs you</h1>
        {/* FB-137: a count is a claim. With the reads failing this said `0`, which is the sentence
            "nothing needs you" — the most reassuring thing the studio can say, said on no evidence.
            An em dash and a word for the screen reader instead. */}
        <span className="tag" data-testid="attention-count">
          {couldNotRead && empty ? (
            <>
              <span aria-hidden="true">—</span>
              <span className="sr-only">not known</span>
            </>
          ) : (
            needs.count
          )}
        </span>
      </div>
      <p className="muted" style={{ fontSize: 'var(--fs-body-sm)' }}>
        Everything across your ventures waiting on your OK: anything about to leave a company first,
        then finished work. {APPROVAL_REASSURANCE}{' '}
        <Link href="/attention?refresh=1" className="mono" data-testid="attention-refresh">refresh</Link>
      </p>
      {busy.length > 1 ? (
        <p className="muted" data-testid="attention-per-venture" style={{ fontSize: 'var(--fs-meta)', marginTop: '-0.25rem' }}>
          {busy.map((v, i) => (
            <span key={v.id} data-testid={`attention-per-venture-${v.id}`}>
              {i > 0 ? ' · ' : ''}
              {v.name} {needs.perVenture[v.id]}
            </span>
          ))}
        </p>
      ) : null}
      <hr className="hr" />

      {/* FB-137: empty and degraded are different sentences, and this screen said BOTH — "Nothing is
          waiting for you", and under it "some of your work is not showing". The first is the
          reassurance a founder acts on; the second is the reason it might be wrong. Saying them
          together, in that order, is the confusion this ticket exists to end. */}
      {empty && couldNotRead ? (
        <p className="card" data-testid="attention-unreadable" style={{ fontSize: 'var(--fs-body-sm)' }}>
          <Mark />
          The studio could not read your ventures just now, so it cannot tell you what is waiting.
          It is not that nothing is — it is that it could not look. This clears on its own.
        </p>
      ) : empty ? (
        <p className="card muted" data-testid="attention-empty">Nothing is waiting for you.</p>
      ) : (
        <>
          {sends.length > 0 ? (
            <>
              {/* FB-149: first, because a send is a decision with a consequence outside the company.
                  Each row points at the send's own page, the only place it is decided (FB-183). */}
              <h2 className="eyebrow" style={{ margin: '0 0 0.5rem' }}>About to leave a company</h2>
              <div className="stack" data-testid="attention-sends" style={{ gap: '0.75rem', marginBottom: '1.5rem' }}>
                {sends.map((s) => (
                  <SendRow key={s.row.id} send={s} ventureName={ventureNames[s.ventureId] ?? s.ventureId} />
                ))}
              </div>
            </>
          ) : null}
          {finished.length > 0 ? (
            <>
              {sends.length > 0 ? (
                <h2 className="eyebrow" style={{ margin: '0 0 0.5rem' }}>Finished work, oldest first</h2>
              ) : null}
              {/* FB-100's item 5: every card carried the identical badge "This work has no automatic
                  checks" — fifteen copies of one fact about the repository, which is how a founder
                  learns to stop reading badges. When they all say the same thing, say it once; the
                  per-card badge comes back the moment items DIFFER, which is when it means something. */}
              {sharedCheckState(approvals) ? (
                <p className="muted" data-testid="attention-checks-shared" style={{ fontSize: 'var(--fs-body-sm)', marginTop: '-0.25rem' }}>
                  {CHECK_LABEL[sharedCheckState(approvals) as string] ?? CHECK_LABEL.unknown} — the same for all the finished work below.
                </p>
              ) : null}
              <FactoryQuiet line={cards.length ? needs.cardsQuiet : null} testId="attention-cards-quiet" />
              <div className="stack" data-testid="attention-queue" style={{ gap: '0.75rem' }}>
                {finished.map(({ key, pr, card }) => pr ? (
                  <ApprovalRow
                    key={key}
                    approval={pr}
                    ventureName={ventureNames[pr.ventureId] ?? pr.ventureId}
                    showChecks={!sharedCheckState(approvals)}
                  />
                ) : card ? (
                  <CardWaitingRow key={key} card={card} ventureName={ventureNames[card.ventureId] ?? card.ventureId} />
                ) : null)}
              </div>
            </>
          ) : null}
        </>
      )}

      {/* FB-149: sends that could not be read are said out loud. Listing none would be the claim
          "nothing is about to leave", made without looking. */}
      {needs.sendsUnread.length > 0 && !empty ? (
        <p className="card" data-testid="attention-sends-unread" style={{ fontSize: 'var(--fs-meta-lg)', marginTop: '1.5rem', borderColor: toneColor('attention') }}>
          The studio could not read what is waiting to leave {needs.sendsUnread.join(' and ')} just now,
          so those sends are missing from this list and the number above may be too low.{' '}
          <span className="muted">It clears on its own. Refresh in a minute.</span>
        </p>
      ) : null}

      {/* FB-076: BELOW the work, not above it. A founder came here to answer something; a degraded
          read is context for what they are seeing, not the headline. Grouped by cause, because the
          cause is what decides whether they should do anything — and the version this replaced ran
          five failures and two causes into one sentence with `·` separators. */}
      <ReadFailures messages={errors} />
    </section>
  );
}

/**
 * The one check state every item shares, or null when they differ (FB-100's item 5).
 *
 * Null for a single item too: "the same for everything below" over one card is a sentence about
 * nothing, and the card's own badge says it better.
 */
function sharedCheckState(approvals: PrApproval[]): PrApproval['ciStatus'] | null {
  if (approvals.length < 2) return null;
  const first = approvals[0].ciStatus;
  return approvals.every((a) => a.ciStatus === first) ? first : null;
}

function ApprovalRow({
  approval,
  ventureName,
  showChecks = true,
}: {
  approval: PrApproval;
  ventureName: string;
  /** False when the whole queue shares one check state and it has been said once above. */
  showChecks?: boolean;
}) {
  // FB-064: the title now opens the work INSIDE the studio. This page told a founder work was
  // waiting for their OK and then offered one link to github.com — the break in the loop.
  // `repo` is the short name; the venture's manifest resolves the owner, so no founder-facing URL
  // carries one.
  const shortRepo = approval.repo.includes('/') ? approval.repo.split('/')[1] : approval.repo;
  const here = `/venture/${approval.ventureId}/work/${shortRepo}/${approval.number}`;
  return (
    <article className="card card-link" data-testid={`approval-${approval.id}`} style={{ padding: '0.85rem 1rem' }}>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Link href={here} style={{ fontWeight: 500 }} data-testid={`approval-primary-${approval.id}`}>
          {approval.ticketTitle ?? approval.title}
        </Link>
        {showChecks ? <CiDot status={approval.ciStatus} /> : null}
        {/* FB-184: opened before it is offered. Streamed, so the queue never waits on a preview. */}
        {approval.previewUrl ? (
          <Suspense fallback={null}>
            <PreviewTag url={approval.previewUrl} id={approval.id} />
          </Suspense>
        ) : null}
      </div>
      <div className="muted" style={{ fontSize: 'var(--fs-meta)', marginTop: '0.35rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <span>{ventureName}</span>
        {approval.linkedTicketId ? <span>· {approval.linkedTicketId}</span> : null}
        {/* FB-100's item 6: "waiting 3 days" — waiting on whom? The sentence FB-064's page already
            uses is the one that works. */}
        <span>· waiting {howLong(approval.createdAt) ?? 'a while'} for you</span>
        <Link href={here} data-testid={`approval-open-${approval.id}`}>· Read it and decide</Link>
      </div>
    </article>
  );
}

/**
 * A factory card waiting on this person (FB-277), in the same look as the finished work beside it.
 *
 * The meta line is where John reads his parts: what the run cost and what to do next, in the words
 * Telegram uses. A founder's row never carries them: `john` is null for anyone else, on the server.
 */
function CardWaitingRow({ card, ventureName }: { card: CardRow; ventureName: string }) {
  const id = `${card.ventureId}-${card.repo}-${card.number}`;
  return (
    <article className="card card-link" data-testid={`attention-card-${id}`} data-standing={card.standing} style={{ padding: '0.85rem 1rem' }}>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
        {card.href ? (
          <Link href={card.href} style={{ fontWeight: 500 }} data-testid={`attention-card-primary-${id}`}>{card.title}</Link>
        ) : (
          <span style={{ fontWeight: 500 }} data-testid={`attention-card-primary-${id}`}>{card.title}</span>
        )}
      </div>
      <div className="muted" style={{ fontSize: 'var(--fs-meta)', marginTop: '0.35rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <span>{ventureName}</span>
        {card.ref ? <span>· {card.ref}</span> : null}
        <span data-testid={`attention-card-state-${id}`}>· {card.words}</span>
        {card.john?.cost ? <span data-testid={`attention-card-cost-${id}`}>· {card.john.cost}</span> : null}
        {card.john?.nextStep ? <span data-testid={`attention-card-next-${id}`}>· {card.john.nextStep}</span> : null}
        {card.href ? <Link href={card.href}>· Look at it and decide</Link> : null}
      </div>
    </article>
  );
}

/**
 * A send waiting on a founder (FB-149): its summary, its venture, and what state it is in.
 *
 * It links to the send's own page and carries no approve control. That page is the one place a
 * send is decided (FB-183, held by `one-signing-surface.test.ts`).
 */
function SendRow({ send, ventureName }: { send: WaitingSend; ventureName: string }) {
  const { row } = send;
  return (
    <article className="card card-link" data-testid={`attention-${row.id}`} data-status={row.send.status} style={{ padding: '0.85rem 1rem' }}>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Link href={row.send.href} style={{ fontWeight: 500 }} data-testid={`attention-primary-${row.id}`}>
          {row.title}
        </Link>
        <span className="tag" style={{ color: toneColor('attention') }}>send</span>
      </div>
      <div className="muted" style={{ fontSize: 'var(--fs-meta)', marginTop: '0.35rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <span>{ventureName}</span>
        {row.surface ? <span>· {row.surface}</span> : null}
        {row.send.ref ? <span>· {row.send.ref}</span> : null}
        <span data-testid={`attention-state-${row.id}`}>· {row.send.state}</span>
        <Link href={row.send.href}>· Open it and decide</Link>
      </div>
    </article>
  );
}

/**
 * "see it running", only when the preview was opened and works (FB-184).
 *
 * A preview that was torn down, or that redirects to the live site, says so in a quiet line instead.
 * One that has not been checked (only the test rig, which never opens an address) shows nothing: a
 * list is no place for a sentence about a check that did not happen, and the work page says it.
 */
async function PreviewTag({ url, id }: { url: string; id: string }) {
  const check = await checkedPreview(url);
  if (check.state === 'opens') {
    return (
      <a href={check.url} target="_blank" rel="noreferrer" className="tag tag-accent" data-testid={`approval-preview-${id}`}>
        see it running ↗
      </a>
    );
  }
  if (check.state === 'does-not-open') {
    return (
      <span className="muted" data-testid={`approval-preview-why-${id}`} style={{ fontSize: 'var(--fs-meta)' }}>
        preview: {whyNoLink(check)}
      </span>
    );
  }
  return null;
}

/**
 * FB-076: what the automatic checks say, in the same words the work view uses.
 *
 * This said `CI UNKNOWN` beside every item — small capitals, monospace — which means "this
 * repository has no automatic checks". That is true of ARCA and completely fine, and it read to a
 * founder as something being wrong. The work view learned to say it plainly in FB-064; the queue
 * had not, so the same fact was reassuring on one screen and alarming on another.
 */
function CiDot({ status }: { status: PrApproval['ciStatus'] }) {
  const color = toneColor(prCiTone(status));
  return (
    <span className="tag" style={{ color }} data-testid="approval-ci" data-checks={status}>
      {CHECK_LABEL[status] ?? CHECK_LABEL.unknown}
    </span>
  );
}

function ReadFailures({ messages }: { messages: string[] }) {
  const groups = groupFailures(messages);
  if (groups.length === 0) return null;
  return (
    <div data-testid="attention-errors" style={{ marginTop: '1.5rem' }}>
      <p className="eyebrow" style={{ marginBottom: '0.4rem' }}>
        {needsAction(groups) ? 'Some of your work is not showing' : 'One workstream is catching up'}
      </p>
      {groups.map((g) => (
        <p
          key={g.cause}
          className="card"
          data-testid={`read-failure-${g.cause}`}
          data-transient={g.transient}
          style={{ fontSize: 'var(--fs-meta-lg)', marginBottom: '0.5rem',
                   borderColor: g.transient ? undefined : toneColor('attention') }}
        >
          {g.text}{' '}
          <span className="muted">{g.nextStep}</span>
        </p>
      ))}
    </div>
  );
}

