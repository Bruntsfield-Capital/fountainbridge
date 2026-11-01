import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { loadVentures } from '@/lib/ventures';
import { authorizeVentures, canAccessVenture, parseAdminEmails } from '@/lib/authz';
import { GitHubClient } from '@/lib/github';
import { githubWorkSource, loadWork } from '@/lib/work-load';
import { fixtureWorkSource } from '@/lib/work-fixture';
import { WorkDetail } from '@/components/WorkDetail';
import { VentureForbidden } from '@/components/VentureForbidden';
import { ageMs } from '@/lib/when';
import { checkedDoor, checkedPreview } from '@/lib/preview-check';
import { workPageOff } from '@/lib/factory-work-load';

/**
 * One piece of work, inside the studio (FB-064).
 *
 * The route the attention queue used to send to github.com. Scoping is enforced HERE, server-side,
 * before anything is fetched (CLAUDE.md #6) — and again inside `loadWork`, which refuses a repo the
 * venture does not declare.
 *
 * The repo segment is the short name (`arca`), not `owner/repo` — a founder should never see an
 * owner in a URL, and the venture's manifest is what resolves it.
 */
export default async function WorkPage({
  params,
}: {
  params: Promise<{ id: string; repo: string; number: string }>;
}) {
  const { id, repo, number } = await params;

  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect('/login');

  const admins = parseAdminEmails(process.env.STUDIO_ADMIN_EMAILS);
  const ventures = loadVentures();
  const access = authorizeVentures(email, ventures, admins);
  const venture = ventures.find((v) => v.id === id);
  if (!venture || !canAccessVenture(access, id)) {
    // `exists` distinguishes "not yours" from "no such venture" — a founder guessing ids should not
    // be able to learn which ventures exist from the difference.
    return <VentureForbidden ventureId={id} exists={Boolean(venture)} />;
  }

  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) return <NotHere ventureId={id} />;

  // Same fixture seam as tickets/PRs/health/approvals, gated on the one well-known test switch.
  const source =
    process.env.WORK_FIXTURE_DIR && process.env.E2E_TEST_LOGIN === '1'
      ? fixtureWorkSource(process.env.WORK_FIXTURE_DIR)
      : githubWorkSource(new GitHubClient());

  let work = null;
  try {
    work = await loadWork(venture, repo, n, source);
  } catch {
    work = null;
  }
  if (!work) return <NotHere ventureId={id} />;

  // FB-107: the "see it" door. The surface this work belongs to is the one whose repo it is in, and
  // its launch target is already in the manifest (FB-093) — the board had the button and the page a
  // founder actually decides on did not.
  const launch = venture.departments.find((d) => d.repo === repo)?.launch ?? null;

  // FB-184: both doors are opened before they are drawn as links. A stored address is a claim: a
  // preview that was torn down, or that quietly redirects to the live site, gets words, not a button.
  // Remembered for five minutes per address, and opened in parallel, so this is at most one check
  // of each per page.
  const [previewCheck, launchCheck, off] = await Promise.all([
    work.previewUrl ? checkedPreview(work.previewUrl) : Promise.resolve(null),
    launch ? checkedDoor(launch.url) : Promise.resolve(null),
    workPageOff(venture, repo, n),
  ]);

  return (
    <>
      <p style={{ fontSize: 'var(--fs-body-sm)' }}>
        <Link href={`/venture/${id}`} data-testid="work-back">← Back to {venture.name}</Link>
      </p>
      <WorkDetail ventureId={id} work={work} launch={launch} waitingMs={ageMs(work.createdAt)} previewCheck={previewCheck} launchCheck={launchCheck} off={off} />
    </>
  );
}

function NotHere({ ventureId }: { ventureId: string }) {
  return (
    <section>
      <h1>That work isn’t here</h1>
      <p className="muted" style={{ maxWidth: 'var(--content-narrow)' }}>
        It may have been accepted already, or it belongs to a different venture.{' '}
        <Link href={`/venture/${ventureId}`}>Back to your venture</Link>.
      </p>
    </section>
  );
}
