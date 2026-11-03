import { describe, it, expect, beforeAll } from 'vitest';
import { loadVentures, type VentureSummary } from '../ventures';
import { ventureApprovals } from '../venture-reads';
import { buildFeed } from '../activity-feed';
import { sendRows } from '../needs-you';
import type { ActiveGraphApproval } from '../approvals';

/**
 * No send is left unreachable (FB-183).
 *
 * A send has its own page, and that page is the only place it is decided. So every send must be
 * linked from somewhere a founder looks: a send still waiting is on Tickets' "Needs you" list (and
 * the desk); a send that has been decided is a row on "What happened". A send on neither is one a
 * founder can only reach by typing its address.
 *
 * Read over the UI gate's own approval fixtures — real records: proposed, granted, executed, a
 * forged grant, an executed forgery, an edited proposal — plus the one case the fixtures do not
 * hold, a send the founder refused, built the way the reader builds it.
 */

const RIG = {
  // The fixture source is only honoured on the test rig, so a stray variable cannot repaint a real
  // venture (lib/read-faults.ts). Without this the read goes to the network and finds nothing.
  E2E_TEST_LOGIN: '1',
  APPROVALS_FIXTURE_DIR: 'e2e/fixtures/approvals',
  FOUNDRY_APPROVAL_SECRET: 'e2e-approval-secret-not-for-production',
};

let venture: VentureSummary;
let approvals: ActiveGraphApproval[];

beforeAll(async () => {
  Object.assign(process.env, RIG);
  const found = loadVentures().find((v) => v.id === 'arca');
  if (!found) throw new Error('the arca manifest is missing — this test reads its fixtures');
  venture = found;
  approvals = await ventureApprovals(venture);
});

const pageOf = (a: ActiveGraphApproval) => `/venture/${a.ventureId}/approvals/${a.repo}/${a.id}`;

/** Every send page a founder can reach by clicking: the waiting list, then What happened. */
function linked(all: ActiveGraphApproval[]): Set<string> {
  const waiting = sendRows(all, venture.id, () => null).map((r) => r.send!.href);
  const record = buildFeed({ activity: [], runs: [], approvals: all }).items.map((i) => i.href);
  return new Set([...waiting, ...record].filter((h): h is string => Boolean(h)));
}

describe('every send is linked from somewhere a founder looks', () => {
  it('the fixtures hold both waiting and decided sends, so this can fail either way', () => {
    expect(approvals.some((a) => a.status === 'proposed')).toBe(true);
    expect(approvals.some((a) => a.status !== 'proposed')).toBe(true);
  });

  it('holds for every send in the fixtures', () => {
    const reachable = linked(approvals);
    const lost = approvals.filter((a) => !reachable.has(pageOf(a))).map((a) => `${a.id} (${a.status})`);
    expect(lost, 'sends a founder cannot click through to').toEqual([]);
  });

  it('holds for a send the founder refused', () => {
    // How `lib/approvals` builds one: a verified refusal file and nothing else — no grant, so no
    // approver and no committed time. Reading only those dropped every refusal from What happened.
    const proposed = approvals.find((a) => a.status === 'proposed' && a.grantProvenance === 'none');
    expect(proposed, 'no plain proposed send in the fixtures').toBeDefined();
    const refused: ActiveGraphApproval = {
      ...proposed!,
      status: 'rejected',
      committedAt: null,
      grantedAt: null,
      approver: null,
      refusal: { refusedBy: 'matthew@bruntsfield.capital', at: '2026-09-03T09:00:00.000Z', note: 'Not this week.' },
    };
    expect(linked([refused]).has(pageOf(refused))).toBe(true);
    const [row] = buildFeed({ activity: [], runs: [], approvals: [refused] }).items;
    // Named by the person who refused, not "Someone".
    expect(row.text).toMatch(/^matthew@bruntsfield\.capital sent back:/);
  });
});
