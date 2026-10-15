/**
 * Client ↔ server contract: an edited editor draft becomes ONE change set that the real
 * comp_save_grid_changes accepts as a real agency admin (authenticated role, JWT claims, RLS on), and the
 * grid read back afterwards is exactly the draft. Runs only against the DISPOSABLE loopback database
 * prepared by scripts/run_commission_grids_tests.sh (COMP_DB_URL); skipped everywhere else. Synthetic data.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { parseGridSnapshot } from "../adminApi";
import type { GridSnapshot } from "../adminTypes";
import { buildChangeSet, draftFromSnapshot, validateDraft, type GridDraft } from "../gridDraft";

const url = process.env.COMP_DB_URL;
const local = !!url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname);
const ADMIN = "aaaaaaaa-0000-0000-0000-0000000000ad";
const ORG = "aaaaaaaa-0000-0000-0000-00000000000a";
const SHARED = "51000000-0000-0000-0000-000000000001";

/** Natural-key lines of a draft (ids and draft refs excluded), for exact comparison. */
function content(draft: GridDraft): string[] {
  const productKey = new Map(draft.products.map((p) => [p.ref, `${p.category}|${p.carrier}|${p.productName}`]));
  const lines = [`G|${draft.name}|${draft.effectiveDate}|${draft.isActive}|${draft.levels.join(",")}`];
  for (const p of draft.products) lines.push(`P|${productKey.get(p.ref)}|${p.isActive}`);
  for (const v of draft.variants) {
    const key = `${productKey.get(v.productRef)}|${v.label}`;
    lines.push(`V|${key}|${v.minAge}|${v.maxAge}|${v.terms}|${v.source}|${v.notes}`);
    for (const level of draft.levels) {
      const text = draft.rates[v.ref]?.[level] ?? "";
      if (text !== "") lines.push(`R|${key}|${level}|${text}`);
    }
  }
  return lines.sort();
}

describe.skipIf(!local)("editor change sets against the real server operation", () => {
  const sql = postgres(url ?? "postgres://invalid", { max: 1, onnotice: () => {} });
  const claims = JSON.stringify({ sub: ADMIN, role: "authenticated", is_super_admin: false, app_metadata: { organization_id: ORG, role: "Admin" } });
  // One PostgREST-like transaction per call, as the real admin, with RLS in force.
  const asAdmin = <T>(run: (tx: postgres.TransactionSql) => Promise<T>) =>
    sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${claims}, true)`;
      await tx.unsafe("set local role authenticated");
      return run(tx);
    }) as Promise<T>;
  const snapshot = async (gridId: string): Promise<GridSnapshot> =>
    parseGridSnapshot((await asAdmin((tx) => tx`select public.comp_get_grid_snapshot(${gridId}) as r`))[0].r);
  let gridId = "";

  beforeAll(async () => {
    await sql`select comp_test.seed_base()`;
    await asAdmin((tx) => tx`select public.comp_enable_shared_grid(${SHARED})`);
    const [{ r }] = await asAdmin((tx) => tx`select public.comp_create_private_grid('full', 'Synthetic Editable', '2025-05-01', ${SHARED}) as r`);
    gridId = r.grid_id;
  });
  afterAll(() => sql.end());

  it("saves an edited draft as one change set and reads back exactly that draft", async () => {
    const before = await snapshot(gridId);
    const d = draftFromSnapshot(before);
    const ref = (product: string, label: string) =>
      d.variants.find((v) => v.label === label && d.products.find((p) => p.ref === v.productRef)?.productName === product)!.ref;
    d.name = "Synthetic Edited";
    d.effectiveDate = "2025-06-01";
    d.levels = [125, 120, 110, 100, 90, 80];
    delete d.rates[ref("Level Term", "10-15 yr")][130];
    d.rates[ref("Level Term", "10-15 yr")][100] = "71.25";
    d.rates[ref("Level Term", "20 yr")][100] = "";
    d.rates[ref("Final Plan", "0-70")][125] = "88";
    (d.rates[ref("Index Plan", "")] ??= {})[90] = "0";
    d.products = d.products.map((p) =>
      p.productName === "Final Plan" ? { ...p, productName: "Final Plan Plus" } : p.productName === "Index Plan" ? { ...p, isActive: true } : p);
    d.variants = d.variants
      .filter((v) => v.label !== "71+")
      .map((v) => (v.label === "0-70" ? { ...v, minAge: "18", source: "", notes: "" } : v));
    d.products.push({ ref: "new:1", id: null, category: "term", carrier: "Synthetic Carrier West", productName: "West Term", isActive: true });
    d.variants.push(
      { ref: "new:2", id: null, productRef: "new:1", label: "10 yr", minAge: "18", maxAge: "65", terms: "10", source: "", notes: "Synthetic note" },
      { ref: "new:3", id: null, productRef: "new:1", label: "20 yr", minAge: "18", maxAge: "55", terms: "20", source: "", notes: "" },
    );
    d.rates["new:2"] = { 100: "60" };
    d.rates["new:3"] = { 125: "61.5" };

    expect(validateDraft(d)).toEqual([]);
    const changes = buildChangeSet(before, d);
    const [{ r }] = await asAdmin((tx) =>
      tx`select public.comp_save_grid_changes(${gridId}, ${before.grid.revision}, ${tx.json(changes as never)}) as r`);
    expect(r.revision).toBeGreaterThan(before.grid.revision);

    const after = await snapshot(gridId);
    expect(after.grid.revision).toBe(r.revision);
    expect(content(draftFromSnapshot(after))).toEqual(content(d));
    expect(after.grid.updatedByName).toBe("Ada One");
  });

  it("refuses a change set built on a stale revision and changes nothing", async () => {
    const current = await snapshot(gridId);
    const d = draftFromSnapshot(current);
    d.name = "Should Not Save";
    const changes = buildChangeSet(current, d);
    await expect(
      asAdmin((tx) => tx`select public.comp_save_grid_changes(${gridId}, ${current.grid.revision - 1}, ${tx.json(changes as never)})`),
    ).rejects.toMatchObject({ code: "PT409" });
    expect((await snapshot(gridId)).grid.name).toBe("Synthetic Edited");
  });
});
