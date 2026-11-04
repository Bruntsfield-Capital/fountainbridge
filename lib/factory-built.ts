/**
 * The ventures the factory builds, and the one line the studio says about it (FB-295).
 *
 * A venture is built one of two ways: by its own machine (the lane on its box, which checks in
 * every few minutes), or by the factory on the planning box (FB-272), which reports through the
 * factory door. ARCA moved to the factory, and its old machine stopped. The studio still read that
 * machine, so ARCA's desk said in red that "your team" had not checked in for 26 days, drew an
 * office of people who were not there, and listed what the old machine did weeks ago. All of it was
 * true about the old machine and wrong about ARCA.
 *
 * For a factory venture the studio does not read the old machine at all, and says this instead:
 * whether the factory is reporting, and the last piece of its work that became part of the venture.
 *
 * The list is here, in code, rather than in the venture's manifest: the manifest follows the
 * bcap-contracts `Venture` schema, pinned at 0.1.0, which has no field for it. Production sets
 * nothing and gets the list below. `STUDIO_FACTORY_BUILT` replaces it (comma-separated ids, empty for
 * none): the browser tests set it empty, because their ARCA fixtures are an old machine's records
 * and they test those screens; `e2e/factory-built.spec.ts` sets it to `arca`.
 */

import type { EngineState } from './runreports';
import type { CardRow } from './factory-work';
import { reportedWhen } from './presses';

/** Venture ids the factory builds. ARCA since FB-264 and FB-272. */
const FACTORY_BUILT = ['arca'];

/** Whether the factory builds this venture, so its old machine is not read or shown. */
export function builtByFactory(ventureId: string, env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.STUDIO_FACTORY_BUILT;
  const ids = raw === undefined ? FACTORY_BUILT : raw.split(/[,\s]+/).filter(Boolean);
  return ids.includes(ventureId);
}

export interface FactoryLine {
  /** `stalled` only while the factory isn't reporting; never because nothing is being built. */
  state: EngineState;
  text: string;
  /** Always null: the factory's reports are not a machine's check-ins, and have no age to show. */
  ageMinutes: null;
}

/**
 * The one line about the factory, from the venture's factory cards.
 *
 * `quiet` is the cards' own "the factory hasn't reported since …" line (`ventureCards`), or null
 * while it reports. The factory sends a card when a pull request opens, not when a build starts, so
 * the studio cannot know whether something is being built right now, and this never says either way.
 */
export function factoryLine(
  ventureName: string,
  rows: Pick<CardRow, 'standing' | 'title' | 'at'>[],
  quiet: string | null,
  now: number,
): FactoryLine {
  if (quiet) return { state: 'stalled', text: quiet, ageMinutes: null };
  const last = rows
    .filter((r) => r.standing === 'done' && Number.isFinite(Date.parse(r.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  const opening = `The factory builds ${ventureName}.`;
  if (!last) return { state: 'running', text: `${opening} Nothing it built has been added yet.`, ageMinutes: null };
  return {
    state: 'running',
    text: `${opening} Last added: ${last.title}, ${reportedWhen(last.at, now)}.`,
    ageMinutes: null,
  };
}
