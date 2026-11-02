/**
 * Venture-scoping authorization (FB-005, CLAUDE.md non-negotiable #6: isolation is server-side).
 *
 * The rule (D3/D6): John's admin account sees every venture; a founder's Workspace email — from
 * `founder.workspace_email` in a venture manifest — sees only their venture; anyone else sees none.
 * This is a pure function so it is trivially testable and can be applied on every server request
 * before any venture data is fetched. Never gate in the UI alone.
 */

export interface VentureRef {
  id: string;
  founderEmail: string | null;
}

export interface VentureAccess {
  /** True for a Bruntsfield admin (John) — sees all ventures. */
  isAdmin: boolean;
  /** Venture ids this identity may see. For an admin, all of them. */
  ventureIds: string[];
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/** The venture founder's address, trimmed and lowercased, or null when the manifest names none. */
export function founderAddress(venture: Pick<VentureRef, 'founderEmail'>): string | null {
  return venture.founderEmail?.trim().toLowerCase() || null;
}

/** Whether this signed-in address is the venture's founder. */
export function isFounder(venture: Pick<VentureRef, 'founderEmail'>, email: string | null | undefined): boolean {
  const founder = founderAddress(venture);
  return founder !== null && founder === email?.trim().toLowerCase();
}

/**
 * Resolve which ventures an authenticated email may access.
 * @param email the signed-in Google identity (null when signed out)
 * @param ventures all known ventures (id + founder workspace email)
 * @param adminEmails Bruntsfield admin emails (John), from `STUDIO_ADMIN_EMAILS`
 */
export function authorizeVentures(
  email: string | null | undefined,
  ventures: VentureRef[],
  adminEmails: string[],
): VentureAccess {
  if (!email) return { isAdmin: false, ventureIds: [] };
  const e = normalize(email);
  // Guard the empty/whitespace-only identity so it can never match an admin entry or a manifest
  // whose founder email is itself blank (both normalize to "").
  if (!e) return { isAdmin: false, ventureIds: [] };
  const admins = new Set(adminEmails.map(normalize).filter(Boolean));
  if (admins.has(e)) {
    return { isAdmin: true, ventureIds: ventures.map((v) => v.id) };
  }
  const owned = ventures
    .filter((v) => v.founderEmail && normalize(v.founderEmail) === e)
    .map((v) => v.id);
  return { isAdmin: false, ventureIds: owned };
}

/** Server-side guard: may this identity see this specific venture? */
export function canAccessVenture(access: VentureAccess, ventureId: string): boolean {
  return access.isAdmin || access.ventureIds.includes(ventureId);
}

/** Parse the `STUDIO_ADMIN_EMAILS` env value (comma/space separated) into a list. */
export function parseAdminEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
