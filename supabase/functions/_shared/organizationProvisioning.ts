// Shared organization-naming helper.
//
// Organization CREATION itself lives in the SQL function
// public.provision_organization(name, slug, owner_user_id) — org insert,
// default disposition seed and founder attach must be ONE transaction so a
// failed signup cannot leave an orphan (41 tables hold ON DELETE NO ACTION
// FKs to organizations, so an Edge Function cannot compensate a partial
// create). Both create-user and create-organization call that RPC.

/** Slugify a display name and append a short suffix to avoid collisions. */
export function buildOrganizationSlug(name: string, suffix: string): string {
  const base = String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "agency"}-${suffix}`;
}

