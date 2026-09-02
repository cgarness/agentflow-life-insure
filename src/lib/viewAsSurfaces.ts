/**
 * viewAsSurfaces — the ONE list of what Super Admin "View As" actually supports.
 *
 * ## Why this exists
 *
 * Repairing the impersonation payload (see `impersonationProfile.ts`) had a consequence nobody
 * asked for: it turned "View As" ON everywhere. Before the repair, the effective profile carried
 * `organization_id: undefined`, so `usePermissions` never satisfied `canFetchPermissions` and
 * latched `isLoading` for the whole session — every impersonated page sat on a spinner. "View As"
 * was inert, and its blast radius was therefore zero.
 *
 * Now that the effective profile is well-formed, every route in the application mounts and runs
 * its queries under the viewed identity. Only two surfaces have actually been audited for that.
 * The rest were written against `useAuth().user` — the REAL session user — and would render the
 * operator's own data under the viewed agent's name, or worse, write it there.
 *
 * So "View As" is an ALLOW-LIST, not a global mode. This module is that list, and it is the only
 * place the list is written down. A surface is supported only when its full read path has been
 * proven to resolve from the EFFECTIVE viewer; anything unproven fails closed.
 *
 * ## Phase A scope, deliberately small
 *
 * Supported: Conversations, and the Contacts page limited to its Import History and Agents tabs.
 * Everything else — Dashboard, Reports, Dialer, Calendar, Campaigns, Settings, the contact
 * deep-link pages, the CSV import page, and every route added after this was written — is
 * withheld pending a separate audit. That is a product decision, not a claim that those pages are
 * broken: they are unproven, which for an identity boundary is the same thing.
 *
 * Widening this list means auditing the surface's ENTIRE read path first, including the layout
 * children it mounts. Adding a path here without that audit silently reopens the defect.
 */

/**
 * Contacts tabs readable while impersonating.
 *
 * - `Import History` — `listImportHistory` applies `.eq("organization_id", …)` always and
 *   `.eq("agent_id", viewerId)` for every role but Admin / non-impersonating Super Admin, where
 *   `viewerId` is the EFFECTIVE viewer.
 * - `Agents` — `getAgentScopeIds({ viewerId, organizationId })` traverses `profiles.upline_id`
 *   from the effective viewer and `usersApi.getByIds` is fed only those ids. It never calls
 *   `usersApi.getAll` and never routes through `get_contact_scope_agents`, whose scope predicate
 *   is `auth.uid()`-derived and therefore blind to impersonation.
 *
 * Leads / Clients / Recruits are NOT here: their grids, kanban boards and deep links resolve
 * through search RPCs whose inputs derive from the real authenticated session.
 */
export const VIEW_AS_SUPPORTED_CONTACT_TABS = ["Import History", "Agents"] as const;

export type ViewAsSupportedContactTab = (typeof VIEW_AS_SUPPORTED_CONTACT_TABS)[number];

/**
 * Route pathnames that may MOUNT while impersonating. Exact match after normalisation — a prefix
 * match would let `/contacts/import` and `/contacts/anything-added-later` through on the strength
 * of `/contacts`.
 */
const SUPPORTED_PATHNAMES: readonly string[] = ["/conversations", "/contacts"];

/**
 * Sidebar labels that stay visible while impersonating. Kept separate from the pathnames because
 * the sidebar is keyed on label, and because hiding an item is a weaker statement than blocking a
 * route: the route guard is what actually enforces this, the sidebar just stops advertising a
 * destination that would refuse.
 */
const SUPPORTED_NAV_LABELS: readonly string[] = ["Contacts", "Conversations"];

/**
 * Where a successful activation lands.
 *
 * NOT `/dashboard`, which is the first thing an operator would otherwise see refuse. Import
 * History is the surface most likely to be why they started a "View As" in the first place, and
 * it is supported, so it is the one landing that never opens on a notice.
 */
export const VIEW_AS_LANDING_PATH = "/contacts?tab=Import+History";

/**
 * Normalise a pathname before comparing.
 *
 * React Router matches case-INSENSITIVELY by default, so `/DASHBOARD` reaches the Dashboard route.
 * An allow-list that compared raw strings would therefore pass `/Dashboard` straight through. A
 * trailing slash is stripped for the same reason.
 */
function normalizePathname(pathname: string): string {
  const trimmed = pathname.trim().toLowerCase();
  if (trimmed.length > 1 && trimmed.endsWith("/")) return trimmed.slice(0, -1);
  return trimmed;
}

/** True only for a route proven safe to mount under "View As". Fails closed on anything odd. */
export function isViewAsSupportedPath(pathname: unknown): boolean {
  if (typeof pathname !== "string" || pathname.length === 0) return false;
  return SUPPORTED_PATHNAMES.includes(normalizePathname(pathname));
}

/** True only for a Contacts tab whose read path resolves from the effective viewer. */
export function isViewAsSupportedContactTab(tab: unknown): boolean {
  if (typeof tab !== "string") return false;
  return (VIEW_AS_SUPPORTED_CONTACT_TABS as readonly string[]).includes(tab.trim());
}

/** True only for a sidebar entry whose destination "View As" supports. */
export function isViewAsSupportedNavLabel(label: unknown): boolean {
  if (typeof label !== "string") return false;
  return SUPPORTED_NAV_LABELS.includes(label.trim());
}
