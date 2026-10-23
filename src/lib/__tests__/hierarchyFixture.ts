/**
 * Test-only: the shared hierarchy shapes, for TypeScript tests.
 *
 * ONE data file feeds both sides of the hierarchy stabilization suites (plan §8, "TS and SQL T8
 * shapes generated from one data file"): `scripts/hierarchy_fixture.py` seeds
 * `supabase/tests/fixtures/hierarchy_shapes.json` into the SQL suites, and this module hands the
 * very same rows to Vitest. A shape changed for one side is therefore changed for the other, and
 * the TypeScript traversals and the SQL resolvers cannot drift apart unnoticed.
 *
 * The file is read and validated at import time; a malformed or inconsistent document throws, so
 * fixture drift fails loudly instead of silently shrinking a test. Synthetic ids and names only —
 * no production row is represented. Display names follow the SQL seed (`Synthetic <key>` /
 * `Member`, `<key>@synthetic.invalid`).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const HIERARCHY_SHAPES_PATH = resolve(__dirname, "../../../supabase/tests/fixtures/hierarchy_shapes.json");

export type HierarchyShapeName =
  | "production"
  | "two_cycle"
  | "self_loop"
  | "cross_org_edge"
  | "deep_chain"
  | "deleted_intermediate";

/** One profile exactly as the data file states it (organization and upline by KEY). */
export interface HierarchyShapeProfile {
  key: string;
  id: string;
  org: string;
  role: string;
  status: string;
  upline: string | null;
}

/** The same profile as a `public.profiles` row (ids resolved), for in-memory table emulators. */
export interface HierarchyProfileRow {
  id: string;
  organization_id: string;
  role: string;
  status: string;
  upline_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
}

/** The `expected` block of the production shape, by key (see the data file for the meaning). */
export interface ProductionShapeExpected {
  profiles: number;
  organizations: number;
  organizations_with_profiles: number;
  edges: number;
  expected_pairs: number;
  path_pairs_before_repair: number;
  missing_pairs: number;
  extra_pairs: number;
  unrecognised_edges: number;
  longest_chain: number;
  stale: string[];
  stale_paths: Record<string, string[]>;
  missing: [string, string][];
  canonical_paths: Record<string, string[]>;
  team_leader_descendants_before_repair: Record<string, string[]>;
  team_leader_descendants_after_repair: Record<string, string[]>;
}

interface ShapesFile {
  version: number;
  organizations: { key: string; id: string; name: string }[];
  shapes: {
    production: { profiles: HierarchyShapeProfile[]; expected: ProductionShapeExpected };
    invalid: Record<string, unknown>;
  };
}

export interface HierarchyShape {
  name: HierarchyShapeName;
  profiles: readonly HierarchyShapeProfile[];
  /** The profile id for a key; throws on an unknown key. */
  id(key: string): string;
  /** The key for a profile id; throws on an unknown id. */
  keyOf(id: string): string;
  /** The organization id a key's profile belongs to. */
  orgOf(key: string): string;
  /** Fresh `public.profiles` rows for this shape (a new array and new objects on every call). */
  rows(): HierarchyProfileRow[];
}

function fail(message: string): never {
  throw new Error(`hierarchyFixture: ${message} (${HIERARCHY_SHAPES_PATH})`);
}

const FILE = JSON.parse(readFileSync(HIERARCHY_SHAPES_PATH, "utf8")) as ShapesFile;
if (FILE?.version !== 1) fail(`unsupported version ${String(FILE?.version)}`);

const ORG_IDS = new Map<string, string>();
for (const org of FILE.organizations ?? []) {
  if (!org?.key || !org?.id || ORG_IDS.has(org.key)) fail(`bad or duplicate organization ${JSON.stringify(org)}`);
  ORG_IDS.set(org.key, org.id);
}

/** The organization id for an organization KEY ("A" … "F"); throws on an unknown key. */
export function hierarchyOrgId(orgKey: string): string {
  return ORG_IDS.get(orgKey) ?? fail(`unknown organization key ${orgKey}`);
}

function rawProfiles(name: HierarchyShapeName): HierarchyShapeProfile[] {
  if (name === "production") return FILE.shapes.production.profiles;
  const shape = FILE.shapes.invalid[name] as { profiles?: HierarchyShapeProfile[] } | undefined;
  return shape?.profiles ?? fail(`shape ${name} has no profiles`);
}

function buildShape(name: HierarchyShapeName): HierarchyShape {
  const profiles = rawProfiles(name);
  const byKey = new Map<string, HierarchyShapeProfile>();
  const byId = new Map<string, HierarchyShapeProfile>();
  for (const p of profiles) {
    if (!p?.key || !p?.id || byKey.has(p.key) || byId.has(p.id)) fail(`${name}: bad or duplicate profile ${p?.key}`);
    hierarchyOrgId(p.org);
    byKey.set(p.key, p);
    byId.set(p.id, p);
  }
  for (const p of profiles) {
    if (p.upline !== null && !byKey.has(p.upline)) fail(`${name}: ${p.key} names an unknown upline ${p.upline}`);
  }
  const get = (key: string) => byKey.get(key) ?? fail(`${name}: unknown key ${key}`);

  return {
    name,
    profiles,
    id: (key) => get(key).id,
    keyOf: (id) => byId.get(id)?.key ?? fail(`${name}: unknown id ${id}`),
    orgOf: (key) => hierarchyOrgId(get(key).org),
    rows: () =>
      profiles.map((p) => ({
        id: p.id,
        organization_id: hierarchyOrgId(p.org),
        role: p.role,
        status: p.status,
        upline_id: p.upline === null ? null : get(p.upline).id,
        first_name: `Synthetic ${p.key}`,
        last_name: "Member",
        email: `${p.key.toLowerCase()}@synthetic.invalid`,
      })),
  };
}

const SHAPE_CACHE = new Map<HierarchyShapeName, HierarchyShape>();

/** A shape from the shared data file, validated (unique keys/ids, known orgs, known uplines). */
export function hierarchyShape(name: HierarchyShapeName): HierarchyShape {
  let shape = SHAPE_CACHE.get(name);
  if (!shape) {
    shape = buildShape(name);
    SHAPE_CACHE.set(name, shape);
  }
  return shape;
}

/** The production shape's recorded expectations (counts, stale set, canonical paths, TL descendants). */
export const PRODUCTION_EXPECTED: ProductionShapeExpected = FILE.shapes.production.expected;

/**
 * Downline keys of `rootKey` by walking `upline` (the canonical `upline_id` authority), every key
 * reached once, in BFS order, excluding the root; `includeDeleted: false` drops Deleted members
 * from the result while still walking through them. Organization-constrained to the root's
 * organization. A small, independent reference implementation for tests to compare against.
 */
export function shapeDownlineKeys(
  shape: HierarchyShape,
  rootKey: string,
  opts: { includeDeleted: boolean },
): string[] {
  const org = shape.orgOf(rootKey);
  const seen = new Set<string>([rootKey]);
  const out: string[] = [];
  let frontier = [rootKey];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const p of shape.profiles) {
      if (p.upline === null || !frontier.includes(p.upline) || seen.has(p.key)) continue;
      if (hierarchyOrgId(p.org) !== org) continue;
      seen.add(p.key);
      next.push(p.key);
      if (opts.includeDeleted || p.status !== "Deleted") out.push(p.key);
    }
    frontier = next;
  }
  return out;
}
