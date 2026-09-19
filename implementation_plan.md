# Implementation Plan — CSV Import / Custom-Field Canonicalization: one logical field name per organization (rev 3 — PRODUCTION GUARD APPLIED; frontend PR pending)

> **STATUS (rev 3, 2026-09-19): PRODUCTION GUARD APPLIED AND VERIFIED.** Chris explicitly approved applying only the custom-field logical-name guard migration to production `jncvvsvckxhqgqvkppmj`. Supabase recorded it as **`20260919052941 / custom_field_logical_name_guard`**.
> Post-apply read-only verification confirmed: trigger/function/normalizer/support index installed; guard function is `SECURITY DEFINER`, owned by `postgres`, with `postgres`-only EXECUTE; `anon` has no `custom_fields` table privileges; `authenticated` retains SELECT/INSERT/UPDATE/DELETE and no longer has TRUNCATE/TRIGGER/REFERENCES; **111 custom-field rows and 10 legacy duplicate groups remain unchanged**; all 4 existing RLS policies remain unchanged.
> No duplicate consolidation, frontend deploy, PR merge, Edge deploy, or further production mutation occurred. The applied forward SQL body is frozen; repository filenames/references are reconciled to the Supabase-recorded version.

**Label:** PREVENTION + UI/MATCHING HARDENING — stop future duplicate custom fields. **Not** a cleanup of the 25 existing production duplicate rows.
**Repository:** `cgarness/agentflow-life-insure` · branch `claude/custom-field-deduplication-vypmaz` · base `main` @ `f56231e` (PR #373).
**Authored:** 2026-09-19.
**Document convention note.** `implementation_plan.md` is a single-build document. Git history shows it is normally **replaced wholesale** per build (`1b93f89 → b8c9acd`, +392/−913), while in-build revisions are appended as numbered `rev` / `§` sections (the most recent example is `§19`, appended rather than replacing). Because the Inbound Calling v2 material below still has **unshipped Edge Function deployments** pending their own approvals, this build is **prepended** rather than replacing the file. The previous content is retained verbatim under the divider at the end of this section. Say the word and I will replace the file wholesale instead.

---

## §A.0 Executive summary

Chris's product rule: *"Within an agency, a field name represents one field. Importing the same column again reuses that field — it never creates another copy."*

Today the rule is violated at three layers, and the read-only audit shows the root cause precisely:

1. **Database.** The only uniqueness on `public.custom_fields` is two *partial* unique indexes. The personal one puts **`created_by` in the key** — `(organization_id, created_by, lower(btrim(name))) WHERE created_by IS NOT NULL AND active IS TRUE`. N users in one organization may therefore each legally hold their own `Gender` row. Nothing enforces an organization-wide name namespace.
2. **Mapper.** `buildImportFieldOptions` emits **one option per physical row**, and `matchCsvHeaderToField` treats any repeated normalized name as ambiguous and refuses to auto-match. Three duplicate `Gender` rows therefore produce three identical-looking `Gender (Custom)` options and a `Do Not Import` auto-match result.
3. **Creation.** Both ingresses insert unconditionally. The import mapper has a client-side duplicate check but it only sees rows RLS lets the caller read, and it **blocks** rather than reusing. The Settings > Contact Management tab has **no duplicate check at all** — it is the unguarded ingress.

This build closes all three, forward-only, without touching a single existing row.

### A finding that materially reshapes the build

**The duplicate dropdown is an Admin-visible symptom, not a universal one.** `custom_fields_select` reads:

```
created_by IS NULL OR created_by = auth.uid() OR get_user_role() = 'Admin' OR is_super_admin()
```

A plain Agent or Team Leader **cannot see another user's personal custom field at all**. In production org `a0000000-…0001` the three `Gender` rows belong to one Admin and two Agents; each Agent's mapper shows exactly one `Gender`, and only the Admin sees three. Consequences:

- Parts A, B and F fully fix the *observed* problem with **zero RLS change and zero permission change**.
- A purely client-side reuse check can never prevent a *cross-user* collision, because the client cannot see the other user's row. That is exactly why Part D's database guard is load-bearing rather than belt-and-braces (see §A.5).
- The residual case — Agent B creating `Gender` while Agent A already owns one — is addressed in §A.6 without inventing a permission.

---

## §A.1 Mandatory pre-work — completed

| Step | Status |
|---|---|
| Read `AGENT_RULES.md`, `VISION.md`, `WORK_LOG.md` | Done. Invariant **#27** (line 219) is the governing rule; **#28** (line 226) governs production access; **#25** (line 200) forbids editing an applied migration; **#5** (line 65) requires `list_migrations` before assuming schema. Highest invariant is **#32** (line 325). |
| Newest WORK_LOG entries / in-flight conflicts | Done — see §A.2. |
| Inspect current implementations | Done — all eight named files read in full, plus `select.tsx`, `contactFieldLayout.ts`, `import-campaign-schemas.ts`, `supabase/tests/`, `scripts/run_*_tests.sh`, and the baseline migration's `custom_fields` blocks. |
| Inspect production `custom_fields` READ-ONLY | Done — see §A.3. 23 SELECT-only MCP queries. |
| Create/update `implementation_plan.md` | This document. |
| List every file/migration to touch | §A.13. |
| **STOP for approval** | **This is the stop.** |

---

## §A.2 In-flight work and conflict assessment

The newest 600 lines of `WORK_LOG.md` hold 22 entries (2026-09-12 → 2026-09-19). Twenty-one are Inbound Calling v2; the newest is the My Profile / Preferences frontend refactor. **None touches `custom_fields`, the CSV mapper, `supabase-settings.ts` or `ContactManagement.tsx`.** Conflict risk is effectively zero. Four caveats the build must respect:

1. **Migration history is current and complete.** `supabase/migrations/` ends at `20260918002859_voicemail_first_listen_guard.sql`, recorded as applied (WORK_LOG:50). There is **no unapplied migration on disk**. A new migration therefore sorts cleanly after it. `list_migrations` must still be run before authoring, per invariant #5.
2. **Paired rollback files are a recent but firm convention.** Every migration since `20260914000530` has a `supabase/migrations/rollback/<version>_<slug>.rollback.sql`. This build will produce one.
3. **`apply_migration` stamps its own version.** The authored filename prefix is not what production records; the documented remedy (WORK_LOG:75) is to rename the repo file to the recorded version with contents frozen. Noted for the apply step — which is **not** part of this build.
4. **Stale doc state, not a conflict.** The newest WORK_LOG entry and `§19` both say "not merged to main", but `origin/main` is now `f56231e` — that exact refactor. Worth a one-line correction when this build's WORK_LOG entry lands.

Pre-existing rule friction, called out rather than silently inherited: `ImportLeadsModal.tsx` (2,109 lines) and `ContactManagement.tsx` (1,971 lines) both far exceed AGENT_RULES §7's "React components < 200 lines" and are not on its two-file exception list. **This build does not fix that** — splitting either file is a separate, larger refactor and would make this change unreviewable. Flagging, not inheriting silently.

---

## §A.3 Production audit — READ-ONLY findings (`jncvvsvckxhqgqvkppmj`, 2026-09-19)

### A.3.1 The duplicate set — confirms the brief exactly

Scoped to org-owned rows (`organization_id IS NOT NULL`), which is the only scope the mapper ever sees (`getAll` filters `.eq("organization_id", …)`):

**10 normalized names · 25 physical rows · 1 organization · 100% personal · 100% active.**

| Normalized name | Rows | Scope | Distinct creators | Raw spellings | Distinct types |
|---|---|---|---|---|---|
| `amt requested` | 3 | all personal | 3 | `Amt Requested` | **2** (Number, Text, Number) |
| `beneficiary` | 3 | all personal | 3 | `Beneficiary` | 1 |
| `favorite hobby` | 3 | all personal | 3 | `Favorite Hobby` | 1 |
| `gender` | 3 | all personal | 3 | `Gender` | 1 |
| `have life insurance` | 3 | all personal | 3 | `Have Life Insurance` | 1 |
| `ad` | 2 | all personal | 2 | `Ad` | 1 |
| `date/time` | 2 | all personal | 2 | `Date/Time` | **2** (Text, Number) |
| `history of heart attack stroke cancer` | 2 | all personal | 2 | `History of Heart Attack Stroke Cancer` | 1 |
| `interested in` | 2 | all personal | 2 | `Interested In` | 1 |
| `status` | 2 | all personal | 2 | `Status` | 1 |

All 25 rows: `applies_to = ["Leads"]`, `required = false`, `active = true`, `default_value = ""`, `dropdown_options = []`.

Creators (all Active, all in org `a0000000-…0001` "Family First Life - Chris Garness"):
`cgarness.ffl@gmail.com` (Admin) · `chrisgarness702@gmail.com` (Agent) · `segura.solutions29@gmail.com` (Agent).

Organization-wide inventory:

| Org | Rows | Distinct normalized names | Agency-wide | Personal | Inactive |
|---|---|---|---|---|---|
| Family First Life - Chris Garness | 36 | 21 | **0** | 36 | 0 |
| Jayvion's Agency | 3 | 3 | **0** | 3 | 0 |
| *(system templates, `organization_id IS NULL`)* | 72 | 32 | — | — | 0 |

**Three facts this establishes:**

- **No agency-wide custom field exists anywhere in production.** The "prefer agency over personal" representative rule (§A.4.2) is therefore *forward-looking* — it is correct and deterministic, but no current row exercises it. Stating this so it is not mistaken for load-bearing behaviour today.
- **The 72 system templates also contain duplicates** (72 rows / 32 names), but they are unreachable from the mapper: `getAll` filters by `organization_id`, so `organization_id IS NULL` rows never enter the option list. The DB guard must skip them (§A.5.3) — they are also not insertable from the app, since `custom_fields_insert` requires `organization_id IS NOT NULL`.
- **Two groups have divergent `type`.** `amt requested` (Number/Text/Number) and `date/time` (Text/Number). Representative selection must therefore be deterministic about more than the name.

### A.3.2 Reference audit — what a future consolidation would have to rewrite

I swept every JSONB / config store in `public` for the 25 duplicate UUIDs and for the `custom:` prefix:

| Store | Duplicate-UUID hits | Contains `custom:` | Verdict |
|---|---|---|---|
| `workflow_nodes.config` | 0 | no | empty |
| `workflows.trigger_config` | 0 | no | empty |
| `saved_reports.config` | 0 | no | empty |
| `report_layouts.layout` | 0 | no | empty |
| `scheduled_reports.report_sections` | 0 | no | empty |
| `user_preferences.settings` | 0 | no | 911 bytes, no custom refs |
| `contact_management_settings.field_order_{lead,client,recruit}` | 0 | no | all NULL/empty |
| `contact_management_settings.required_fields_*` | 0 | no | no custom refs |
| `campaigns.queue_filters` | 0 | no | empty |
| `import_history.import_completion_metadata` | 0 | no | no refs |
| `activity_logs.metadata` / `notifications.metadata` | 0 | no | no refs |

**Zero UUID references anywhere outside `custom_fields.id` itself.** Corroborated statically: `rg 'REFERENCES "public"."custom_fields"'` returns no hits — **no foreign key in the schema points at `custom_fields.id`.**

Contact values, by contrast, are heavily populated — and all under the **same spelling**:

| Canonical name | `leads` rows with key | `clients` | `recruits` |
|---|---|---|---|
| `Amt Requested` | 534 | 2 | 0 |
| `Gender` | 512 | 2 | 0 |
| `History of Heart Attack Stroke Cancer` | 463 | 2 | 0 |
| `Beneficiary` | 459 | 2 | 0 |
| `Favorite Hobby` | 455 | 2 | 0 |
| `Have Life Insurance` | 442 | 2 | 0 |
| `Ad` | 436 | 2 | 0 |
| `Interested In` | 389 | 1 | 0 |
| `Status` | 288 | 2 | 0 |
| `Date/Time` | 246 | 2 | 0 |

**This is the single most important consolidation finding:** because `leads/clients/recruits.custom_fields` are keyed by **NAME**, and every duplicate group in production shares one exact spelling, merging the duplicate rows requires **no contact-data rewrite at all**. A future consolidation is a `custom_fields`-only operation. (It must be re-audited at consolidation time — this is a point-in-time snapshot.)

### A.3.3 Current database contract on `public.custom_fields`

```
-- UNIQUE INDEXES (the whole of the current uniqueness story)
CREATE UNIQUE INDEX custom_fields_agency_lower_name_unique
  ON public.custom_fields USING btree (organization_id, lower(btrim(name)))
  WHERE ((organization_id IS NOT NULL) AND (created_by IS NULL) AND (active IS TRUE));

CREATE UNIQUE INDEX custom_fields_personal_lower_name_unique
  ON public.custom_fields USING btree (organization_id, created_by, lower(btrim(name)))
  WHERE ((organization_id IS NOT NULL) AND (created_by IS NOT NULL) AND (active IS TRUE));
--                                    ^^^^^^^^^^ created_by IN THE KEY = the mechanical cause
```

Also on the table: PK on `id`; `custom_fields_type_check` (6 values); FKs to `profiles(id) ON DELETE SET NULL` and `organizations(id) ON DELETE CASCADE`; **one** trigger, `custom_fields_updated_at BEFORE UPDATE … update_updated_at()`; RLS enabled, four policies, all `TO authenticated`; `relforcerowsecurity = false`, `relowner = postgres`.

Two properties of the existing indexes matter for the new guard:

- They key on `lower(btrim(name))` — which trims and lowercases but **does not collapse repeated internal whitespace**. The app's canonical normalization does. `"Amt  Requested"` and `"Amt Requested"` are *different* to the database and *the same* to the mapper. The new guard uses the app's normalization and is therefore **strictly stronger** than both existing indexes, never redundant with them, and never satisfiable by them.
- Both are gated on `active IS TRUE`. Inactive rows are exempt today. §A.5.4 keeps that semantics deliberately.

### A.3.4 A pre-existing security defect found during the audit (out of scope; flagged for a decision)

```
custom_fields | anon          | DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
custom_fields | authenticated | DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
```

Compare the correctly-hardened neighbour created one week ago:

```
agent_inbound_settings | authenticated | INSERT, SELECT, UPDATE
```

`public.custom_fields` was never added to the baseline's ACL-hardening appendix, so it still carries the project's `ALTER DEFAULT PRIVILEGES … GRANT ALL` defaults. **`TRUNCATE` is not filtered by row-level security.** Any authenticated user — and `anon` — can today `TRUNCATE public.custom_fields` and destroy every organization's field definitions platform-wide. `TRIGGER` and `REFERENCES` are likewise unnecessary.

This is not something I invented for this build; the identical reasoning is already written into migration `20260914000530` ("TRUNCATE in particular is NOT filtered by row-level security, so an authenticated caller could have emptied the table regardless of the policies below").

**Why it touches this build:** `TRUNCATE` fires only `TRUNCATE` triggers, so it bypasses the Part D guard entirely. The guard stops duplicates; it cannot stop the table being emptied.

**Proposal:** ship the REVOKE/GRANT correction as **§A.5.6 — a separately-approvable component of the same migration**, mirroring the proven `agent_inbound_settings` pattern. It *strengthens* permissions (removes excess), invents nothing, and preserves every privilege the app actually uses (`SELECT, INSERT, UPDATE, DELETE` for `authenticated`; nothing for `anon`, which cannot pass any RLS policy today anyway). **Chris says yes or no to this independently of the rest.** If no, the guard still works; the table simply stays truncatable.

---

## §A.4 PART A — the logical custom-field registry

### A.4.1 Where the collapse lives (and where it must not)

**In `src/lib/import-field-matching.ts`** — a 206-line pure-TS module with no React, which already owns normalization and option identity.

**Not in `customFieldsSupabaseApi.getAll`.** This was the tempting choice and it is wrong: `getAll` has **six** call sites, and the Settings CRUD tab (`ContactManagement.tsx:479`) needs **every physical row** — it renders per-row edit/delete/active controls keyed by `f.id` (`:617`, `:625`, `:627-631`). Collapsing inside `getAll` would make two of a user's three `Gender` rows unmanageable and unrecoverable from the UI. `getAll`'s signature and return shape stay **byte-identical**, which also means the **seven sibling test files** that mock it need no changes.

### A.4.2 Representative selection — the documented rule

New exported type and builder:

```ts
export interface MappableCustomField {
  id: string;
  name: string;
  scope?: "system" | "agency" | "personal";  // already on CustomField (types.ts:324)
  createdBy?: string | null;                 // already on CustomField (types.ts:322)
  createdAt?: string | null;                 // NEW — see A.4.3
}

export interface LogicalCustomField {
  normalizedName: string;   // normalizeFieldName(representative.name)
  canonicalName: string;    // the representative's RAW name — the leads.custom_fields JSON key
  representativeId: string;
  memberIds: readonly string[];  // EVERY physical row id in the group, representative first
}
```

**`buildLogicalCustomFields(rows)` picks the representative by this total, deterministic order.** Every comparison is applied in sequence; the last one is total, so the result never depends on input order:

1. **Agency-wide before personal.** `scope === "agency"` (equivalently `createdBy == null` with an organization) wins. Rationale: the agency definition is the organization-authoritative one, and it is the only row every member can already see. *No production row exercises this today (§A.3.1) — it is forward-looking.*
2. **Then oldest `createdAt`**, ascending ISO-8601 string compare. Rows with a missing/unparseable `createdAt` sort **last**, so an absent value can never win by accident.
3. **Then lowest `id`**, ordinal string compare. UUIDs are unique, so this is total and breaks every remaining tie.

**Why an explicit rule and not "first array entry":** `getAll` orders by `.order("name", { ascending: true })` **only** — no secondary key. Postgres gives no stability guarantee among equal sort keys, so array position among duplicates is genuinely non-deterministic across requests. Relying on it would make the chosen representative flap between renders.

**What the representative actually decides.** Only three things: the option's `value` (`custom:<representativeId>`), the `canonicalName`, and the `type`/`dropdownOptions` any future type-aware UI reads. In production every group shares one exact spelling, so the canonical *name* is identical whichever row wins — the rule matters for future groups whose spellings diverge (`"Gender"` vs `"gender "`), and for the two groups whose `type` diverges (§A.3.1).

**Nothing is mutated.** `buildLogicalCustomFields` is a pure function over rows already in memory. It issues no query and writes nothing.

### A.4.3 Supporting change: surface `created_at`

`rowToCustomField` (`supabase-settings.ts:126-145`) currently drops `created_at`; `createdBy` and `scope` are already mapped (`:142`, `:143`). Rule 2 needs the timestamp.

- `src/lib/types.ts` — add `createdAt?: string | null;` to `CustomField`.
- `src/lib/supabase-settings.ts` — map `createdAt: row.created_at ?? null` in `rowToCustomField`.

Additive and optional, so no existing consumer or test double breaks.

### A.4.4 Option building

`buildImportFieldOptions(customFields)` keeps its name and signature (it accepts `MappableCustomField[]`, now with optional extra properties). Internally:

1. `buildLogicalCustomFields(customFields)` → one logical field per normalized name.
2. Ambiguity is counted over **built-ins + one entry per logical field** — not per physical row.
3. Each logical field emits exactly one option:

```ts
{
  value: customFieldOptionValue(logical.representativeId),  // "custom:<uuid>" — format UNCHANGED
  canonicalName: logical.canonicalName,
  label: `${logical.canonicalName} (Custom)`,               // kept on the object; see §A.9 for rendering
  kind: "custom",
  customFieldId: logical.representativeId,
  memberIds: logical.memberIds,                             // NEW
  ambiguous: /* true ONLY on a built-in collision */,
}
```

`ambiguous` now means **only** "this normalized name is shared with an AgentFlow built-in". Duplicate-custom-versus-duplicate-custom is no longer ambiguity — it is one field. That is the behaviour change, and it is exactly what AGENT_RULES #27 bullet 4 must be amended to say (§A.11).

### A.4.5 Resolution must accept member ids — a silent-data-loss guard

`resolveMappingToCanonicalName` returns `null` for a value whose option no longer exists, and the payload builder **silently skips** on `null` (`ImportLeadsModal.tsx:1013`). If the representative changed between the moment a mapping was made and the moment the payload is built — a refresh, a concurrent create, another user's row arriving — the stored `custom:<oldId>` would resolve to `null` and that column would be **silently dropped from every imported row, with no error**.

Fix: resolution matches the option's own `value` **or any `memberIds` entry**. A mapping to any physical row in the group still resolves to the group's canonical name. `isCustomFieldMapping` is unchanged.

### A.4.6 Two downstream checks that break without a fix

Both are in `ImportLeadsModal.tsx` and both are **blockers**, not polish:

- **`unmappedRequiredCustomFields` (`:539-544`)** matches required fields by `customFieldOptionValue(f.id)` over `activeLeadCustomFields` — every *physical* row. If a required field has three physical rows, only the representative is offered, so the other two can never be "mapped" and **Continue stays permanently disabled** (`:555-560`). Fix: match by **normalized canonical name** against the resolved names of the current mappings.
- **`duplicateMappings` (`:531-537`)** compares raw option values. Today two columns mapped to two *different physical* `Gender` rows are **not flagged**, yet both resolve to canonical `"Gender"` and silently collide in the payload — last write wins (`:1015`). Collapsing to one option per logical name **fixes this existing silent-corruption bug for free**; no code change needed, but a regression test is owed (§A.10, case 19).

---

## §A.5 PART D — the forward-only database guard

*(Presented before Parts B/C/F because those depend on knowing what the database will and will not accept.)*

### A.5.1 Why a unique index cannot work — the decisive argument

The required invariant is asymmetric: *a **new** row may not share a normalized name with **any** existing row in the organization*. A unique index is symmetric. `CREATE UNIQUE INDEX … (organization_id, canonical_name) WHERE active` would have to hold over the 25 legacy rows too — and **the index build would fail immediately**, because those rows already violate it. `CONCURRENTLY` does not help; it fails the same way, just later and leaving an invalid index behind.

Nor can the predicate carve out legacy rows by date: a partial index on "rows created after X" would still not stop a new row colliding with a *legacy* row, which is the exact case that must be blocked.

Independently confirmed: `grep -rn "NOT VALID" supabase/migrations/ supabase/migrations_archive/` returns **zero matches** — the repo has never used a deferred-validation constraint, and `NOT VALID` is unavailable for unique constraints in PostgreSQL regardless.

**A guarded trigger is the only mechanism that fits.** It is also exactly the house pattern, and there is a one-day-old precedent (`20260918002859_voicemail_first_listen_guard.sql`) plus two live analogues (`private.agent_inbound_settings_guard`, `private.inbound_routing_settings_validate`).

### A.5.2 The normalization mirror

```sql
CREATE OR REPLACE FUNCTION private.custom_field_norm(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$ SELECT lower(btrim(regexp_replace(p_name, '\s+', ' ', 'g'))) $$;
```

Mirrors `normalizeFieldName` (`import-field-matching.ts:92-94`) exactly for the ASCII whitespace this product actually uses: trim → collapse repeated internal whitespace → lowercase, punctuation preserved.

**A divergence to state rather than hide.** JavaScript `\s` matches Unicode whitespace (including U+00A0 NBSP); PostgreSQL's `\s` under a UTF-8 locale does not necessarily. A name containing NBSP could therefore normalize differently on the two sides. No production name contains non-ASCII whitespace (verified across all 111 rows), and `customFieldSchema` already `.trim()`s. **Decision needed (D-3, §A.12):** pin both sides to ASCII whitespace explicitly, or document the NBSP case as undefined and out of scope. I recommend documenting it and adding an explicit test that records current behaviour, rather than widening the change.

`IMMUTABLE` makes the function indexable:

```sql
CREATE INDEX IF NOT EXISTS custom_fields_org_norm_active_idx
  ON public.custom_fields (organization_id, private.custom_field_norm(name))
  WHERE organization_id IS NOT NULL AND active IS TRUE;
```

Non-unique — purely to make the guard's lookup an index probe rather than a scan.

### A.5.3 The guard

```sql
CREATE OR REPLACE FUNCTION private.custom_fields_logical_name_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_norm text;
BEGIN
  -- System templates (organization_id IS NULL) are outside every tenant namespace and are not
  -- insertable from the app (custom_fields_insert requires organization_id IS NOT NULL).
  IF NEW.organization_id IS NULL THEN RETURN NEW; END IF;

  -- Mirror the existing partial unique indexes: inactive rows are exempt.
  IF NEW.active IS NOT TRUE THEN RETURN NEW; END IF;

  v_norm := private.custom_field_norm(NEW.name);

  -- GRANDFATHER CLAUSE. On UPDATE, enforce only when the row ENTERS a new name or a new
  -- organization. Editing a legacy duplicate's type / required / dropdown options — and
  -- re-activating it — must keep working. See A.5.4.
  IF TG_OP = 'UPDATE'
     AND v_norm IS NOT DISTINCT FROM private.custom_field_norm(OLD.name)
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
  THEN
    RETURN NEW;
  END IF;

  -- Serialize concurrent claims on the same (organization, normalized name). Without this,
  -- two READ COMMITTED transactions both see "no conflict" and both commit.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.organization_id::text || ':' || v_norm, 0));

  IF EXISTS (
    SELECT 1 FROM public.custom_fields x
     WHERE x.organization_id = NEW.organization_id
       AND x.id <> NEW.id
       AND x.active IS TRUE
       AND private.custom_field_norm(x.name) = v_norm
  ) THEN
    RAISE EXCEPTION
      'A custom field named "%" already exists in this organization.', btrim(NEW.name)
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.custom_fields_logical_name_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_custom_fields_logical_name_guard ON public.custom_fields;
CREATE TRIGGER trg_custom_fields_logical_name_guard
  BEFORE INSERT OR UPDATE ON public.custom_fields
  FOR EACH ROW EXECUTE FUNCTION private.custom_fields_logical_name_guard();
```

Point by point against Part D's requirements:

| Requirement | How it is met |
|---|---|
| Coexists with legacy duplicates | The guard never runs over rows at rest. The 25 legacy rows are read, edited and deactivated exactly as today. |
| Existing rows readable and unchanged | The migration contains **no** `UPDATE`, `DELETE`, `INSERT` or backfill against `custom_fields`. Zero rows touched. |
| New INSERTs blocked | `BEFORE INSERT`, unconditional (for active, org-scoped rows). |
| UPDATE / rename paths protected | `BEFORE UPDATE` with the grandfather clause: a rename *into* a collision is rejected; a no-op re-save is not. |
| Works across agency, personal, different users | `SECURITY DEFINER`, owner `postgres`, and `relforcerowsecurity = false` on `custom_fields` → the `EXISTS` sees **every** row in the organization regardless of who owns it. This is the whole point. |
| Does not rely on the browser seeing every row | Correct — and it *cannot*, per §A.0. The guard is the only layer that sees the full namespace. |
| Not a callable public API | Lives in `private`; `REVOKE ALL … FROM PUBLIC`; **there is no `GRANT USAGE ON SCHEMA private` anywhere in the repo**, so `anon`/`authenticated` cannot even name it. Trigger functions do not require `EXECUTE` at fire time — privilege is checked at `CREATE TRIGGER`. Proven in production by `private.agent_inbound_settings_guard`, whose ACL is `postgres=X/postgres` and which fires correctly. |
| `SET search_path` pinned | `pg_catalog, pg_temp`, matching every recent `private` helper. Necessary because the baseline's `ALTER DEFAULT PRIVILEGES` grants `ALL ON FUNCTIONS` to `anon` by default — hence the immediate `REVOKE`. |
| Concurrency | `pg_advisory_xact_lock` on a hash of `(organization_id, normalized_name)`, released at commit/rollback. Proven by a **true two-session** test (§A.10), copying the existing R9 proof in `scripts/run_inbound_sql_tests.sh:45-71`. |
| RLS preserved, permissions not weakened | No policy is created, altered or dropped. |
| Error surfaces well | `ERRCODE 23505` flows straight into the existing `friendlyCustomFieldError` (`supabase-settings.ts:147-157`), which already maps 23505. §A.7 refines the message. |

`SECURITY DEFINER` here reads only `public.custom_fields`, takes no caller-supplied identifier beyond the row being written, and cannot be invoked except as a trigger. It grants no capability to any caller.

### A.5.4 The reactivation question — a deliberate, documented choice

Consider a legacy `Gender` row deactivated and later re-activated while its two siblings are still active.

- **Strict** (enforce on re-activation): technically tidier, but it makes legacy duplicate rows **one-way deactivatable**. A user who toggles their own `Gender` off can never turn it back on. That is a real regression caused by data they did not create.
- **Lenient** (recommended, as coded above): re-activation adds no *new* name to the namespace — the row already existed and already held that name. The duplicate-creation vector this build must close is `INSERT` and rename, and both are closed.

The deactivate → create → reactivate sequence is not a meaningful bypass: the intermediate `INSERT` is itself guarded, and in any organization without legacy duplicates it is simply the legitimate retire-and-replace path — consistent with the existing indexes' `active IS TRUE` semantics. **Decision D-2 (§A.12):** Chris can choose strict instead; it is a two-line change.

### A.5.5 Migration files

- `supabase/migrations/<stamped>_custom_field_logical_name_guard.sql`
- `supabase/migrations/rollback/<stamped>_custom_field_logical_name_guard.rollback.sql` — drops the trigger, function, helper and index; **reads nothing and rewrites nothing**; states explicitly that rolling back restores the ability to create duplicates.

Header banner follows `20260918002859`'s style, including the line **`NOT YET APPLIED ANYWHERE. Local/dev only until a separate approval.`**

**Deployment status: the migration will be CREATED IN THE REPO AND NOT APPLIED.** Applying it needs Chris's separate, explicit approval — per the task brief and invariant #28.

No change to `src/integrations/supabase/types.ts`: a trigger, a `private` function and a non-unique index do not alter any `Row`/`Insert`/`Update` shape.

### A.5.6 Optional, separately approvable: table-privilege hardening (from §A.3.4)

```sql
REVOKE ALL ON TABLE public.custom_fields FROM PUBLIC;
REVOKE ALL ON TABLE public.custom_fields FROM anon;
REVOKE ALL ON TABLE public.custom_fields FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.custom_fields TO authenticated;
-- service_role unchanged.
```

Preserves every privilege the application uses (`getAll`/`create`/`update`/`delete`), removes `TRUNCATE`, `TRIGGER` and `REFERENCES`, and removes `anon` entirely (`anon` passes no `custom_fields` policy today, so this is protective only). **Ships only if Chris says yes.** If it ships, it is in the same migration under its own banner so it can be reverted independently.

---

## §A.6 PART E — personal vs agency semantics, and the one real conflict

**Nothing about the ownership model changes.** System / agency / personal stay as documented in AGENT_RULES §5 line 351. No RLS policy is touched. No new role, permission or capability is introduced.

What changes is narrower and should be stated exactly: **the NAME becomes an organization-wide namespace while OWNERSHIP stays per-row.** One logical name, one definition, still owned and managed by whoever created it.

### The conflict, stated plainly

The desired rule says `Gender` is one field in the agency. The ownership model lets Agent A and Agent B each own a personal `Gender`. After the guard ships, Agent B's attempt is **rejected** — and because `custom_fields_select` hides Agent A's row from Agent B, the mapper **cannot offer Agent A's `Gender` for selection**. Left there, this is a functional regression: today Agent B can import that column (by creating a duplicate); tomorrow they could not import it at all.

### Resolution options

| | Approach | Permission change | Verdict |
|---|---|---|---|
| **A** | Widen `custom_fields_select` so every org member can read all org rows | **Yes** — every agent's Settings list would show every colleague's personal fields | Rejected. Large visible change, looks like a leak, and grants read access to definitions users cannot manage. |
| **B** | New `SECURITY DEFINER` RPC returning `{exists, canonical_name}` for the caller's own org | No RLS change, but a **new callable surface** | Viable follow-up, not needed now. |
| **C+** | **Recommended.** No new surface at all: when an `INSERT` is rejected with `23505`, the client now *knows* the name is taken in its own organization. It offers that column a **name-only logical option** — `canonicalName` with no `customFieldId` — and maps it. | **None** | See below. |

**Why C+ is sound, and grants nothing new.** `leads.custom_fields` is keyed by **name**, not by UUID — the import never needs the definition row. Agent B can already write the key `"Gender"` today by creating their own duplicate; C+ lets them write the same key **without** creating the duplicate row. It is strictly less privilege than the status quo, not more. `ImportFieldOption.customFieldId` is already optional, and the payload Zod guard (`importCustomFieldsPayloadSchema`) still validates the shape.

For everything a user *can* see — their own personal fields plus every agency-wide field — the stated product rule works completely and immediately, with no RLS involvement at all.

**Broader product decision, called out as Part E requires:** should import-created fields become **agency-wide** by default rather than personal? That would make the namespace and the ownership model agree perfectly and remove this conflict at the root. It cannot be done here: `custom_fields_insert` only permits `created_by IS NULL` for Admin / Super Admin, so agents would lose the ability to create fields during import entirely. **Decision D-4 (§A.12)** — recorded, not assumed, and out of scope for this build.

---

## §A.7 PART C — create-custom-field becomes reuse-first

Two ingresses, both changed. `customFieldSchema` remains the shared contract in both; the `"(Custom)"` rejection at `ImportLeadsModal.tsx:580-584` stays.

### A.7.1 Import mapper (`ImportLeadsModal.tsx:574-651`)

Ordered, before any insert:

1. **Normalize** the requested name with `normalizeFieldName` (already done at `:611`).
2. **Built-in check.** If it matches an `AGENTFLOW_FIELDS` name: do **not** create. Select that built-in option for the column, close the form, and explain — *"Date of Birth is a built-in AgentFlow field. This column was mapped to it instead."* (Today this path only produces a blocking error.)
3. **Logical registry check** over the visible rows. If found: do **not** insert. Map the column to that logical option, close the form, `toast.success("Gender already exists and was selected.")`. *(Today `:611-619` blocks with `A field named "Gender" already exists.` — the fix is to reuse rather than refuse.)*
4. **Otherwise insert**, unchanged — the returned row's `id` + `name` are authoritative, the option list and the mapping are updated **in the same commit** (`:641-643`), preserving invariant #27's last bullet.
5. **On `23505` from the guard** (a row the caller cannot see, or a concurrent create): re-fetch the list; if the field is now visible, select it (case 3). If it is not, apply **C+** (§A.6) — offer and select the name-only logical option — and explain: *"A field named 'Gender' already exists in your agency. This column will import into it."*
6. **On any other failure:** unchanged — the column keeps whatever it had, and **no mapping is left behind** (`:645-650`).

### A.7.2 Settings > Contact Management (`ContactManagement.tsx:502-545`)

This tab has **no duplicate check of any kind** today — `handleSave` runs `customFieldSchema.safeParse` and calls `create`/`update` directly. It is the unguarded ingress that keeps minting rows.

Add the same normalize → built-in → logical-registry pre-check before `create` (`:536`) and before a name-changing `update` (`:533`). Settings has no column to map, so a collision **blocks** with a precise message naming the existing field and its scope; where the existing field is agency-wide or the caller's own, the message says so and points at it in the list.

### A.7.3 Error mapping (`supabase-settings.ts:147-157`)

`friendlyCustomFieldError` already maps `23505` → *"A custom field with this name already exists."* That string is now imprecise: it will fire for an organization-wide collision with a field the caller may not own. Refine it to distinguish the organization-wide guard (matched on the guard's own message) from the pre-existing per-user indexes, so the UI never tells a user "you already have this" about someone else's field.

---

## §A.8 PART B — auto-match

`matchBuiltInField` (`import-field-matching.ts:100-128`) is **not touched** — not one character. All built-in aliases (`Phone Number → Phone`, `DOB → Date of Birth`, `fname → First Name`, the `st` short-code guard, the partial-match threshold) are preserved by construction, and pinned by the existing 40-case suite at `importFieldMatching.test.ts:133-186`.

There are **three** gates, not two:

| Gate | Location | Change |
|---|---|---|
| 1. Built-in short-circuit: built-in matched but its option is `ambiguous` → `null` | `:176-183` | **Unchanged.** A custom field shadowing a built-in is *true* ambiguity and must still fail closed. |
| 2. `matches.length !== 1` | `:186` | **Unchanged code, changed input.** Duplicates now collapse upstream, so a header matching N physical rows yields exactly one option. |
| 3. `matches[0].ambiguous` | `:187` | **Unchanged code, changed meaning.** `ambiguous` is now set only on a built-in collision. |

Net effect — `Gender` with three physical rows auto-matches to the single logical `Gender`. A custom `Email` shadowing built-in `Email` still leaves the column unmapped. True ambiguity still fails closed.

---

## §A.9 PART F — the dropdown

The control is a **native `<select>`** (`ImportLeadsModal.tsx:1351-1369`); shadcn `select.tsx` is not imported here. Grouping therefore uses native `<optgroup>` — no new dependency, no component migration, Tailwind only.

```
Do Not Import
┌ AgentFlow Fields ────────┐   <optgroup label="AgentFlow Fields">
│ First Name … Assigned Agent
┌ Custom Fields ───────────┐   <optgroup label="Custom Fields">
│ Gender  Beneficiary  Amt Requested  Favorite Hobby …
➕ Create as new custom field...
```

- One option per logical custom-field name — the entire point.
- `Do Not Import` stays, outside both groups, first.
- `➕ Create as new custom field...` stays, outside both groups, last.
- The `<option disabled>──────────</option>` hand-rolled separator at `:1367` is removed — `<optgroup>` replaces it properly.
- **The `" (Custom)"` suffix is dropped from the rendered text inside the Custom Fields group** (the group header already supplies that context, and it matches the mockup in the brief). The `label` property on `ImportFieldOption` is left as-is so invariant #27's "decoration is UI-only" contract and any non-grouped consumer keep working; only the rendering changes. The `Custom field` badge beside the select (`:1377-1379`) is unchanged.
- No other visual change. Existing custom fields stay selectable; `value` remains `custom:<uuid>`, so no mapping state migration is needed.

One pre-existing wrinkle, unchanged by this build but worth knowing: between `setMappings({})` (`:450`) and the auto-detect commit (`:502`), `mapped` is `undefined`, so React renders the `<select>` uncontrolled for that window. Nothing here delays that commit.

---

## §A.10 PART G — tests

**Honest statement about CI:** there are exactly two GitHub workflows — `s1-plan-verify.yml` (Python, path-filtered) and `sql-tests.yml` (`workflow_dispatch` only, documented "currently BLOCKED / expected to fail"). **No CI job runs `npm test`.** Every test below is therefore a *local* gate, run and reported by me. I will not describe any of it as CI-enforced.

`node_modules` is absent in this checkout, so `npm install` is the first step.

### A.10.1 Vitest — the 18 required cases

`src/lib/__tests__/importFieldMatching.test.ts` (extend; three existing tests **invert**) and `src/components/contacts/__tests__/importLeadsCustomFields.test.tsx` (extend; one existing test **inverts**).

| # | Case | Where |
|---|---|---|
| 1 | One custom `Gender` → one option | unit |
| 2 | Three physical `Gender` rows → one logical option | unit + DOM |
| 3 | CSV `Gender` auto-matches despite duplicates | unit + DOM |
| 4 | Case variants `Gender` / `gender` / `GENDER` | unit (extends the `it.each` table at `:170-176`) |
| 5 | Whitespace variants `" Gender "`, `"Gender   "` | unit |
| 6 | Different users owning the same legacy name | unit (rows differing only by `createdBy`) |
| 7 | Agency + personal duplicate of one name | unit — agency wins |
| 8 | Deterministic representative selection | unit — **shuffled input, identical output**; each tier exercised separately |
| 9 | Built-in aliases unchanged | the existing 40-case suite `:133-186`, untouched |
| 10 | A custom field cannot shadow a built-in at creation | unit + DOM |
| 11 | Creating an existing logical field **reuses** it, no INSERT | DOM — assert `create` mock **not called**, mapping set |
| 12 | Failed creation leaves **no** false mapping | DOM — `create` rejects; mapping stays `Do Not Import` |
| 13 | Punctuation preserved: `Date/Time` ≠ `Date Time` | unit (existing `:34-38` retained) |
| 14 | `Do Not Import` unchanged | unit + DOM |
| 15 | Mapping resolves to canonical NAME, never `"(Custom)"` | unit (existing `:197-201` retained) |
| 16 | Org A's field never resolves to Org B | unit at the option layer; **authoritative** coverage is SQL case 16b |
| 17 | DB guard rejects a new same-normalized-name duplicate | **SQL** (A.10.2) |
| 18 | Legacy duplicates do not make the migration unusable | **SQL** (A.10.2) |
| 19 | *(added)* Two columns → one logical field flagged as a duplicate mapping | DOM — closes the silent last-write-wins bug (§A.4.6) |
| 20 | *(added)* A mapping to a **non-representative** member id still resolves to the canonical name | unit — closes the silent-drop path (§A.4.5) |

**Tests that invert, named explicitly so the change is auditable:**

- `importFieldMatching.test.ts:68-75` — *"marks options ambiguous when two custom fields normalize identically"* (`toHaveLength(2)`, `every(o => o.ambiguous) === true`) → becomes **one** option, **not** ambiguous.
- `importFieldMatching.test.ts:111-115` — *"leaves the column unmapped when the normalized match is ambiguous"* (`matchCsvHeaderToField("Gender", opts)).toBeNull()`) → becomes a successful match.
- `importLeadsCustomFields.test.tsx:186-192` — the DOM twin (`cf("cf-a","New Field")`, `cf("cf-b","new  field")` → `"Do Not Import"`) → becomes a single option that auto-matches.
- **Retained unchanged:** `:77-81`, `:117-121`, `:180-186` and `importLeadsCustomFields.test.tsx:195-202` — the built-in-collision ambiguity tests. That class of ambiguity is *not* what this build relaxes.

The `cf()` helper (`importLeadsCustomFields.test.tsx:53-56`) gains optional `createdBy` / `scope` / `createdAt`, defaulted so existing call sites are untouched. The seven sibling files that mock `customFieldsSupabaseApi` need **no change**, because `getAll`'s contract is unchanged (§A.4.1).

New file `src/components/settings/__tests__/contactManagementCustomFieldReuse.test.tsx` covers §A.7.2.

### A.10.2 SQL — the database guard

Following the established, proven pattern (`supabase/tests/*.sql` + a localhost-only runner). `custom_fields` has a replayable `CREATE TABLE` in the baseline (`:7599`), so a throwaway database works — unlike `campaign_leads`, which is why `sql-tests.yml` is blocked.

New: `supabase/tests/custom_fields_harness.sql`, `supabase/tests/custom_field_logical_name_guard.sql`, `scripts/run_custom_field_guard_tests.sh`.

The runner refuses any non-localhost `PGURL` (invariant #28), creates a throwaway DB, applies the harness then the new migration, runs the suite, and drops the DB. Scenarios:

1. **Legacy coexistence (case 18).** Seed three active `Gender` rows with three different `created_by` **before** applying the migration. Migration applies cleanly. All three rows still readable, unchanged, `count(*) = 3`.
2. **Forward INSERT rejected (case 17).** A fourth `Gender`, any user → `23505`.
3. Cross-user personal collision → rejected.
4. Agency-vs-personal collision, both directions → rejected.
5. Case/whitespace variants (`gender`, `  GENDER  `, `Gen  der` vs `Gen der`) → rejected / allowed exactly as the TS normalizer decides. **Pins the SQL↔TS mirror.**
6. Punctuation preserved: `Date/Time` and `Date Time` both insertable.
7. **Tenant isolation (case 16b).** The same name in a *different* `organization_id` → **allowed**.
8. System templates (`organization_id IS NULL`) → exempt, insertable.
9. Inactive rows → exempt; an inactive row does not block a new active one.
10. **Legacy row still editable.** Change `type` / `required` / `dropdown_options` on one of the three legacy `Gender` rows → succeeds (the grandfather clause).
11. **Legacy row re-activatable** (documents D-2's chosen semantics).
12. **Rename into a collision rejected**; rename to a free name allowed.
13. **True two-session concurrency proof.** Two backgrounded `psql` sessions insert the same new name into the same org concurrently; exactly one commits, the other gets `23505`. Copies `run_inbound_sql_tests.sh:45-71`.
14. **Negative control**, per `scripts/run_cp13_rollback_test.sh:25-27`: with the trigger dropped, scenario 2 **succeeds** — proving the assertions actually bite.
15. **Rollback proof.** Apply the rollback file; the trigger, function, helper and index are gone; all seeded rows — legacy and new — are byte-identical to before.
16. Error contract: the raised `SQLSTATE` is exactly `23505`, so `friendlyCustomFieldError` keeps working.

### A.10.3 Typecheck / lint

`npx tsc --noEmit` (there is no `typecheck` npm script — absent; `tsc --noEmit` appears only in a code comment at `finalizeRpcTyping.test.ts:14`), then `npm run lint`, then `npm test`.

### A.10.4 What will **not** be run

No migration will be applied to production. No production write of any kind, including to "verify". If a gate cannot be met without one, I will report it **BLOCKED** (invariant #28).

---

## §A.11 AGENT_RULES changes

Invariant **#27** bullet 4 currently *blesses* the behaviour this build changes:

> **Ambiguity is never guessed.** If two options share a normalized name — including a custom field shadowing a built-in — the column is left unmapped for the user to choose. Production legitimately holds duplicate personal custom-field names (the unique indexes key on `created_by`), so this case is real, not theoretical.

It must be **amended, not merely supplemented** — replaced with wording that keeps built-in-collision ambiguity failing closed while stating that same-canonical-name duplicates collapse to one logical option. The other four bullets of #27 (JSONB keyed by name, no rename propagation, `custom:<uuid>` mapping state, the unmodified `fuzzyMatch`, create-and-map-in-one-commit) are **unchanged and still binding**.

New invariant **#33** (next free number; #32 is the highest, at line 325), matching the house format, wording to be finalized against whatever is actually approved:

> **Within an organization, normalized custom-field names form ONE logical namespace, enforced in the database (Custom-Field Canonicalization, 2026-09-…; migration `<stamped>_custom_field_logical_name_guard.sql`)** — the mapper presents one option per normalized canonical name and reuses an existing logical field instead of creating another definition; `private.custom_fields_logical_name_guard()` rejects a new or renamed active row whose normalized name is already taken in that `organization_id`, seeing every owner's rows via `SECURITY DEFINER` because the browser provably cannot. The guard is **forward-only**: the 25 pre-existing duplicate rows remain valid, readable and editable, and consolidating them is a separate approved project. Ownership (system / agency / personal) is unchanged — the NAME is organization-wide, the ROW is still owned by its creator.

Also: `docs/SETTINGS_LAYOUT.md:105-107` documents the Custom Fields tab and should get a one-line note about the new uniqueness rule.

---

## §A.12 Decisions needed from Chris before I write a line of code

| # | Decision | My recommendation |
|---|---|---|
| **D-1** | Ship §A.5.6 (table-privilege hardening: revoke `TRUNCATE`/`TRIGGER`/`REFERENCES` from `authenticated`, revoke `anon` entirely)? | **Yes.** `anon` and `authenticated` can currently `TRUNCATE public.custom_fields`, which RLS does not filter and which bypasses the new guard. Separately banner-ed so it can be reverted alone. |
| **D-2** | Re-activation semantics: lenient (don't enforce) or strict (enforce)? | **Lenient.** Strict makes legacy duplicate rows one-way deactivatable — a regression from data the user did not create. |
| **D-3** | NBSP / Unicode-whitespace divergence between JS `\s` and Postgres `\s` | **Document + test current behaviour.** No production name contains non-ASCII whitespace (all 111 rows checked). Pinning both sides widens the change for a case that does not exist. |
| **D-4** | Should import-created fields become **agency-wide** by default? | **Not in this build.** It would resolve §A.6 at the root, but `custom_fields_insert` only allows `created_by IS NULL` for Admin/Super Admin, so agents would lose field creation during import. Genuine product decision. |
| **D-5** | Drop the `" (Custom)"` suffix from rendered text inside the Custom Fields optgroup? | **Yes** — matches the brief's mockup; `label` stays on the option object so invariant #27's contract holds. |
| **D-6** | Adopt **C+** (§A.6): after a `23505` rejection, offer the column a name-only logical option? | **Yes.** It grants no privilege the user lacks today and prevents a functional regression for agents. |
| **D-7** | `implementation_plan.md`: prepend (as done here) or replace wholesale? | **Prepend**, because Inbound Calling v2 still has unshipped Edge deployments. Trivial to switch. |

---

## §A.13 Every file and migration I intend to touch

**Nothing below has been created or modified. This is the proposal.**

### Source (6)
| File | Change |
|---|---|
| `src/lib/import-field-matching.ts` | `LogicalCustomField`, `buildLogicalCustomFields`, widened `MappableCustomField`, collapse inside `buildImportFieldOptions`, `ambiguous` redefined to built-in collisions only, `memberIds` on the option, member-id-tolerant `resolveMappingToCanonicalName`. **`matchBuiltInField` and `FIELD_VARIATIONS` untouched.** |
| `src/components/contacts/ImportLeadsModal.tsx` | `<optgroup>` grouping (`:1351-1369`); reuse-first create (`:574-651`); `unmappedRequiredCustomFields` by canonical name (`:539-544`); 23505 → re-fetch/C+; pass `scope`/`createdBy`/`createdAt` into `buildImportFieldOptions` (`:491`). |
| `src/components/settings/ContactManagement.tsx` | Normalize → built-in → logical pre-check in `handleSave` (`:502-545`), covering both create (`:536`) and name-changing update (`:533`). |
| `src/lib/supabase-settings.ts` | `rowToCustomField` maps `created_at`; `friendlyCustomFieldError` distinguishes the org-wide guard from the per-user indexes. **`getAll` unchanged.** |
| `src/lib/types.ts` | `CustomField.createdAt?: string \| null` (additive, optional). |
| `src/components/settings/contact-flow/contactFlowSchemas.ts` | **Likely no change.** Uniqueness stays a business rule outside Zod, as `ImportLeadsModal.tsx:609-610` already documents. Listed because the brief names it. |

### Migration (2) — **CREATED, NOT APPLIED**
| File | Contents |
|---|---|
| `supabase/migrations/<stamped>_custom_field_logical_name_guard.sql` | `private.custom_field_norm`, support index, `private.custom_fields_logical_name_guard`, trigger, `REVOKE`s; **optionally** §A.5.6 under its own banner. Zero DML. |
| `supabase/migrations/rollback/<stamped>_custom_field_logical_name_guard.rollback.sql` | Drops all four objects; reads nothing, rewrites nothing. |

### Tests (6)
`src/lib/__tests__/importFieldMatching.test.ts` (extend; 3 invert) · `src/components/contacts/__tests__/importLeadsCustomFields.test.tsx` (extend; 1 inverts) · **new** `src/components/settings/__tests__/contactManagementCustomFieldReuse.test.tsx` · **new** `supabase/tests/custom_fields_harness.sql` · **new** `supabase/tests/custom_field_logical_name_guard.sql` · **new** `scripts/run_custom_field_guard_tests.sh`.

### Docs (4)
**new** `docs/audits/2026-09-19/CUSTOM_FIELD_DUPLICATES.md` (Part H, §A.14) · `AGENT_RULES.md` (amend #27 bullet 4, add #33) · `WORK_LOG.md` (newest-first entry) · `implementation_plan.md` (this) · one line in `docs/SETTINGS_LAYOUT.md`.

### Explicitly NOT touched
`src/integrations/supabase/types.ts` (no schema-shape change) · the seven sibling test files mocking `customFieldsSupabaseApi` · every RLS policy · `supabase/functions/import-contacts/` · any inbound/Twilio file · the production dialer · `main`.

---

## §A.14 PART H — the audit deliverable and the future consolidation project

`docs/audits/2026-09-19/CUSTOM_FIELD_DUPLICATES.md` — **read-only, no cleanup in this build.** It carries everything in §A.3 at full row granularity: normalized name · physical row count · each row's `id`, scope, `created_by` (+ creator email/role), `type`, `applies_to`, `active`, `created_at`, `age_rank` · the four identifier forms and their reference counts · and the zero-hit sweep table.

**The four identifier forms**, which the consolidation must handle separately (a genuine trap — `custom:` is overloaded):

| Form | Shape | Where | Orphaned by a rename/merge? |
|---|---|---|---|
| 1 | `custom_fields.id` (UUID) | mapper option value `custom:<uuid>` only; **never persisted**; **no FK anywhere** | No |
| 2 | Canonical **NAME** as a JSONB key | `leads/clients/recruits.custom_fields`; writers incl. `import-contacts`, `supabase-contacts/leads/clients/recruits`, `DialerPage`, `supabase-conversion`, and the DB-side `convert_lead_to_client_atomic` RPC | **Yes — silently** |
| 3 | `custom:<NAME>` **layout id** — same prefix, different payload | `ContactManagement.tsx:1618` (encode), `contactFieldLayout.ts:128-132` + `FullScreenContactView.tsx:1037-1039` (decode); persisted in `user_preferences.settings` and `contact_management_settings.field_order_*` | **Yes — silently** (currently 0 rows in production) |
| 4 | Workflow `trigger_config.field_name` (raw name) | `triggerForms/forms.tsx:146` → `workflow-time-based-trigger/index.ts:261`, matched in `get_active_workflows_for_trigger` | **Yes — silently** (currently 0 rows) |

Reserved non-field keys sharing the same JSONB namespace, which any consolidation or guard must exempt: `tags`, `Full Name`, `__agentflow`, `additional_policies` (`supabase-conversion.ts:26`).

Also recorded: `import-contacts` **never queries `custom_fields`** — it copies `row.customFields` verbatim into the JSONB column, so the only name validation is client-side (`import-campaign-schemas.ts:275-303`). And `workflow-executor`'s `custom_field_key` condition branch has **no consumer** — `custom_field` conditions always evaluate null.

### Proposed follow-on project: "Custom Field Duplicate Consolidation"

Separate plan, separate approval, **no destructive production action without Chris's exact approval**. Shape:

1. **Re-run this audit first** — it is a point-in-time snapshot; references may exist by then.
2. **Canonical-row selection** — the same rule as §A.4.2 (agency → oldest → lowest id), applied per group, with the two divergent-`type` groups (`amt requested`, `date/time`) decided **by Chris explicitly**, not by the rule.
3. **Reference rewrites** — today provably **none**: 0 UUID references, 0 `custom:<name>` layout entries, 0 workflow configs, and every duplicate group shares one spelling so **no contact-data rewrite is required**. Must be re-proven, not assumed.
4. **Non-destructive first** — prefer `active = false` on non-canonical rows over `DELETE`, per invariant #28's archival preference. A soft retire is fully reversible; a delete is not.
5. **Rollback/recovery** — a full pre-change `custom_fields` export, **proven** per invariant #29 (checksum-verified, re-parsed by the recovery mechanism itself, full-row bidirectional diff against the still-unchanged source, zero differences) before a single row changes.
6. **Validation queries** — before/after counts per normalized name; a zero-row assertion that no contact JSONB key lost a definition; a re-run of the §A.3.2 sweep.
7. **Ordering** — must land **after** this build's guard, so the cleaned state cannot immediately re-dirty.

---

## §A.15 Verification plan (after approval, before any apply)

1. `npm install`.
2. `npm test` — full vitest suite; the mapper/import custom-field files reported individually.
3. `npx tsc --noEmit`.
4. `npm run lint`.
5. `PGURL=postgresql://postgres@127.0.0.1:<port> ./scripts/run_custom_field_guard_tests.sh` — against a **local, disposable** Postgres 16 with **synthetic data only**. (Verified available in this environment: `/usr/lib/postgresql/16/bin/postgres` and `psql` are both present, and `supabase` is a devDependency. Invariant #28 satisfied: the runner refuses a non-localhost `PGURL`.)
6. Confirm forward behaviour, legacy coexistence, new-duplicate rejection, the two-session concurrency proof, the negative control, and the rollback — all locally.
7. **No production apply. No production write.** The migration ships to the repo **NOT APPLIED**.
8. `WORK_LOG.md` newest-first entry recording exactly what was proven and what was not.

---

---

## §A.16 Rev 2 — approved decisions and what actually shipped

Chris approved the rev-1 plan on 2026-09-19 with the following answers. Where the outcome differs
from rev 1, the deviation is stated explicitly rather than quietly folded in.

| # | Decision | Outcome |
|---|---|---|
| **D-1** | Table privilege hardening | **YES.** Shipped in the same migration under its own banner, separately reversible: `TRUNCATE`/`TRIGGER`/`REFERENCES` revoked from `authenticated`, `anon` revoked entirely, `authenticated` re-granted exactly `SELECT, INSERT, UPDATE, DELETE`. Asserted by SQL scenario S17. |
| **D-2** | Re-activation semantics | **LENIENT**, as recommended. The grandfather clause fires on UPDATE only when the normalized name or the organization changes. Legacy duplicates stay editable and re-activatable (S10, S11). |
| **D-3** | NBSP / Unicode whitespace | **DOCUMENT + TEST**, not widen. `private.custom_field_norm` is ASCII-contract; S5 pins every ASCII case **and** asserts the current NBSP behaviour so a future change must be deliberate. |
| **D-4** | Import-created fields become agency-wide | **NOT IN THIS BUILD.** The personal/agency ownership model is untouched; `custom_fields` RLS was not widened. |
| **D-5** | Drop `" (Custom)"` inside the optgroup | **YES.** Rendered text inside the Custom Fields group is the bare canonical name; `option.label` still carries the suffix so invariant #27's contract and any ungrouped consumer are unaffected. |
| **D-6** | "C+" name-only mapping after a 23505 | **REJECTED AS PROPOSED — replaced. See below.** |
| **D-7** | Prepend vs replace this document | **PREPEND**, as recommended; the Inbound v2 material is retained verbatim below. |

### A.16.1 D-6 — the correction, and why it was right

Rev 1 §A.6 proposed **C+**: after an organization-wide `23505`, offer the column a *name-only*
logical option (canonical name, no `customFieldId`) so the import could proceed. Chris rejected it on
a correct objection the plan had not weighed:

> A 23505 can indicate that the canonical field belongs to another user's personal scope and is
> invisible to the importing Agent under current RLS. Writing the JSON key by name would technically
> import the value, but `FullScreenContactView` gets its field definitions from
> `customFieldsSupabaseApi.getAll()`. The Agent could therefore import data into a field definition
> they cannot subsequently see/manage normally.

Rev 1's defence — "the user could already write that key today by creating their own duplicate" — was
true about *privilege* and beside the point about *outcome*: the duplicate row they create today is
one they can see and manage, whereas C+ would have produced values attached to a definition invisible
to its own author. **We must not solve duplicate creation by creating invisible CRM data.**

**What shipped instead.** On an organization-wide `23505` the mapper refetches once:

- **the definition is now visible** → select it, map the column, `"Gender already exists and was selected."`
- **it is still invisible** → **fail closed.** No name-only mapping. The column returns to
  `Do Not Import`; a persistent per-column `role="alert"` notice (which outlives the toast, and is
  cleared when the user maps that column themselves) reads: *"A field named 'Gender' already exists in
  this agency, but it isn't available to your account. Ask an Admin to make the field available before
  importing this column."* The rest of the import workflow is unaffected.

Covered by `importLeadsCustomFields.test.tsx` — "selects the field when the DB guard rejects but a
refetch makes it visible", "FAILS CLOSED when the guard rejects and the definition stays invisible",
and "clears the blocked-field notice once the user maps that column themselves".

This is an **intentional temporary limitation** of the personal-field visibility model, and it is now
a binding rule: **AGENT_RULES invariant #33** states that a successful CSV import may never write into
a custom field whose definition the importing user cannot subsequently resolve through the normal
contact-field read path.

### A.16.2 Follow-up architecture item (recorded, not taken)

**CUSTOM FIELD OWNERSHIP / VISIBILITY CANONICALIZATION** — should custom fields become agency-schema
definitions readable by all agency users, with management still permission-controlled? That would
resolve A.16.1's limitation at its root. Deferred by D-4; written up in
`docs/audits/2026-09-19/CUSTOM_FIELD_DUPLICATES.md` §7.

### A.16.3 Other deviations from rev 1

1. **`isOrganizationWideCustomFieldConflict` lives in a new module, `src/lib/custom-field-errors.ts`,
   not in `supabase-settings.ts`.** Rev 1 §A.4.1 claimed the eight `vi.mock("@/lib/supabase-settings")`
   test files would need no change. That was right about `getAll`'s contract but wrong about a **new
   export**: the modal importing the predicate from a mocked module resolved it to `undefined` at
   runtime. Extracting it keeps all eight mocks valid and makes the predicate unit-testable without a
   Supabase double. Net effect on siblings: still **zero changes**, as promised.
2. **One shared classifier instead of two parallel checks.** Rev 1 described the mapper and Settings
   implementing the same rule separately. They now both call
   `classifyRequestedFieldName(name, rows, { excludeId, isEligible })`, so the two ingresses cannot
   drift apart from each other or from auto-detection.
3. **`contactFlowSchemas.ts` was not modified**, as rev 1 §A.13 anticipated. Uniqueness stays a
   business rule outside Zod.
4. **Test count.** Rev 1 listed 20 cases; 47 net new assertions shipped across three files, plus 15
   SQL scenarios and three shell-level proofs (concurrency, negative control, rollback).

### A.16.4 Verification actually performed

- `npx tsc --noEmit` — clean, exit 0.
- `npm run lint` — 216 problems / 15 errors, **identical to the pre-change baseline measured by
  stashing**. Zero lint problems added.
- `npx vitest run` — 2757 passed / 1 failed / 12 files failed. Pre-change baseline on the same
  checkout: 2710 passed / 1 failed / 12 files failed. **+47 passing, zero new failures.** The
  failures are pre-existing and environmental: eleven files fail at collection with
  `Error: supabaseUrl is required` because this checkout has no `.env` (several import modules this
  build never touched), and `recordingRetentionVoicemail.test.ts` is a stale inbound source-audit test.
- `PGURL=postgresql://postgres@127.0.0.1:54329 ./scripts/run_custom_field_guard_tests.sh` — **ALL
  PROOFS PASSED** on a disposable local PostgreSQL 16.13 with synthetic data only: migration applies
  cleanly over seeded legacy duplicates, 15 scenarios, a true two-session race, a negative control,
  and a rollback fingerprint proof.
- **Not run, by design:** anything against production. No migration applied, no production write.


## §A.17 Production apply checkpoint — 2026-09-19

- Chris explicitly approved the production migration apply after branch review.
- Supabase applied the frozen forward SQL successfully and recorded **`20260919052941 / custom_field_logical_name_guard`**.
- Repository migration and rollback filenames are reconciled to that recorded version; the applied forward SQL body remains byte-for-byte unchanged per the applied-migration immutability rule.
- Post-apply verification: guard trigger/function/normalizer/index present; function owner `postgres`; SECURITY DEFINER true; function ACL `postgres=X/postgres`; authenticated CRUD preserved; authenticated TRUNCATE/TRIGGER/REFERENCES removed; anon has no table privileges.
- Data state is unchanged: **111 total custom-field definitions, 10 legacy duplicate groups**. No row was consolidated, renamed, deactivated, deleted, or backfilled.
- Supabase advisors reported no new security finding tied to the guard objects. Existing `custom_fields` RLS performance advisories remain pre-existing and out of scope.
- Frontend code remains on `claude/custom-field-deduplication-vypmaz`; no merge or Vercel deployment has occurred yet.

<!-- ════════════════════════════════════════════════════════════════════════════════════════════════
     PREVIOUS BUILD — Inbound Calling v2 / agent voicemail (+ §19 My Profile refactor).
     Retained verbatim below for reference: its Edge Function deployments and live checks are still
     open and gated on their own approvals. Not superseded by the custom-field build above, which
     shares no file, table or migration with it.
     ════════════════════════════════════════════════════════════════════════════════════════════ -->

# Implementation Plan — Permanent AgentFlow inbound calling and agent voicemail (rev 8 — implemented + four corrective passes, development-only)

> **CURRENT STATE (2026-09-19, reconciled read-only against `jncvvsvckxhqgqvkppmj`).** Everything below dated 2026-09-10…2026-09-13 is a HISTORICAL record of the development and migration passes and must be read as such. Since then PR #372 released the frontend and Chris activated Inbound Calling v2 for his organization: **one organization now runs `routing_engine='v2'`** (inbound group of 1, browser and mobile ring 20 s, mobile forwarding enabled with a configured number, persistent browser registration healthy), and **v2 has handled production calls** — 4 v2 calls, 4 route attempts and 1 stored voicemail, with live owner-first routing, Do Not Disturb, unanswered-browser→mobile forwarding, voicemail and the recovery sweep (`swept:parent_terminal`) all verified. Statements below that every organization is still on the legacy engine, or that v2 has never carried a production call, were true when written and are **superseded**. §19 is the current, approved work.

**Label:** BUGFIX (Alexa's missed inbound call) + Chris's settled decisions D1–D13.
**Repository:** `cgarness/agentflow-life-insure` · branch `claude/agentflow-inbound-plan-fkl6zi` · base `main` @ `1b93f89` · planning commits `2f9d500` (rev 1), `5536fd9` (rev 2), `2f3d304` (rev 3, approved).
**Status:** ALL FOUR MIGRATIONS M4–M7 ARE APPLIED TO PRODUCTION (`jncvvsvckxhqgqvkppmj`) — M4 on 2026-09-14 as `20260914000530 / inbound_agent_settings_and_registrations`, M5 on 2026-09-15 as `20260915025931 / inbound_routing_v2_settings`, M6 on 2026-09-15 as `20260915035141 / inbound_route_attempts_d13_and_recovery`, M7 on 2026-09-15 as `20260915053646 / inbound_voicemails`; every contract verified, pre-existing objects proven unchanged, and **every organization still on `routing_engine = 'legacy'` with an empty inbound group** (WORK_LOG 2026-09-14 / 2026-09-15, RELEASE_READINESS §1.1, §2 Steps 1–4 and §7). **M6 carried ONE approved immediate change to shared legacy behaviour — the replacement `finalize_inbound_call_terminal` no longer clears an existing `is_missed` flag when it records an external answer (D13). It reclassified nothing historical: M6 runs no `UPDATE` and no backfill, and none was run.** **M7 armed two approved LIVE pg_cron sweeps at commit** (`inbound-notify-sweep`, `inbound-route-attempt-sweep`, both `*/2 * * * *`); ten scheduled runs succeeded and wrote nothing — proven separately from the run log by `max(calls.updated_at)` still predating the migration. **The Edge Functions, the frontend and v2 activation remain unreleased and each needs its own approval.** Everything else below is IMPLEMENTED ON THE BRANCH — development-only, per Chris's approval of rev 3 at `2f3d304` (P1–P16 approved; P17 = measurement-based calibration toward ≈20 s; `#APPROVE_RLS_CHANGE` granted for exactly §7.7, **local development database only**). **Nothing was merged, deployed, applied to a remote database, enabled in production, changed at Twilio, or exercised with a live call.** §0b records the implementation deltas and how the five approval safeguards were met; **§0c records the rev 5 corrective pass (seven implementation defects)**; **§0d records the rev 6 corrective pass (four findings: automatic init recovery, superseded identity requests, microphone stream ownership, the whole-request webhook deadline)**; **§0e records the rev 7 corrective pass (calls beginning during pending recovery acquisition; the atomic abandon decision, lock order, durable sweeps)**; **§0f records the rev 8 corrective pass (live mobile acceptance protected, recovery ownership, acceptance-result closure, group recipient preservation, snapshot-honouring failure notifications)**; **§0g records the rev 9 corrective pass (the durable per-call engine decision replacing timestamp inference, one lock order for acceptance vs abandonment, intended recipients from validated evidence, and the removal of the out-of-scope RLS object)**; **§0h records the rev 10 corrective pass (an unresolved engine decision never bypasses a saved v2 decision; an unresolved v2 recipient never falls through to the legacy notification tiers, and is recovered durably)**; **§0i records the rev 11 corrective pass (schema absence is established from PostgreSQL's own answer, never inferred from PostgREST schema-cache metadata)**; **§0j records the rev 12 corrective pass (a NULL decision read fails closed under either flag; the M7 rollback guard fixed and the full rollback sequence proven)**; **§0k records the rev 14 corrective pass (organization isolation in `is_phone_connected`; an exact one-file M4 release procedure)**; **§0l records the rev 15 corrective pass (table privileges reset to the stated contract in M4 and M7; an executable, failure-safe M4-only procedure)**; **§0m records the rev 16 corrective pass (release tooling only: the explicitly targeted MCP procedure made primary, target binding taken from the connection rather than row content, machine-checked verifiers that run through MCP, and uncertain write outcomes reconciled read-only)**; **§0n records the rev 17 corrective pass (verification only: M4 resolved by migration identity rather than the authored version, a NEITHER snapshot no longer authorising replay after an uncertain request, and complete policy and privilege definitions compared instead of fragments and counts)**; §18 lists what stays unproven until the live checks run.
**Authored:** 2026-09-10 (rev 1–3) · 2026-09-11 (rev 4, implementation; rev 5, corrective pass from `a795eab`; rev 6, corrective pass from `667c5c3`; rev 7, corrective pass from `a8a09c4`; rev 8, corrective pass from `b86aaea`) · 2026-09-12 (rev 9, corrective pass from `7c66682`; rev 10, corrective pass from `bbf8a8a`; rev 11, corrective pass from `dc0e47e`; rev 12, corrective pass from `e4fefef`; rev 13, release preflight from `35f4e3f`; rev 14, corrective pass from `b9cca2c`; rev 15, corrective pass from `db3caf2`; rev 16, corrective pass from `3b4d1d5`) · 2026-09-13 (rev 17, corrective pass from `0913130`).

> Decision namespace. D1–D13 are Chris's settled decisions. The 2026-08 inbound plan reused `D1…D8` for its own defaults in code comments (`twiml.ts:3`, `routing.ts:3`, `index.ts:434`, migration `20260823222528`); new comments/docs write `INB-D4` etc. **P1–P17** are supporting defaults that need Chris's explicit yes; nothing in P is treated as approved.

---

## 0. What changed in rev 3 (the seven gaps)

| Gap | Resolution | Where |
|---|---|---|
| 1 Immediate offline forwarding | One private SQL routine `commit_owner_mobile` is used by both entry points: `plan_inbound_route` (attempt created **directly in `owner_mobile`**) and `advance_to_owner_mobile` (`owner_browser → owner_mobile` only). Eligibility re-check, reservation, destination snapshot, the D13 mark and durable recipients commit in one transaction **before** mobile TwiML exists. Duplicate requests re-emit the persisted stage's TwiML; a zero-row CAS re-reads and follows the persisted stage; if the D13 transaction fails, the handler serves voicemail TwiML, never the mobile `<Dial>`. The stage enum has no `initial`. | §8.1, §8.3, §7.3 |
| 2 Durable intended recipient | New `calls.missed_recipient_ids uuid[]` (snapshot written by every missed commit) + `calls.missed_for_agent_id`/`missed_reason`. `resolveMissedCallRecipientsFromDb` gains **tier 0**: when `missed_recipient_ids` is non-empty the tiers 1–4 are never consulted. `twilio-voice-status`'s two `calls` projections add the three columns; that function is therefore in the file list and must be deployed **before** any org is switched to v2. Scenario A/B specified and tested. | §3.2, §7.3, §11, §14 |
| 3 Durable recovery | The undefined `missed_mark_pending`/`notification_pending` flags are gone. Persisted state = `calls.missed_notified_at` and `voicemails.notified_at` (NULL = owed). Retry ownership = (a) in-request ×3, (b) convergence by any later handler for the same call, (c) a pg_cron SQL sweep every 2 minutes (`sweep_inbound_notifications`) that inserts from the durable snapshot with `ON CONFLICT DO NOTHING` and stamps completion. The D13 mark is never "pending": it is inside the reservation transaction, and mobile TwiML is only emitted after it commits. Voicemail notifications retry after the Twilio source is deleted because the media is stored first and the sweep works from the `voicemails` row. `voicemails.attempt_id` is written only when the signed callback carries an id that exists (else NULL); no lazy attempt creation. | §3.4, §7.3, §7.4, §10 |
| 4 Presence generations | Registration identity is an in-memory `registration_id` minted at every Device `registered` event (never stored in `sessionStorage`), plus a per-registration monotonic `seq`. The RPC upserts only the caller's `(agent_id, registration_id)` row and ignores any write whose `seq` is not greater than the stored one. Duplicate tab, reload, delayed `pagehide`, reordered heartbeat and logout cases are specified. | §6.2, §7.1 |
| 5 Bridge evidence | The invented "≥ 2 s beyond the whisper" rule is removed. Connected-conversation evidence is the parent `<Dial action>` field `DialBridged=true` (documented Dial action parameter per Chris's Dial reference); absence ⇒ `mobile_bridge_evidence='unconfirmed'`, no attribution, no guessing. Child-leg `<Number statusCallback>` events (`initiated/ringing/answered/completed`, child `CallSid`, child `CallDuration`) record the leg lifecycle and end the busy reservation but never prove bridging. Short conversations are preserved; acceptance stays separate. | §9, §8.3, §13 |
| 6 Twenty-second ring | Requirement restated as **20 seconds**, not "at least 20". Provider knob is `timeout="20"` (integer seconds; the only control). Twilio documents up to five extra seconds; the plan measures the agent-perceived ring (browser `incoming`→`cancel`) and the server span (TwiML served → `<Dial action>`), reports both, and asks Chris to decide between keeping `timeout="20"` (agent hears 20 s plus up to 5 s of provider buffer) or calibrating a lower value from measurements. No 20–25 s acceptance band is assumed. | §8.2, P17 |
| 7 Rollback drain | Drain gate covers **every** outstanding v2 obligation regardless of age: non-terminal attempts (any age), v2 `calls` with `ended_at IS NULL`, voicemails not `stored`/`purged` or with `notified_at IS NULL`, missed calls with `missed_notified_at IS NULL`, plus a 30-minute quiet period after the last v2 obligation closes. Compatible handlers stay deployed whenever the gate cannot be established. Verification adds a 30-minute active call, a failed recording, and a late callback during drain. | §14, §13 |
| — | Reconciled: four migrations (M8 removed), RPC contracts, file list (adds `twilio-voice-status`), deployment order (`twilio-voice-status` and `twilio-recording-status` before `twilio-voice-inbound`, all before any v2 flag), verification matrix; server-side group validation (1–10 distinct, same-org, Active, identity-bearing agents) by trigger + RPC; INSERT-only workflow-trigger limitation left documented. | §7.2, §11, §14, §3.2 |

Rev 2 corrections A–H (explicit group, Press 1 only, per-registration presence, atomic reservation, Twilio limits, voicemail access, cutover gate, explicit defaults) remain in force.

## 0b. Rev 4 — what was implemented, and the five approval safeguards

Every "as rev 2" reference in this document is replaced below by the behaviour that was actually built; where the two conflicted, the implementation (and this section) wins.

| Safeguard | How it is met | Proof |
|---|---|---|
| **1 Genuinely atomic mobile commitment** | `private.commit_owner_mobile` re-checks Active/DND/busy/mobile under the owner's advisory lock, then performs BOTH writes inside one subtransaction: the guarded parent-call D13 mark (`agent_id IS NULL AND outcome IS DISTINCT FROM 'forwarded_answered' AND status not terminal`) and the attempt CAS (`owner_browser → owner_mobile`, or the immediate path `stage='owner_mobile' AND missed_marked_at IS NULL`). A zero-row result on either side raises inside the block, rolling back both, and is returned as `call_not_forwardable` / `stage_conflict`. `plan_inbound_route` (immediate offline path) and `advance_to_owner_mobile` are its only callers; the Edge handler emits the mobile `<Dial>` only on `{updated:true, forward:true}` and follows the persisted stage otherwise; any RPC failure serves voicemail TwiML. `Offline` availability is NOT DND: it follows D3 (mobile), while `On Break`/`Do Not Disturb` refuse (D11). | SQL A4, A5, A5b, A6, A7, A8, A9, A12 + the two-session owner-reservation proof; vitest `inboundStages` S1–S2 (immediate forward, browser fallback, duplicate requests, RPC failure ⇒ never mobile). |
| **2 Notification recovery end to end** | ONE recipient rule and ONE completion rule live in SQL (`converge_inbound_notifications`): recipients = the durable snapshot's Active same-org members, else the organization's Active Admins; completion = a `notifications` row exists for EVERY required recipient, only then `missed_notified_at` / `voicemails.notified_at` is stamped; otherwise attempts+1 with exponential backoff (≤ 6 h). Every handler converges through it: `twilio-voice-inbound` stage handlers, `twilio-recording-status` (voicemail branch), and **`twilio-voice-status`** (its two projections carry the snapshot columns and `insertMissedCallNotifications` routes snapshot rows to the RPC, never to tiers 1–4). The pg_cron sweep (`*/2`, ≤ 100 rows, bounded to 50 attempts per record, **no age-based abandonment**) wraps each record in its own subtransaction so one failing record never blocks the others, and is scheduled in M7 — after every table and function it needs exists — only where pg_cron is installed. No backfill of historical rows. | SQL V4, V6–V9 (converge idempotency, completion stamps, sweep isolation); vitest `missedRecipientTier0` T0.1–T0.3 (A/B scenario for both call sites, failed first insert retryable, repeated callbacks idempotent, reassignment ignored). |
| **3 Recording cleanup recovery** | Voicemail rows carry `source_cleanup_state` (`pending`/`deleted`/`failed`) + attempts/next_at/error and `provider_account_sid`. A Twilio source DELETE failure after storage is recorded durably (`record_voicemail_cleanup_failure`), answered **503**, and the redelivered callback performs CLEANUP ONLY (no re-download, no re-upload, no metadata rewrite); `recording-retention-purge` retries due cleanups from `voicemails_cleanup_batch`. The notification is converged from the stored row regardless of cleanup state (never lost). Response policy: 503 only while media/metadata persistence is incomplete or cleanup is owed; 200 once stored + deleted even if the notification is still owed (sweep-owned). §14's drain gate counts undeleted sources. | SQL V3, V4; vitest `voicemailRecordingPipeline` VM1–VM4. |
| **4 Conservative rollback** | §14 rewritten: flipping `routing_engine` back to `legacy` only stops NEW v2 calls; the compatible handlers stay deployed; a 30-minute quiet period is never proof on its own — the drain gate's row checks (attempts, open calls, voicemails incl. `source_cleanup_state <> 'deleted'`, owed notifications) must all be empty; the M6 rollback restores every function body it replaced but **never** restores a `finalize_inbound_call_terminal` writer that clears `is_missed` (D13 monotonicity survives rollback); shared-function restoration is checked per v2 organization; removing the callback-compatibility handlers is out of scope. | `supabase/migrations/rollback/*.sql`; §14. |
| **5 Uncertain bridge evidence ≠ proven failure** | `record_inbound_mobile_bridge`: `DialBridged=true` ⇒ `dial_bridged` + attribution (`outcome`, `answered_by_agent_id`, `provider_session_id`), `false` ⇒ `not_bridged`, **absent** ⇒ `unconfirmed` with no attribution, no outcome, no duration proof, and no guessed "unanswered" — `is_missed` stays, provider status/duration stay Twilio's. The next-step TwiML is reconciled with the documented Dial-action results: `dial_bridged` ⇒ the parent ends; `unconfirmed` + recorded `accepted` + `DialCallStatus completed/answered` ⇒ the parent ends WITHOUT attribution (the caller is not sent to voicemail after a conversation the provider reports as completed); every other case ⇒ owner voicemail. A non-accepted leg is always `not_bridged`. | SQL A5, A10, A11; vitest `inboundStages` S3, `inboundV2Twiml` (`parseDialBridged`: absent ⇒ null). |

**Other implementation deltas (recorded, not silently absorbed):** `plan_inbound_route` takes `p_browser_ring_seconds` (the value written to `browser_ring_timeout_sent`); M7 adds `provider_account_sid` to `voicemails` and `p_account_sid DEFAULT NULL` to `upsert_voicemail_from_recording` (needed for cleanup retries from the purge function); the recovery sweep and cron schedule live in M7 (not M6) because they need `voicemails`; the availability picker moved to the top bar (three manual states, `On a Call`/`Offline` derived, hidden under "View As") and was removed from `ProfileInfoCard` (whose save would otherwise overwrite the top-bar value with a stale copy) and made display-only in `AgentModal` (its dropdown never wrote a profile); `IncomingCallModal.tsx` deleted; the after-hours SMS (a separate feature) is still sent under v2 while routing is identical after hours (D8); the D13 label also covers `no_answer` (group wave unanswered / wave suppressed) so no v2 missed row is unlabelled.

---

## 0c. Rev 5 — bounded corrective pass (seven implementation defects, from `a795eab`)

| # | Defect | Correction | Proof |
|---|---|---|---|
| 1 | Ring outputs were applied through `getTwilioDevice()` inside the `registered` event, but the wrapper published the Device only after `register()` resolved — and SDK 2.18.1 resolves `register()` AFTER emitting `registered` (`device.ts` `register`: `promisifyEvents(Registered)`), so on cold start the getter was null and nothing was configured. | `initTwilioDevice` publishes the Device BEFORE `register()`; every listener receives the Device instance (`onRegistered(device)`, `onUnregistered(device)`, `onError(err, device)`, new `onDeviceChange(device, lostActiveDevices)` from AudioHelper's documented `deviceChange`); the provider applies `applyRingtoneOutputs(device)` on `registered` and re-applies the saved preference on every `deviceChange` (headset plugged in / removed) without opening the profile page; a failed `ringtoneDevices.set` falls back to every output; conversation audio settings (`speakerDevices`, input, the outgoing-chime flag) are untouched; teardown retires the Device it built on `register()` failure. | vitest `twilioVoiceLifecycle` (fake SDK Device with the real ordering: `registered` fires, then `register()` resolves): cold start applies `["default","hs1"]` to the registered Device with the getter valid during the event; `deviceChange` re-applies; failed set falls back; `inboundDeviceLifetime` audit. |
| 2 | Only the idle-recovery timer checked call state; `initializeClient`, the network-online handler and the dialer entry points could destroy/replace a Device during a live call; `destroyTwilioDevice()` did not invalidate a pending initialization (a token fetch in flight during logout resumed and registered a Device nobody owned). | ONE coordinator (`src/lib/deviceLifecycle.ts`, pure, injected deps) behind every automatic entry point (`initializeClient` is the single caller of the wrapper): same-identity requests are DEFERRED while a call is ringing/dialing/active and resumed by `onCallEnded()`; single-flight; an identity change is an explicit teardown followed by a fresh generation; bounded recovery (3 per 60 s, not reset by a flapping re-registration). The wrapper carries a lifecycle GENERATION: `destroyTwilioDevice()` bumps it, so a pending init fails closed at its next checkpoint (after the token fetch, after `register()`) and retires whatever it built; listeners of obsolete Devices are ignored and an obsolete `incoming` is rejected. Explicit logout teardown and the SDK's own reconnect are preserved. | vitest `deviceLifecycle` (delayed init + logout ⇒ late Device retired, never ready; overlapping init ⇒ one Device; identity change; deferral during a live call resumed on idle; bounded attempts; stale rejection silent) and `twilioVoiceLifecycle` (logout during the token fetch ⇒ no Device built; logout during `register()` ⇒ late Device destroyed; overlapping init ⇒ one Device; new generation after logout). Adversarial review closed three gaps: wrapper listeners read the LATEST init handlers at event time (a recovery that reuses a still-registered Device re-targets its later events — `twilioVoiceLifecycle` "recovery over the REAL wrapper"); the coordinator no longer drops an `error` from a replacement Device that has not registered yet (`deviceLifecycle` L5); a started re-registration after an organization change reports `connecting`, not `ready`. Provider-level behavioral suite `twilioProviderLifecycle` (mounts `TwilioProvider`: cold start, org change, deferred recovery during a ringing call, sign-out). |
| 3 | `is_agent_busy` counted every member of an unresolved `group_browser` reservation busy for five minutes, though the attempt stays in that stage until the parent Dial action returns after the conversation — so when A and B rang together and B answered, an assigned call to A went to voicemail. | The browser-wave branch joins the parent call and follows the AUTHORITATIVE claim: busy only while `calls.agent_id IS NULL` (and the parent has not ended); once `claim_inbound_call` writes `agent_id`, only the claimant stays busy (through the `calls` branch) and the other reserved members are released immediately. Unanswered waves still reserve everyone (simultaneous-call protection). | SQL A15: unanswered wave ⇒ both busy and a concurrent assigned call refused; after a2's real `claim_inbound_call` ⇒ a3 released while the attempt is still `group_browser`, an assigned call to a3 rings, an assigned call to a2 goes to voicemail, a second group wave rings only a3. Review follow-up: before a GENUINE acceptance the owner-mobile reservation follows the parent (ended parent ⇒ released; `accepted_after_hangup` / wrong / missing digit never earn the 4-hour ceiling); a genuine acceptance keeps the approved A5b ceiling until the leg-end callback. SQL A18. |
| 4 | `loadV2RoutingSettings` returned legacy on any read error; `resolveContactAssignedAgent` returned "no owner" on any read error — a database blip could route an enabled agency through the legacy engine or send a known contact's call to the group. | New Deno-free `settings.ts` at the dependency boundary: bounded retries (3, paced), discriminated results that separate SUCCESSFUL "not configured"/"unassigned" from FAILED reads, and `decideInboundStart` (settings failure ⇒ `infrastructure_failure`, never legacy; owner-lookup failure on a v2 organization ⇒ `infrastructure_failure`, never the group). The handler answers such a failure with the documented infrastructure-failure path (sorry greeting + hangup, guarded missed mark + legacy-tier notification, terminal finalize) — the same path the ingest refusal takes. Stage callbacks that cannot read the stored call are refused without writes (503 for the non-TwiML child status callback). | vitest `inboundSettingsBoundary` with a fake PostgREST builder: transient errors retried, persistent errors reported, null row ⇒ legacy, unassigned ⇒ null owner, lookup failure ⇒ failure; the handler decision table. Review follow-ups: the documented rollback state (M5 columns absent — 42703/42P01/PGRST204-205) is recognized deterministically and runs legacy, never retried, never a failure; a direct line skips the contact-owner lookup (P1), so its failure cannot hang the call up; `loadAttemptRow` + `StageReadError` — a failed attempt read is answered explicitly (503 / whisper refusal / failure path), never "no attempt"; retries bounded in wall time (2.5 s per attempt, 6 s budget) and the failure side effects under a 4 s deadline; the failure glue (`resolveInboundStart`, `runInfrastructureFailure`) is unit-tested. Deliberate consequence, documented in §8: an unreadable engine flag takes the failure path for EVERY organization rather than routing by assumption. |
| 5 | UUID syntax was the only check: mobile bridge attribution never compared `DialCallSid` with the accepted child SID, and no handler bound the provider's parent-call fields to the stored call. A previously recorded acceptance authorized bridging on a replayed Gather even after the caller hung up. | The dispatcher loads the stored call (bounded retries) and `verifyCallbackIdentity` binds every callback to it using Twilio's documented fields: parent-facing requests (`<Dial action>` for owner_browser / owner_mobile / group_browser, `<Record action>`) must carry `CallSid` = stored parent; child-leg requests (`<Number url>` whisper, `<Number statusCallback>`) must carry `ParentCallSid` = stored parent, `CallSid` = the bound child when one exists, and the whisper's `To` = the dialed destination snapshot (E.164-ish normalization); organization must match. Refusals write nothing (the whisper refusal is an explicit `<Hangup/>`, because an empty response would bridge). In SQL, `record_inbound_mobile_accept` takes `p_parent_call_sid`/`p_to_number`, `record_inbound_mobile_bridge` and `record_inbound_mobile_leg_end` take `p_parent_call_sid`; a Dial action whose `DialCallSid` is not the accepted child attributes nothing and records no evidence. A replayed Gather re-checks caller presence: `accept` (bridge permission) is false once the parent ended while `result`/`mobile_accepted_at` (the original acceptance fact) stay untouched. | SQL A16 (parent, destination, attempt, organization, child mismatches ⇒ no mutation, no attribution; genuine requests land) and A17 (replay after hangup refuses bridging, acceptance fact preserved); vitest `inboundCallbackIdentity` (verifier matrix; whisper mismatch ⇒ hangup with zero RPC calls; parent/To ride the RPCs; replay after hangup never bridges; child-SID mismatch ⇒ voicemail, no finalize). Review follow-ups: an absent `DialCallSid` after a child is bound is a mismatch (no attribution); E.164 inputs are taken as dialed (the NANP prefix applies only to bare 10-digit national numbers — no cross-country collision); the malformed-identifier refusal on the whisper stage hangs the child leg up. |
| 6 | The frontend mapped a stored `Offline` to Available while SQL excludes that agent from browser ringing; the availability controls appeared before v2 activation although the legacy engine ignores them; legacy routing controls stayed editable under v2. | `AgentStatusContext` keeps the STORED value truthful (`Offline` ⇒ "Offline (set on your profile)", no manual selection, the top bar says calls skip AgentFlow), reads the organization's `routing_engine` and exposes `activationPending` + a one-sentence routing effect; the top-bar picker and the profile inbound card show "Pending activation" while the engine is legacy/unknown (the value is saved and applies on activation); under v2 the Inbound Routing page retires the routing strategy, fallback chain and fallback action (read-only, labelled). No backfill of stored values. The v2 card reports the loaded engine to the page through a ref so the page's callback identity never re-creates the card's loader (a parent re-render must not refetch and discard an unsaved edit). | vitest `agentStatusContext` (stored Offline truthful; legacy/unknown pending; v2 enforced; View As writes nothing), `inboundCallLabels` derivation, `topBarViewAsShell`. Review follow-ups: in-session engine refresh (`agentflow:routing-engine` announced by the admin card; bounded 3-attempt read); the profile card never asserts "legacy" for an unknown engine; strategy radios truly disabled under v2 and retired fields never written on save, while the organization voicemail greeting (played by v2) stays editable; rendered surfaces pinned (`topBarAvailabilityGating`, `profileInboundCard`, `inboundRoutingManagerGating`). |
| 7 | `DashboardDetailModal` selected `voicemail_id` but rendered no player; playback URLs expired after five minutes with no recovery; `listened_at` was stamped on the play intent; retention could mark a voicemail purged while `voicemails_cleanup_batch` selected only `stored` rows, orphaning the Twilio source. | The dashboard detail rows render `VoicemailPlayer` (voicemail id only — unlinked callers included); the player refreshes an aged signed URL before playing (pause → new URL → resume) and once after a media error, and stamps `listened_at` only on the browser's `playing` event; `voicemails_cleanup_batch` includes `purged` rows whose `source_cleanup_state <> 'deleted'`. | vitest `voicemailPlayer` (listened only on `playing`; stale URL refreshed before play; error ⇒ one refresh; purged/missing reported); SQL V10 (purge before cleanup ⇒ still eligible until the source is deleted). Review follow-ups: bounded error recovery (2 per mount, not reset by `playing`), position-preserving refresh (restored on `loadedmetadata`, resumes only if playing / play pressed), a failed refresh keeps a still-valid player, the cleanup partial index follows the widened predicate, and `dashboardDetailModalVoicemail` pins the unlinked-caller player. |

**Generated types:** `src/integrations/supabase/types.ts` is verified by `scripts/verify_inbound_generated_types.sh` against types GENERATED from a complete ISOLATED local schema (harness + M1–M3 + v2 harness + M4–M7) — never from production, and never by applying migrations to production. The Supabase CLI's `gen types --db-url` needs Docker (absent here), so the script runs the same generator the pinned CLI 2.84.5 ships (`@supabase/postgres-meta` v0.96.1, the CLI's `supabase/postgres-meta:v0.96.1` image) directly against the throwaway database and type-checks structural identity (`Check<>` = mutual assignability) for the four new tables (Row/Insert/Update/Relationships), the added `calls` / `inbound_routing_settings` columns, and all 23 v2 RPC signatures. The script aborts if any harness/migration fails to apply (a half-built schema is never reported). The first run found 19 hand-extended blocks that did NOT match (`agent_phone_registrations` lacked `created_at`/`updated_at` and `registered_at` is nullable; `inbound_route_attempts.eligibility_reason` is NOT NULL and `voicemail_group_ids` nullable; Relationships were empty; optional RPC args carried `| null`; TABLE-returning columns were nullable) — those blocks now carry the generated text verbatim, and the script exits 0.

---

## 0d. Rev 6 — bounded corrective pass (four findings, from `667c5c3`)

Authorization, D1–D13, P1–P17 and the exact §7.7 RLS scope unchanged; development-only; nothing merged, deployed, applied to a hosted database, activated, changed at Twilio, called live, or written to production rows. Every regression test below was run against a worktree at `667c5c3` first (fails there) and against the corrected tree (passes).

| # | Finding | Correction | Proof |
|---|---|---|---|
| 1 | `DeviceLifecycle.run()` reported `init_failed` but scheduled no recovery; `onCallEnded()` only resumes a deferred request. A transient token 500 while online and idle left the agent unreachable until the dialer was opened, a tab switched, the page reloaded or a network-online event fired. | A transient token-fetch / registration failure now enters the SAME bounded recovery as `unregistered` / `error` (`scheduleRecovery("init_failed")`): 2 s delay, 3 attempts per 60 s window, the live-call guard (deferred while ringing/dialing/active, resumed on idle), generation checks; a recovery attempt that fails again schedules the next until the window's cap; a logout clears the pending timer. | `deviceLifecycle` L6 (token 500 ⇒ one timer ⇒ re-init ⇒ ready, with `onCallEnded()` as the only other trigger; failure ×(1+3) then exhausted, re-armed by a new window; logout cancels; deferral during a live call). Base `667c5c3`: all four fail (`timers` empty, one init). |
| 2 | `requestInit()` awaited `teardown("identity_change")`, then assigned the requested identity and started, without checking whether a newer logout or identity change had superseded it while destruction was pending. | Every request carries a sequence number; the pending teardown is awaited as a shared promise and the request stands down (`"superseded"`, a new `InitOutcome`) when a newer request or an external teardown bumped the sequence meanwhile. The requested identity becomes the intended one before the teardown starts, so a same-identity request during the wait joins rather than forks; only the LAST teardown clears the shared marker. The provider's network-online timer snapshots the identity at the event and re-validates it (refs) at fire time, calling the latest `initializeClient`. | `deviceLifecycle` L7 with genuinely delayed destruction (A→B then logout ⇒ B superseded, nothing initializes, no identity; A→B then A→C ⇒ B superseded, C once; ordinary A→B with a joining same-identity request); `twilioProviderLifecycle` (queued online callback then sign-out ⇒ no Device for the signed-out user). Base: `"started"` instead of `"superseded"`; a second init after sign-out. |
| 3 | The provider's init dependency assigned `getUserMedia()`'s result to `mediaStreamRef` BEFORE the liveness check: a permission result returned to an obsolete attempt was retained with no track stopped, and an old result could overwrite the current generation's stream. | The acquired stream stays local until `isLive()` confirms ownership; an obsolete result has its tracks stopped and never becomes the provider's stream; a live result replaces the previous REGISTRATION stream (stopped, never leaked); a stream owned by a call is never touched (initialization never runs while a call is live, and the call's own end handler releases its stream). | `twilioProviderLifecycle`: permission pending → sign-out → result ⇒ track stopped, wrapper never called; old result after a newer generation succeeded ⇒ old stopped once, current untouched, sign-out stops the current; idle recovery ⇒ previous stopped once, replacement kept; during a ringing call ⇒ no capture, no stop. Base: `stop` never called. |
| 4 | `withRetries()` gave every attempt the full per-attempt timeout and checked the budget only between attempts (three stalled reads: 7 800 ms against an advertised 6 000 ms); settings, owner lookup and failure handling each had independent budgets, so a slow settings success followed by an owner failure exceeded Twilio's 15 s webhook ceiling before a response existed. | ONE absolute `RequestDeadline` per request (`REQUEST_DEADLINE_MS` = 12 000 under Twilio's 15 000, created on arrival in `index.ts`) carried through every read, RPC wait and side effect: `withRetries` clips each attempt and pause to the remaining budget (`budgetMs` is absolute; `deadline` + `reserveMs` clip it further); `request.ts` holds the handler sequences — `runInboundStartRequest` (settings → owner → decision → failure path, each step clipped, `FAILURE_PATH_RESERVE_MS` = 2 500 kept ahead of decision reads, `RESPONSE_RESERVE_MS` = 500 kept for the response), `runInitialV2Request` (planning RPC waits clipped), `runStageRequest` (phone/v2/call reads, attempt read, identity binding, the stage handler with `deadlineBoundStageDeps`); `runInfrastructureFailure` is bounded by what the deadline leaves and, with nothing left, starts the side effects without awaiting them. An RPC abandoned at the deadline has an UNKNOWN outcome: `rpcWithRetry` raises `StageReadError`, the dispatcher answers on the explicit failure path (bounded missed mark + terminal finalize + sorry greeting; whisper ⇒ hangup; leg status ⇒ 503 redelivery), late results are dropped, and — so that work outliving the deadline cannot produce a conflicting transition — `plan_inbound_route` refuses a finalized call (`call_terminal`), `advance_inbound_route_stage` refuses any non-`done` transition on an ended/finalized parent (`call_terminal`; closing stays allowed for the voicemail-done / leg-end callbacks), and `advance_to_owner_mobile` refuses before any stage change on a finalized parent. The legacy engine's routing is unchanged; its early shared reads (phone number, phone settings, ingest) are bounded by the same deadline and answered with the sorry greeting on expiry (previously a Twilio timeout). Schema-absent rollback, transaction atomicity, idempotency, durable notification recovery and the defect-5 identity checks are untouched. The ≈20 s agent ring (call time inside `<Dial>`) is not affected. | `inboundRequestDeadline` (handler level, fake timers): three stalled reads ≤ 6 000 ms; a deadline clips a read and keeps its reserve; stalled failure side effects never delay the response; slow settings success (3rd attempt) + stalled owner lookup + stalled side effects ⇒ sorry inside 12 000 ms, the late owner result never consulted; fast settings failure ⇒ answered at once with missed → finalize completed; stalled `advance_to_owner_mobile` ⇒ failure path + sorry inside the deadline, the parent finalized, the late commit routes nothing; stalled stored-call read on the leg status ⇒ 503 inside the deadline; stalled `plan_inbound_route` ⇒ sorry, no `<Client>`, late plan routes nothing. SQL A19: a plan on a finalized call creates nothing and reserves nobody; a stage advance into voicemail on an ended parent is refused while `done` is allowed; the owner-mobile commit on a finalized parent is refused with the attempt untouched; a live parent still advances. Base `667c5c3`: `withRetries` measured 7 800 ms; the deadline helpers do not exist; A19 fails (a late plan created an `owner_browser` attempt and reserved the owner on a finalized call). |

**Release sequence** (unchanged in order; the webhook deadline is code inside `twilio-voice-inbound` and the SQL guards live in M6, both unapplied): M4 → M7 → `twilio-voice-status` → `twilio-recording-status` → `recording-retention-purge` → `twilio-voice-inbound` → frontend → per-organization prerequisites → `v2` for one organization → live checks (§18), each step separately approved.

## 0e. Rev 7 — bounded corrective pass (two findings, from `a8a09c4`)

Authorization, D1–D13, P1–P17 and the exact §7.7 RLS scope unchanged; development-only; nothing merged, deployed, applied to a hosted database, activated, changed at Twilio, called live, or written to production rows. Every regression test below was run in a worktree at `a8a09c4` first (fails there) and on the corrected tree (passes). The ≈20 s browser ring is untouched.

| # | Finding | Correction | Proof |
|---|---|---|---|
| 1 | The provider's init dependency rechecked generation ownership after `getUserMedia()` but not call state: a recovery whose microphone prompt resolved while a call was ringing, answered or dialing stopped the call's stream, overwrote `mediaStreamRef` and continued into the SDK wrapper. | After the prompt resolves the dependency rechecks `isLive()` AND the live-call predicate before touching anything. A call that began meanwhile ⇒ only the unused recovery stream is stopped and the attempt throws `LifecycleDeferredError`; the coordinator records it as a deferral (no error, no recovery timer, readiness unchanged) and resumes on `onCallEnded()`. The call's stream, Device and listeners are never touched; the outbound `makeCall` path stays refused by the provider's own readiness guards while recovery is pending. | `deviceLifecycle` L8 (deferral semantics, stale deferral ignored); `twilioProviderLifecycle`: ringing / answered (active) / the answer's dialing window during a pending recovery prompt ⇒ the call's tracks never stopped, its reference intact, the recovery stream released, recovery resumed after the call; an outbound dial during pending recovery is refused. Base `a8a09c4`: the call's stream stopped (`stop` called on the wrong track). |
| 2 | Deadline abandonment was not safe through database completion: `runInfrastructureFailure` awaited the missed-call notification before finalizing (a stalled notify blocked the terminal decision); stage RPC waits consumed the budget down to the response reserve; M6 checked the parent's state before waiting for the agent advisory lock (a planner could read a live parent, block, then insert after another session finalized) and `advance_inbound_route_stage` separated its check from its write; the sweeps could not finalize calls or close attempts. | **SQL (M6, unapplied):** lock order = `calls` row (`FOR UPDATE`) FIRST, then the agent advisory lock, in `plan_inbound_route`, `advance_to_owner_mobile` and (for non-`done` targets) `advance_inbound_route_stage`, so the parent-state check and the routing write are one atomic decision; `finalize_inbound_call_terminal` closes the open ring stages of the call in the same transaction (browser ring stages and an UNACCEPTED mobile dial; voicemail stages, an accepted mobile leg and every closing/telemetry callback untouched; dynamic + guarded so the retained body survives the M6 rollback); new `abandon_inbound_routing(call, org, reason, recipients, for_agent)` = the ONE atomic failure decision (row lock → finalize `no-answer` → D13 `mark_inbound_missed` with the reserved/owner/group recipients → closure of stragglers; an answered call is never marked); new `sweep_inbound_route_attempts(grace, stale, limit)` = durable recovery (ring stages left open on a terminal parent are closed after a grace period; inbound calls still non-terminal 30 minutes after they started with no claim are abandoned), scheduled by M7 (`inbound-route-attempt-sweep`, every 2 minutes) next to the notification sweep; rollbacks drop/unschedule both. **Edge:** `runInfrastructureFailure` awaits ONLY the abandon decision (budget = what the deadline leaves minus the response reserve); notification work (legacy tiers) is chained strictly AFTER the decision and handed to Supabase's documented background handling (`EdgeRuntime.waitUntil`), never awaited; a decision that cannot complete in time is handed over the same way (`handed_over`) — durable recovery covers a terminated worker; routing RPC waits (`deadlineBoundStageDeps`, `rpcWithRetry`) reserve `FAILURE_PATH_RESERVE_MS` so the decision always has awaited budget. D13 notification of an abandoned call is delivered by the existing `sweep_inbound_notifications` (the abandon leaves `is_missed` + recipients + `missed_notified_at IS NULL`). | SQL A19 (finalize closes the ring stage atomically; a voicemail stage is not closed and its `done` stays allowed), A20 (abandon: finalize + D13 + closure + release in one call, idempotent; answered call refused; sweep respects the grace period, closes strays, abandons stale ringing calls, late telemetry still lands, the notification is owed). **Four three-session barrier proofs in the runner** (A holds the agent lock ~3 s; B starts the routing write and waits; C finalizes/abandons meanwhile; A releases): owner planning vs abandon, group planning vs finalize, owner-mobile advance vs abandon, stage transition vs a finalize in flight ⇒ call terminal, attempt closed with `parent_no-answer`, reservations empty, nobody busy. Handler level (`inboundRequestDeadline`, `inboundSettingsBoundary`): planning past the deadline with a stalled notify ⇒ `abandon` started and COMPLETED before the response, notify started after it in the background; an abandon that outlives the deadline ⇒ handed over, response on time; an abandoned stage RPC leaves ≥ the failure reserve for the decision; the abandoned plan resolving after the response routes nothing. Base `a8a09c4` (real concurrent sessions on the base migrations): group planning vs finalize ⇒ an OPEN `group_voicemail` attempt on the finalized call; stage transition vs finalize in flight ⇒ the advance succeeded (`updated: true`) and left `no-answer|group_voicemail:terminal=false`; the handler timeline showed finalize never ran behind the stalled notify. |

**Release sequence** (order unchanged; M6/M7 carry the new functions, guards and the second cron job; `twilio-voice-inbound` carries the abandon path): M4 → M7 → `twilio-voice-status` → `twilio-recording-status` → `recording-retention-purge` → `twilio-voice-inbound` → frontend → per-organization prerequisites → `v2` for one organization → live checks (§18), each step separately approved.

## 0f. Rev 8 — bounded corrective pass (four findings, from `b86aaea`)

Authorization, D1–D13, P1–P17 and the exact §7.7 RLS scope unchanged; development-only; nothing merged, deployed, applied to a hosted database, activated, changed at Twilio, called live, or written to production rows. Each regression was reproduced against `b86aaea` first (the new SQL blocks run on the base migrations; the notification wiring test run with the base projection) and passes on the corrected tree. The ≈20 s browser ring is untouched.

| # | Finding | Correction | Proof |
|---|---|---|---|
| 1 | The stale-call sweep selected old unclaimed inbound calls without looking at the attempt's mobile acceptance, and `abandon_inbound_routing` protected only a browser claim or a forwarded-answer outcome: a genuinely accepted mobile conversation (parent still `ringing`, no claim, bridge attribution pending on the Dial action) could be finalized `no-answer` after 30 minutes. The sweep also scanned every organization, legacy calls included, and M7 schedules it before activation. | A GENUINE live acceptance — result `accepted`, child leg not ended, inside the approved A5b 4-hour ceiling — is excluded from sweep selection and refused by `abandon_inbound_routing` (`mobile_accepted_live`); nothing is fabricated (no claim, no bridge evidence, no duration); D13 stays "forwarded to mobile". Recovery ownership is durable and positive — **superseded by §0g finding 1, which replaced the engine-history inference (and its table) with the per-call decision `calls.routing_engine`; the text below is kept only as the record of what rev 8 shipped.** | SQL A22 (1): accepted, live, 45 minutes old, parent ringing ⇒ the sweep changes nothing, direct abandonment is refused, the owner stays busy; past the 4-hour ceiling with no leg end ⇒ completed and closed, nothing fabricated. A23 (rewritten in §0g): a legacy organization's 3-hour-old ringing call untouched; after the organization rolls back to legacy, a planned v2 call AND a v2 call that failed before any attempt are recovered (recipients = the configured group); a call not decided `v2` is untouched. Base `b86aaea`: the sweep abandoned the live accepted conversation (`calls_abandoned: 1`); no ownership record existed. |
| 2 | The closure predicates used `mobile_accepted_at IS NULL` for "unaccepted", but `record_inbound_mobile_accept` stamps that timestamp for `wrong_digit`, `no_digit` and `accepted_after_hangup` too — those attempts stayed open indefinitely when the parent Dial action was lost; the child-end RPC records lifecycle only. | Closure follows the acceptance RESULT and lifecycle evidence: finalize and the sweep close a mobile stage whose result is not `accepted` (wrong/no digit, after hangup); a genuinely accepted stage is closed only by its Dial action, or by the sweep once its child leg has ended or the 4-hour ceiling passed (parent terminal ⇒ after the grace period; parent still ringing ⇒ the stale branch finalizes the parent `completed` — never `no-answer` — and closes it). Late bridge/telemetry/voicemail callbacks keep landing on closed attempts; no evidence is deleted. | SQL A22 (2): wrong digit, no digit and acceptance-after-hangup with a terminal parent and no Dial action ⇒ untouched inside the grace period, then closed with the reservation released and D13 intact; (3): accepted, child ended, Dial action never arrives, parent ringing ⇒ the stale sweep completes the parent and closes the attempt, a late bridge callback still records attribution; (3b): accepted + leg ended on a terminal parent ⇒ closed after the grace period. |
| 3 | `abandon_inbound_routing` finalized before resolving recipients; the finalizer clears `reserved_agent_ids`; for a group ring the owner and voicemail group are null, so the resolution produced an EMPTY, non-null array and `coalesce` skipped `routed_agent_ids` — stage failures and sweep recovery (no explicit recipients) notified nobody, and the notification sweep requires a non-empty snapshot. | Recipients are resolved BEFORE the abandon routine's own finalize, with deliberate fallbacks in which an empty array never wins (explicit list → the attempt's reservation → its owner → its voicemail group → the legacy routed set → the organization's configured group for a v2-owned call → an existing snapshot). Because another finalizer can win the race, every closure that clears a reservation — `finalize_inbound_call_terminal` and the sweep — first preserves the reserved members into the call's D13 snapshot (`missed_recipient_ids` when still empty, `missed_for_agent_id` when null) in the same statement; `mark_inbound_missed` keeps an existing non-empty snapshot. | SQL A21: group abandonment with no explicit recipients ⇒ the two reserved members; no attempt + populated routed set ⇒ the routed agent; planning committed but routed persistence never done ⇒ the reservation; the status-callback finalizer winning first ⇒ the snapshot preserved and kept by the later abandonment; repeated abandonment + `converge_inbound_notifications` twice ⇒ exactly one labelled alert per intended member, none for an agent who was not rung, `missed_notified_at` stamped. Base `b86aaea`: recipients empty. |
| 4 | The background `notify` called `markMissedAndNotify`, whose projection omits `missed_recipient_ids`, `missed_reason` and `missed_for_agent_id`: the shared helper never saw the snapshot, bypassed tier 0 and alerted the number owner B instead of saved recipient A. | New Deno-free `failure.ts`: the failure dependencies re-read the COMMITTED row with the complete D13 projection and hand it to the real shared helper, whose tier 0 routes a snapshot row to `converge_inbound_notifications` (the authoritative SQL rule, durable retries by the notification sweep); a row that is not missed (the decision did not land) is skipped — never classified; `runInfrastructureFailure` chains notification work only after a SUCCESSFUL decision (an errored abandon triggers no separate legacy classification); the work stays in the background. `markMissedAndNotify` remains legacy-only. | vitest `inboundFailureNotification` through the actual wiring and the real helper against a fake PostgREST client: A vs number owner B ⇒ one convergence call, no legacy upsert, every projection carries the D13 columns; reassignment ⇒ the committed snapshot decides; a failed convergence is retryable with no fallback blast, the next attempt converges, a third is skipped as already notified; a stalled notification never delays the response; a failed abandon ⇒ no notification, no classification; a not-yet-landed decision ⇒ skipped. Base `b86aaea`: the base projection ran the legacy tiers (no convergence call). |

**Release sequence** (order unchanged; M6 carries the acceptance-aware closure/abandon/sweep, `twilio-voice-inbound` the snapshot-honouring notification): M4 → M7 → `twilio-voice-status` → `twilio-recording-status` → `recording-retention-purge` → `twilio-voice-inbound` → frontend → per-organization prerequisites → `v2` for one organization → live checks (§18), each step separately approved.

## 0g. Rev 9 — bounded corrective pass (four findings, from `7c66682`)

Authorization, D1–D13, P1–P17 and the exact §7.7 RLS scope unchanged — **this pass REMOVES the rev 8 object that exceeded that scope and adds none**; development-only; nothing merged, deployed, applied to a hosted database, activated, changed at Twilio, called live, or written to production rows. Every correction was reproduced against `7c66682` first (the scenarios below run on the base migrations and show the defective behaviour there) and passes on the corrected tree. The ≈20 s browser ring is untouched.

| # | Finding | Correction | Proof |
|---|---|---|---|
| 1 | Recovery ownership was INFERRED: a call counted as v2 work when the organization's engine history said `v2` at the call's creation instant. That is not the engine the request actually used — the settings read happens inside the request, so a cutover in either direction misclassifies the calls in flight across it, and the inference cannot see a handler that decided `v2` and died before creating an attempt. | The engine is a DURABLE PER-CALL DECISION, coordinated with routing: `calls.routing_engine` (`legacy`/`v2`, NULL = no decision) written by the new `record_inbound_engine_decision(call, org, engine)` under the call's row lock — **first decision wins**, and every later caller (a duplicate webhook) is handed the persisted one. The handler records it BEFORE any engine-specific work (owner lookup, planning) and then routes with the PERSISTED engine; `plan_inbound_route` refuses any call whose decision is not `v2` (`engine_mismatch`), so no v2 work can exist without the decision. Recovery owns exactly `routing_engine = 'v2' OR an attempt exists`. **A request with no successful decision is never read as a decision:** NULL is never inferred (the sweep ignores it), and for a v2 organization a decision that cannot be recorded takes the infrastructure-failure path (`engine_decision_unavailable`) instead of routing work recovery could never claim; a legacy organization is unaffected (recovery owns no legacy work), which also keeps the M6-rolled-back state working. The rev 8 history table, trigger and helper are removed. | SQL A23 (rewritten): decided `v2` + planned, and decided `v2` with NO attempt, are both recovered after the organization rolls back to legacy; a call decided `legacy` while the organization reads `v2`, a call with NO decision, and a never-activated organization's 3-hour-old call are all untouched — and still untouched after the organization is switched back to `v2` and swept again (the current flag never claims a call); the decision survives recovery unchanged. A26: planning refused before any decision and for a `legacy` decision; first decision wins against a later `legacy` write; unknown call and invalid engine rejected. vitest `inboundEngineDecision` (16 cases): the decision precedes the owner lookup; both cutover directions route with the persisted engine; an unrecordable decision answers the caller for v2 and is transparent for legacy; a missing function is a one-attempt deterministic failure; a STALLED decision RPC is bounded by the request deadline and answered on the failure path (v2) or on the legacy path with a single attempt — the decision is a precondition for v2 and a best-effort audit write for legacy, so it never lengthens the legacy critical path. Base `7c66682`: a v2-routed call created just before the history window is left ringing forever (owed work lost), and a legacy-routed call created inside the window is abandoned by the v2 sweep. |
| 2 | The Press-1 acceptance and the abandonment did not serialize: acceptance took the agent advisory lock and read the parent WITHOUT locking it, while the abandonment read the attempt WITHOUT locking it. A live accepted conversation could be classified unanswered, and a late acceptance could grant bridge permission from a stale parent read. | ONE lock order in every writer that touches both rows — **parent `calls` row → attempt row → agent advisory lock** — now also in `record_inbound_mobile_accept` (caller presence is read from the LOCKED parent), `record_inbound_mobile_bridge`, `abandon_inbound_routing` (attempt read `FOR UPDATE`), `finalize_inbound_call_terminal` and both sweep branches. The finalize closure and the sweep's due branch no longer rely on CTE update ordering: the rows are locked, the call's D13 snapshot is preserved, and only then are the attempts closed — separate statements, in that order (PostgreSQL gives data-modifying CTEs no ordering guarantee). Caller-hangup handling, the A5b 4-hour busy ceiling, late bridge/telemetry evidence and D13 are unchanged. | Two TRUE three-session barrier proofs in the runner, both orderings, on the isolated database: session A holds the ATTEMPT ROW lock, B runs the Press-1 acceptance, C runs the abandonment (and the reverse), A releases, and both the RPC results and the committed rows are asserted. Acceptance first ⇒ `accept: true/accepted` and the abandonment REFUSES (`mobile_accepted_live`), call still ringing, owner still reserved. Abandonment first ⇒ it commits and the late acceptance is REFUSED (`stage_mismatch`), no bridge permission, the attempt closed with no acceptance recorded. Base `7c66682`, same proofs: acceptance first ⇒ the abandonment still committed and finalized the live accepted conversation `no-answer`; abandonment first ⇒ the late acceptance still returned `accept: true, caller_present: true` on an already terminal call. |
| 3 | When the contact-owner lookup failed, the abandonment's recipient chain fell through to the organization's configured inbound group: an unavailable lookup was treated as a successful "no assigned agent", so a known contact's call alerted the group instead of their agent. | Recipients are resolved from VALIDATED evidence inside the database before any snapshot is committed: the new `private.intended_recipients_for_call` reproduces the planner's precedence from committed rows — P1 the dialed number when it is a DIRECT LINE with an owner, else D2 the identified contact's `assigned_agent_id` (an Active member), else D5 the configured group ONLY for a caller established as unknown or unassigned; a contact row that cannot be read resolves nobody rather than the group. It sits in the abandonment chain after the attempt/owner/routed evidence and before the existing snapshot. | SQL A24: assigned agent A (outside the group), number owner B on a non-direct line, failed owner lookup, no attempt, worker lost ⇒ recovery snapshots exactly `[A]`, and `converge_inbound_notifications` sends exactly one alert, to A — none to B, to the group members or to the admin; a genuinely unassigned caller still snapshots and notifies the two group members; a DIRECT LINE outranks the contact's assigned agent. Base `7c66682`: the same scenario snapshotted the group and alerted both group members, A none. |
| 4 | The rev 8 ownership implementation added `public.inbound_routing_engine_history` with RLS enabled — a table outside the approved §7.7 RLS scope. | The superseded, unapplied implementation is REMOVED (table, trigger, `private.record_inbound_engine_history`, `private.inbound_engine_at`, the M5 rollback drops and the generated types). Ownership is implemented with already-authorized schema: a column on `calls` (whose RLS and policies are untouched) plus a service-role-only `SECURITY DEFINER` RPC and a `private` helper — no new RLS object, no policy change, no RLS disabled anywhere, and no approval token added to this document. | Enumerated on both isolated schemas: base `7c66682` enables RLS on six M4–M7 tables, one of them outside §7.7; the corrected tree enables RLS on exactly the five approved tables (`agent_inbound_settings`, `agent_phone_registrations`, `inbound_route_attempts`, `voicemails`, plus the pre-existing `inbound_routing_settings`), and `public.calls` RLS is identical on both. `scripts/verify_inbound_generated_types.sh` OK after the removal. |

**Rollback compatibility.** The M6 rollback drops `record_inbound_engine_decision`, `private.intended_recipients_for_call`, the `routing_engine` column and its CHECK; the M5 rollback no longer references the removed history objects. With M6 rolled back the decision RPC is absent: that is recognised as a deterministic schema absence (one attempt, no retries) and the legacy path proceeds unchanged, which is the only path that exists in that state.

**Release sequence** unchanged: M4 → M7 → `twilio-voice-status` → `twilio-recording-status` → `recording-retention-purge` → `twilio-voice-inbound` → frontend → per-organization prerequisites → `v2` for one organization → live checks (§18), each step separately approved.

## 0h. Rev 10 — bounded corrective pass (two findings, from `bbf8a8a`)

Authorization, D1–D13, P1–P17 and the exact §7.7 RLS scope unchanged; no new RLS object and no policy change; development-only; nothing merged, deployed, applied to a hosted database, activated, changed at Twilio, called live, or written to production rows. Both regressions were reproduced against `bbf8a8a` first and pass on the corrected tree. The ≈20 s browser ring is untouched.

| # | Finding | Correction | Proof |
|---|---|---|---|
| 1 | A decision failure entered `engine_decision_unavailable` only when the organization's CURRENTLY read engine was `v2`. Reading `legacy`, the handler proceeded legacy whatever the failure — so a duplicate initial webhook for a call already carrying `routing_engine='v2'`, in an organization that has since rolled back, routed LEGACY on a transient error. The same RPC is the only way to read that saved decision, so its result is routing authority, not an optional audit write. | An UNRESOLVED decision — transport error, timeout, unknown outcome, a call row the RPC could not read — leaves the persisted decision unknown, and an unknown decision is never replaced by the current flag: the request takes the infrastructure-failure path in BOTH directions, performing no engine-specific work of either engine (not even the owner lookup). The single exception is POSITIVELY ESTABLISHED schema absence (the documented rollback state, decided on the first attempt without retries): the whole v2 routing schema lives in one migration, so no call can carry a v2 decision and legacy is the only engine that can run — for a `v2`-flagged organization too. The deadline and the failure reserve are unchanged: the decision is one bounded read like every other, with no extra retry and no second routing decision. | vitest `inboundEngineDecision` (18): saved v2 decision + current legacy flag + transient error ⇒ sorry greeting, `engine_decision_unavailable`, zero owner lookups, no legacy TwiML; the same case with a STALLED RPC ⇒ answered inside the deadline, and the late successful result routes nothing; `call_not_found` is unresolved too; both cutover directions with a readable decision still route with the persisted engine; schema absence proceeds legacy under either flag. Base `bbf8a8a`: four of these fail — it returns `proceed`/legacy on the transient error, on `call_not_found` and on the stall, and answers the failure path for the schema-absence case. |
| 2 | `private.intended_recipients_for_call` deliberately resolves NOBODY when the identified contact row cannot be read, so abandonment commits a v2 call that is missed and terminal with an EMPTY `missed_recipient_ids`. The failure path handed that row to the shared helper, whose projection omitted `routing_engine`; an empty snapshot read as "no snapshot" and the LEGACY tiers alerted the dialled number's owner. Nothing retried resolution either: the route sweep skips a terminal parent and the notification sweep required a non-empty snapshot. | The engine is the discriminator at every notification entry point. `routing_engine` is carried in the failure-path projection, the legacy mark-missed projection and both parent-status-callback projections; `insertMissedCallNotifications` sends every v2 row to the SQL rule whether or not its snapshot is populated, so the legacy tiers are unreachable for v2 work. Durable recovery uses the authorized schema only: `abandon_inbound_routing` records `missed_notify_error='unresolved_recipient'` when it commits a v2 row with no recipient; `converge_inbound_notifications` RETRIES `private.intended_recipients_for_call` for such a row, persists a resolved snapshot monotonically (`mark_inbound_missed` keeps an existing one), notifies, and while it stays unresolved re-records the owed work with the existing bounded backoff — never stamping delivery and never inventing ownership; `sweep_inbound_notifications` now treats a v2 row with an empty snapshot as due, so the retry happens even when the background worker dies. Legacy rows still need a snapshot to be due, and still use the legacy tiers. | SQL A25: v2 missed call, unreadable contact, number owner B, no attempt ⇒ empty snapshot, owed work recorded, convergence and both sweeps notify NOBODY and never stamp delivery; the evidence then resolves to assigned agent A ⇒ the sweep alone snapshots `[A]` and creates exactly one labelled alert, none for B, the group or the admins; repeats create no duplicates; a genuine legacy call is untouched by the retry. A25b: an established-unassigned caller still resolves to the approved group; an organization with no group resolves nobody and keeps the work owed. vitest `inboundFailureNotification` (9) through the real wiring and shared helper: the unresolved v2 row converges and upserts nothing, a later attempt on the same committed row does the same, and a genuine legacy row still alerts B. Base `bbf8a8a`, same scenarios: the helper inserted a missed-call notification for B and never called convergence; in SQL the row kept 0 recipients with no marker, both sweeps processed 0 rows, and the recipient stayed unresolved forever even after the evidence arrived. |

**Rollback compatibility.** M7's convergence and notification sweep already depend on M6 columns (`missed_recipient_ids`, `missed_notify_*`), so reading `calls.routing_engine` there adds no new rollback constraint; the documented order (M7 before M6) is unchanged. No migration adds or alters an RLS object.

**Release sequence** unchanged: M4 → M7 → `twilio-voice-status` → `twilio-recording-status` → `recording-retention-purge` → `twilio-voice-inbound` → frontend → per-organization prerequisites → `v2` for one organization → live checks (§18), each step separately approved.

## 0i. Rev 11 — bounded corrective pass (one finding, from `dc0e47e`)

Authorization, D1–D13, P1–P17 and the exact §7.7 RLS scope unchanged; no schema change, no RLS object; development-only; nothing merged, deployed, applied to a hosted database, activated, changed at Twilio, called live, or written to production rows. The pass-7 unresolved-recipient correction is preserved unchanged. The ≈20 s browser ring is untouched.

**Finding — "schema absent" was inferred from an ambiguous API error.** `isSchemaAbsentError` classified PostgREST's `PGRST202` (and, independently, the message "Could not find the function …") as schema absence; `recordInboundEngineDecision` propagated that classification and `runInboundStartRequest` treated it as proof that all of M6 was gone, then routed legacy. PostgREST documents `PGRST202` as an answer from ITS schema cache, which can be stale while the database function exists, and one unreachable RPC establishes nothing about sibling tables, columns or the decisions already saved in them. A call already decided `v2` therefore routed LEGACY, under either organization flag, after a single attempt and without the failure path.

**Correction — evidence is what PostgreSQL says; the cache's opinion is metadata.**

| Layer | Behaviour |
|---|---|
| `isDatabaseObjectAbsentError` (new) | ONLY PostgreSQL's own codes `42703` / `42P01` / `42883`, by code, with no message matching. The statement reached the database and the database rejected it, so the absence is a fact about the database at that moment. Deterministic: not retried. |
| `isSchemaCacheError` (new) | `PGRST202` / `PGRST204` / `PGRST205` and the "… in the schema cache" messages. Ambiguous metadata: retried inside the existing budget like any transient failure, reported as a plain failure if it persists, never an established schema state. `withRetries` also reports `schemaCache` for diagnosis. |
| `readPersistedEngineDecision` (new) | When the decision RPC cannot answer, the decision is read DIRECTLY from `calls.routing_engine` for this call: `decided` (route with it — it is durable, so the recovery-ownership contract the planner enforces is already satisfied), `undecided`, `column_absent` (PostgreSQL rejected that column) or `unavailable`. |
| `runInboundStartRequest` | decided ⇒ route that engine; `column_absent` ⇒ legacy, the ONE positively established compatibility state, proven against the exact object claimed; anything else, including every cache answer and a missing row reader ⇒ `engine_decision_unavailable` before either engine performs routing work. (Rev 11 also allowed `undecided` + a legacy flag to proceed; §0j removed that — a NULL read reserves nothing.) |

The absolute deadline, the failure reserve, first-decision-wins and the rejection of late routing results are unchanged: the row read is one more bounded boundary read on the failure branch only, clipped like every other by the deadline minus the failure reserve.

**Evidence.** *Injected-API tests* (`inboundEngineDecision`, 30; `inboundSettingsBoundary`, 23) drive the REAL chain — scripted PostgREST answers through `withRetries` → `recordInboundEngineDecision` → `readPersistedEngineDecision` → `runInboundStartRequest`; no test injects a `schemaAbsent` classification any more. Saved v2 decision + `PGRST202` + either organization flag ⇒ routes **v2**; the same through the message-only regex path; both with the row read also unavailable ⇒ `engine_decision_unavailable`, no owner lookup, no routing TwiML; a persisted `legacy` decision still beats a `v2` flag; a cache miss that clears on retry resolves normally. *Isolated-database test*: after the real M6 rollback script, PostgreSQL answers `42703 column "routing_engine" does not exist` for exactly the object the handler probes (and `42883` for the RPC) — so the retained legacy-compatibility path recognises the actual rollback state and only that. *Base `dc0e47e`*: 15 of these fail; the start sequence routes legacy on the cache error under both flags and proceeds instead of answering on the unresolved ones. *Unexecuted (hosted)*: the behaviour of a genuinely stale PostgREST cache on the hosted project, and every live check in §18.

**Observation (fixed in §0j):** the M7 rollback script's pg_cron guard evaluated `cron.job` in the same expression that tests for the extension, so it failed on a stack without pg_cron.

## 0j. Rev 12 — bounded corrective pass (two findings, from `e4fefef`)

Authorization, D1–D13, P1–P17 and the exact §7.7 RLS scope unchanged; no schema change and no RLS object; development-only; nothing merged, deployed, applied to a hosted database, activated, changed at Twilio, called live, or written to production rows. The pass-8 saved-decision fallback and the pass-7 unresolved-recipient correction are preserved. The ≈20 s browser ring is untouched.

| # | Finding | Correction | Proof |
|---|---|---|---|
| 1 | The fallback row read let `undecided` proceed on a legacy organization flag without persisting anything. A successful read establishes only that the decision was NULL **at that instant**; it reserves nothing. So the same call could route legacy on one delivery and v2 on the next (the RPC records `v2` once the cache recovers), and a delivery overlapping this one could already have committed `v2` between the read and the routing. | An undecided row now FAILS CLOSED under **either** organization flag: `engine_decision_unavailable`, before either engine performs routing work. `record_inbound_engine_decision` — atomic, first-decision-wins, under the call's row lock — remains the only writer of a decision; nothing else may reserve one. Routing from an explicitly saved `legacy` or `v2` value is unchanged, and so is the separately established column-absence compatibility case. Deadline, failure reserve and late-result protections unchanged. | vitest `inboundEngineDecision` (33) through the real chain, now with a shared decision cell whose only writer is the real RPC: an undecided row fails closed under both flags; REPEATED DELIVERY — delivery 1 (legacy flag, `PGRST202`, NULL row) routes nothing and records nothing, then delivery 2 after activation records and routes `v2`; OVERLAPPING DELIVERY — a NULL snapshot while another delivery commits `v2` answers `engine_decision_unavailable`; and no NULL read ever writes a decision. Base `e4fefef`: those three fail (`expected 'proceed' to be 'respond'`), the other 30 controls pass. |
| 2 | The M7 rollback's pg_cron guard tested the extension and queried `cron.job` in ONE expression. PL/pgSQL prepares an SQL expression when execution reaches it, so on a stack without pg_cron the expression still parsed `cron.job` and the whole rollback aborted with `relation "cron.job" does not exist` — the complete rollback sequence could not be run at all. | The extension test is its own outer condition, with every `cron.job` / `cron.unschedule` reference nested inside it (the shape the forward M7 migration already uses); the absent-extension branch raises a notice instead. Only the two jobs M7 created are unscheduled, so unrelated jobs are untouched. | New `scripts/run_inbound_rollback_test.sh`, run as part of the SQL gate on its own throwaway database: applies the harness + M1–M3 + M4–M7 on a stack **without** pg_cron, satisfies each documented prerequisite (zero stored voicemails; M7 rolled back before M6), runs the REAL rollback scripts in order, and checks what each leaves — `voicemails` and the convergence function gone, `calls.voicemail_id` gone, `inbound_route_attempts` gone, the retained D13 finalize still running, and PostgreSQL answering `42703` for `calls.routing_engine` and `42883` for the decision RPC (exactly the probes the handler makes). It then REAPPLIES M6 + M7 and re-checks, so a development stack that ran the proof stays usable. Base `e4fefef`: the M7 rollback aborts on `relation "cron.job" does not exist` before anything else runs. |

**Not executed:** pg_cron is not installable on this stack, so extension-PRESENT rollback behaviour (jobs absent, jobs present, unrelated jobs preserved) is unproven and needs a stack with pg_cron. Everything in §18 remains unproven until the live checks run.

**Release sequence** unchanged: M4 → M7 → `twilio-voice-status` → `twilio-recording-status` → `recording-retention-purge` → `twilio-voice-inbound` → frontend → per-organization prerequisites → `v2` for one organization → live checks (§18), each step separately approved.

## 0k. Rev 14 — bounded corrective pass (two findings, from `b9cca2c`)

Development-only; D1–D13, P1–P17 and the exact §7.7 RLS scope unchanged — **no policy, grant or RLS setting is added or modified**; nothing merged, deployed, applied to a hosted database, activated, changed at Twilio or called live.

| # | Finding | Correction | Proof |
|---|---|---|---|
| 1 | M4's `public.is_phone_connected(uuid)` was `SECURITY DEFINER` with EXECUTE granted to `authenticated`, and filtered only on agent id, `registered` and freshness. Its owner is `postgres`, which owns `agent_phone_registrations` and carries `BYPASSRLS` (both confirmed read-only in production), so the table's org-scoped SELECT policies did not apply inside it: an authenticated caller in one organization could read another organization's connection status. R4 tested the cross-organization TABLE read but called the function after `RESET ROLE`, so the leak survived it. | The predicate is now **`SECURITY INVOKER`**. `authenticated` already holds `GRANT SELECT` on the table, so it sees exactly the rows the two org-scoped policies allow; `service_role` (Edge routing) keeps `BYPASSRLS`; the M6 planners are definer-owned by `postgres`, so the organization's registrations stay visible inside them; `anon` keeps no EXECUTE. Nothing else changes. | SQL **R7** (isolation, every function assertion made while `SET LOCAL ROLE authenticated` is still active), **R8** (the M6 owner and group planners still ring connected agents through the predicate), **R9** (shipped `prosecdef`, ACLs, RLS state, exactly two org-scoped SELECT policies and no write policy). Base `b9cca2c`: R7 fails — "org B must not learn org A connection status through the function"; a direct probe there shows org B reading **0 table rows** while the function returns **true**, against **false** on the corrected tree. The rollback proof now covers **M7→M6→M5→M4→reapply M4–M7** and re-checks the security attribute and policy expressions after reapply. |
| 2 | `RELEASE_READINESS.md` offered `supabase db push` as an alternative for a one-file approval; it applies every pending migration, which on this branch is M4–M7. The document also promised the authored filename timestamp would become the recorded version, which the MCP `apply_migration` surface (`project_id`, `name`, `query` — no version argument) cannot guarantee, and it stated the GitHub-integration prerequisite two different ways. | `RELEASE_READINESS.md` §2.0 fixes one procedure that submits **only** the reviewed M4 SQL (`psql --single-transaction -f <file>`, then `supabase migration repair --status applied 20260914000530`), identifies the file by SHA-256, and documents the MCP alternative with an explicit reconciliation: read the recorded version, and if it differs, rename the repository file to it — never hand-write a history row. §2.1 states the dependency once: the integration setting gates **merging**, not the direct M4 apply, and it **remains unverified** because the dashboard needs an interactive sign-in. §2.2 adds post-apply verification of policy **expressions**, grants and function security rather than counts. | The M4 hash is recorded in the document header; the production migration history shows both version shapes that motivate the reconciliation rule. |

## 0l. Rev 15 — bounded corrective pass (two findings, from `db3caf2`)

Development-only; D1–D13, P1–P17, the pass-10 organization-isolation correction and the exact §7.7 RLS scope unchanged — **no policy is added, removed or rewritten, and no production default privilege or existing table's permissions are touched**; nothing merged, deployed, applied to a hosted database, activated, changed at Twilio or called live.

| # | Finding | Correction | Proof |
|---|---|---|---|
| 1 | This project's `ALTER DEFAULT PRIVILEGES` give every table created by `postgres` in `public` the full `arwdDxtm` set to `anon`, `authenticated` **and** `service_role` (verified read-only: `pg_default_acl`, grantor `postgres`, schema `public`, objtype `r`). M4 revoked from `PUBLIC` and `anon` but never reset `authenticated`, and a `GRANT` only ADDS — so `agent_inbound_settings` and `agent_phone_registrations` shipped with `authenticated` holding DELETE, **TRUNCATE**, REFERENCES, TRIGGER and MAINTAIN. TRUNCATE is not restrained by row-level security. **M7's `voicemails` carried the identical defect**, which additionally defeated its column-scoped `GRANT UPDATE (listened_at)`. (M6 already reset `authenticated`; M5 creates no table.) | M4 and M7 now `REVOKE ALL` from `PUBLIC`, `anon`, `authenticated` and `service_role` **before** granting, then grant exactly the stated contract: `agent_inbound_settings` → authenticated SELECT, INSERT, UPDATE; `agent_phone_registrations` → authenticated SELECT; `voicemails` → authenticated SELECT plus `UPDATE (listened_at)`; `service_role` → ALL; `anon` → nothing. RLS, every policy and all function permissions are unchanged. | The v2 test harness now reproduces the production default privileges **before** M4–M7 create their tables, so a missing REVOKE is visible. New SQL **R10** asserts effective privileges for allowed *and* forbidden operations (including TRUNCATE, REFERENCES, TRIGGER) for all three roles across all four tables, plus the column-scoped voicemail UPDATE; **R11** proves TRUNCATE and DELETE are refused at execution time, not merely absent from a listing. The rollback proof re-checks the exact privileges before rollback and after **M7→M6→M5→M4→reapply M4–M7**. Base `db3caf2`: `authenticated` holds DELETE, TRUNCATE, REFERENCES and TRIGGER on all three tables and R10 fails on the first assertion. |
| 2 | The documented `supabase migration repair --status applied … --project-ref …` is not a supported command: verified against the pinned CLI 2.84.5, `migration repair` takes `--db-url`, `--linked`, `--local`, `--password`, `--status` and has **no** `--project-ref`. The procedure was also prose rather than something that could fail safely. | `scripts/apply_m4_only.sh` implements it: hash gate before anything is touched; tool and `--db-url` support checked; a read-only fingerprint proving the connection is project `jncvvsvckxhqgqvkppmj` without printing any credential; `psql --single-transaction -v ON_ERROR_STOP=1` for M4 alone; the history repair on the **same** `--db-url` connection and only after a successful apply; and, if the repair fails after a successful apply, a hard stop with the read-only inspection and the single reconciling command — never a re-run of the SQL, never a continuation to M5. `scripts/verify_m4_applied.sql` verifies schema, policy **expressions**, effective privileges, function security attributes and the recorded version. The MCP alternative is spelled out concretely, including reading the actually recorded version and renaming the repository file if it differs. | Guard rails exercised locally with no production contact: a missing connection string stops at step 0; a one-byte change to the migration stops at step 1 with both hashes shown; a connection that is not the target project stops at step 3. `verify_m4_applied.sql` was executed against an isolated M1–M7 database. |

**Still unverified:** the Supabase "Deploy to production" integration setting (it gates merging, not this apply), the extension-present rollback test, and every live check in §18.

## 0m. Rev 16 — bounded corrective pass (four release-tooling findings, from `3b4d1d5`)

Release tooling and documentation only. **No migration SQL changed** — M4's hash is still `fe846c43a91e9aaf81e112edcf0cfb320414047e0e15de149f75160232fe8e29` — and D1–D13, P1–P17, the pass-10 organization-isolation correction, the pass-11 privilege reset and the exact §7.7 RLS scope are unchanged. Nothing merged, deployed, applied to a hosted database, activated, changed at Twilio or called live; production was touched only by read-only `execute_sql`.

| # | Finding | Correction | Proof |
|---|---|---|---|
| 1 | The apply script "proved" its target by counting `cron.job` rows whose command contains `jncvvsvckxhqgqvkppmj`. Row content is not identity: any database can hold that text, and the exact script passed preflight against a **different project's** connection with matching simulated cron and history results. | The **MCP procedure is now the primary path** (`RELEASE_READINESS.md` §2.0 P1): `apply_migration` takes `project_id` as an argument, so the target is named in the request and cannot be inferred wrongly. It is also the only apply channel this session has. The retained direct script (P2) now derives the project ref from the **connection string itself** — the Supabase-issued hostname `db.<ref>.supabase.co` or the pooler username `postgres.<ref>` — and refuses to write unless it equals the expected ref; a bare IP, a lookalike domain or a ref-less pooler host is rejected as **AMBIGUOUS**. It then corroborates against independently verified project facts (PostgreSQL major 17, history head `20260823222926`). The cron count is still printed but labelled *supporting evidence, not proof of identity*. No credential or URL is printed on any path. | `scripts/test_release_tooling.sh` `[fake-tool]`: a wrong ref is refused as WRONG TARGET; a bare IP, a lookalike domain and a ref-less pooler host are each refused as AMBIGUOUS; **matching cron and history content does not rescue a wrong target**; the intended direct and pooler connections pass; a wrong PostgreSQL major and a moved history head are refused; the refusals contain no credential. |
| 2 | `verify_m4_applied.sql` only printed catalog rows, so the procedure declared "M4 APPLIED AND VERIFIED" whenever the statements *executed*. A local database with RLS disabled, `authenticated` granted TRUNCATE and no history row passed it. | That file is **deleted**. `scripts/verify_m4_schema.sql` and `scripts/verify_m4_history.sql` are machine-checked, read-only assertions that accumulate every problem and `RAISE EXCEPTION`; the success rows `M4_SCHEMA_CONTRACT_VERIFIED` / `M4_HISTORY_VERIFIED` are unreachable unless every assertion passed. Coverage: object existence, RLS enabled and not forced, owner, the **exact** privilege matrix over SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER **and MAINTAIN on PostgreSQL 17**, every policy's name/command/roles/expression, function identity, security attribute, volatility and EXECUTE permissions, and the exact expected history entry. Schema and history are **separate files** because recovery from a failed repair leaves a correct schema with a missing history row. `scripts/verify_m4_untouched.sql` compares the pre-existing tables before and after instead of hard-coding one environment's counts. | `[real-postgres]`: seventeen mutations — including the three the reviewer reported (RLS disabled, `authenticated` TRUNCATE, missing history row) — each **fail** the verifier, each for the right reason; the correct database verifies. History: a missing row fails, the exact entry verifies, an M5 row fails the M4-only contract, a wrongly named row fails. 56 cases pass in total. A latent defect found while proving this: `text[] \|\| 'literal'` resolves to array-array concatenation, so a failure message containing punctuation aborted with *malformed array literal*; every append is now `array_append`. |
| 3 | The verification file contained `\echo`, a psql client meta-command that `execute_sql` does not accept — so the documented MCP path could not actually verify anything. | All four payloads are plain SQL with no meta-commands, and the same bytes run under `psql -f` and through `execute_sql`. The one value that differs between procedures — the service-assigned history version — is passed as a GUC (`SET m4.expected_version = …`) rather than by editing the file. Optional human-readable formatting stays out of them. | Executed read-only against `jncvvsvckxhqgqvkppmj` on 2026-09-12: the state classifier returned `NEITHER … history_head 20260823222926`; the untouched payload returned its five rows; a DO-block verifier of this shape returned the MCP **error** `M4 SCHEMA CONTRACT FAILED (2 problem(s)): MISSING TABLE …` (correct while M4 is unapplied, and proof a mismatch is an error rather than a printed row); a probe of every remaining construct returned `CONSTRUCT_PROBE_OK \| 17.6 \| maintain_checked = true`; and `SET …;` followed by further statements in one payload was accepted. The hosted isolation read stays labelled **inconclusive** while the table is empty — no production row is seeded — and isolation continues to rest on R7/R9/R10 on a disposable database. |
| 4 | Every failed `psql` invocation was described as a confirmed rollback, and a failed history-repair response was treated as proof its write had not landed. A dropped connection can follow a successful commit. | Neither path claims a rollback. Any non-zero exit from the apply or the repair now runs `scripts/verify_m4_state.sql` read-only and branches on what is actually there: `NEITHER` (nothing landed — diagnose, then re-run the one operation), `SCHEMA_ONLY` (reconcile the **history alone**, never replay the SQL), `BOTH` (the write landed despite the failed response — verify and stop), `PARTIAL` (investigate; write nothing). If the reconciliation query itself fails, the state is reported **UNKNOWN** and nothing is suggested. No branch replays SQL automatically, fabricates a history row, switches apply mechanism mid-operation, or continues to M5. | `[fake-tool]`: all four states after a failed apply and after a failed repair reach their own branch; an unreachable reconciliation exits 2 with UNKNOWN; no output claims a rollback; the BOTH branch never tells the operator to re-run; every branch forbids continuing to M5; and a failing verifier suppresses the success line. |

**Still unverified:** the Supabase "Deploy to production" integration setting (it gates merging, not this apply), the extension-present rollback test, and every live check in §18. **Alexa's incident remains unverified until controlled live testing confirms audible ringing and correct routing.**

## 0n. Rev 17 — bounded corrective pass (three verification findings, from `0913130`, plus twelve from its adversarial review)

Recovery, verification, their tests and documentation only. **No migration SQL changed** — M4's hash is still `fe846c43a91e9aaf81e112edcf0cfb320414047e0e15de149f75160232fe8e29` and `git diff 0913130 -- supabase/` is empty — and D1–D13, P1–P17, the pass-10 organization-isolation correction, the pass-11 privilege reset and the exact §7.7 RLS scope are unchanged. Nothing merged, deployed, applied to a hosted database, activated, changed at Twilio or called live; production was touched only by read-only `execute_sql`.

| # | Finding | Correction | Proof |
|---|---|---|---|
| 1 | The state classifier counted history rows only where `version = '20260914000530'`. MCP `apply_migration` records a **service-assigned** version, so a perfectly good MCP apply would have classified as `SCHEMA_ONLY` and the procedure would have recommended a history repair for a row that was already there. `verify_m4_history.sql` was loose in the opposite direction: it accepted a NULL name and a `LIKE '%…%'` substring match, and its trailing `SELECT` re-derived the version by hard-coded value rather than from the matching row. | M4 is now resolved by its **migration identity**: `name = 'inbound_agent_settings_and_registrations'` exactly, or the authored version (what the CLI's `migration repair` writes). Every match is returned explicitly in `m4_history_versions`, alongside `m4_rows_by_name`, `m4_rows_by_version` and `m4_version_name_conflicts`. **Duplicates, conflicting identities and incomplete object sets are `PARTIAL`** — an unexpected state to investigate, never a clean one. The history verifier requires the exact name, rejects a NULL name and any near-miss substring, **resolves the recorded version from that row** (pinning via `m4.expected_version` is now optional rather than an edit), and rejects M5–M7 by version **or** by name. | `[real-postgres]`: a service-assigned version now classifies `BOTH` and verifies; the authored version still does; a NULL name, a duplicate pair, a conflicting identity, a near-miss name and an M5 row recorded under its own name each fail, each for the stated reason; incomplete objects classify `PARTIAL`. The pinned CLI's `migration repair` was **run** on a disposable database and shown to record exactly that name, so the direct path satisfies the same contract. |
| 2 | The procedure treated `NEITHER` after an uncertain outcome as "nothing landed" and invited another apply under the same approval. Under PostgreSQL's default READ COMMITTED isolation a catalog read sees only what committed before it began, so an apply **still running** in another session is invisible — and commits afterwards. Replaying in that window applies M4 twice. | The classifier now takes a `m4.mode` GUC (`preflight` / `recovery`, **defaulting to the conservative `recovery`**) and returns `next_action`. In recovery, `NEITHER` yields `OUTCOME_UNRESOLVED_DO_NOT_REPLAY` and the reading states plainly that it means only *no committed M4 state was observed at this read*. Replay is permitted only once the original operation is authoritatively known to have ended without committing — a definitive server SQLSTATE, or a provably gone backend with no prepared transaction — and **neither elapsed time nor repeated empty reads count**. Otherwise the outcome is reported UNRESOLVED. The same rule is stated identically in the classifier's comments, the direct script's recovery branch (exit 3) and `RELEASE_READINESS.md` §2.0/§7. `other_open_transactions`, `backends_naming_m4_objects` and `prepared_xacts` are reported as in-flight evidence that can only ever show something **is** running. The analogous hazard for a repeated history repair is called out too. | `[real-postgres]`: an apply is held **uncommitted** in a second session past its DDL; its tables are invisible to another session; the classifier reads `NEITHER / OUTCOME_UNRESOLVED_DO_NOT_REPLAY` and reports the other open transaction; that **exact real reading** is then fed to the real recovery path, which stops with UNRESOLVED and never recommends a replay; after `COMMIT` the tables appear and the classifier moves to `SCHEMA_ONLY / RECONCILE_HISTORY_ONLY`. |
| 3 | The schema verifier claimed to check policy expressions but only searched the **concatenated** `USING`/`WITH CHECK` text for `get_org_id()`. That accepts a widened policy: dropping `agent_id = auth.uid()` from the settings self-insert clause leaves the fragment intact while letting an agent create another agent's row, and concatenation lets one correct clause conceal a wrong one. `verify_m4_untouched.sql` compared only counts, so a swapped privilege or a rewritten policy passed. | Each of M4's six policies is now compared as a **complete definition** — target table, command, roles (PUBLIC included), permissiveness, and `USING` and `WITH CHECK` **separately** — against the reviewed migration's text, and a seventh policy is rejected. Both sides are canonicalised identically (whitespace collapsed, the optional `public.` qualification removed); nothing else is stripped, so a function in another schema still fails. `verify_m4_untouched.sql` now captures each policy's full definition in a stable order plus every table- and column-level privilege as `grantee:PRIVILEGE` pairs from the catalog ACL, with an md5 of each set. | `[real-postgres]`: **eight** mutations that all keep `get_org_id()` — self-insert losing `agent_id = auth.uid()`, self-update's `USING` widened to `true` with `WITH CHECK` left correct, registrations self-select widened to the organization, admin-select dropping the role test, roles widened to PUBLIC, PERMISSIVE turned RESTRICTIVE, a seventh org-scoped policy, and `get_org_id()` swapped for a same-named function in another schema — each fail, each naming the expected and actual definition. A swapped privilege, a rewritten expression and a RESTRICTIVE flip are each caught **with all counts equal**, and an unchanged database reproduces its before-image exactly. Read-only on the target's **PostgreSQL 17.6**: the verifier's exact comparison run against two pre-existing production policies returned `POLICY_CANONICALISATION_MATCHES_ON_PG17`, so the expected strings match what the hosted server deparses, not only what PostgreSQL 16 does. |

| 4 | An adversarial review of findings 1–3 (five independent reviewers, every finding then put to an independent verifier told to refute it: **37 raised, 25 refuted, 12 confirmed**) exposed twelve further defects. Three could have released a broken schema under a green verification: a **hostile `search_path`** defeated the policy comparison entirely, because `pg_get_expr` qualifies by session path and the normalisation deleted every `public.` prefix — under `SET search_path = evil, public`, a policy calling `evil.get_org_id()` deparsed as `get_org_id()` and verified clean; the **guard trigger and all three function bodies** were unverified, so a disabled trigger, a `BEFORE INSERT`-only trigger, a `RETURN NEW` guard body or a removed `SET search_path` pin all passed; and **object completeness counted `pg_proc` rows over a two-name `IN` list**, so two overloads of one name and none of the other read as complete — which maps to `SCHEMA_ONLY`, the one recovery branch that authorises a write. | The verifier pins `search_path` to `pg_catalog` transaction-locally inside its own `DO` block, compares fully qualified expected strings and normalises nothing but whitespace; it pins `tgenabled`, `tgtype` and `tgfoid` for the trigger and `md5(prosrc)`, `prosecdef`, `provolatile` and `proconfig` for each of the three functions; and every object is required in its own right. Also: `m5_m7_rows` is now a scope violation in both modes; the self-exclusion marker moved **inside** the statement (psql discards comments preceding the first token); the `SCHEMA_ONLY` branch states the real hazard instead of an impossible duplicate row (`version` is the PRIMARY KEY of `supabase_migrations.schema_migrations`); a missing function is reported in the contract list rather than aborting with a raw error; the M5 prohibition is asserted per branch and rejects an affirmative mention; the post-apply block — which an earlier edit had left with **no test at all** — is exercised again, including a CHANGED after-image; and the cleanup trap is installed before the first `CREATE DATABASE`. | `[real-postgres]`: a correct database still verifies under `SET search_path = evil, public` while a policy calling `evil.get_org_id()` fails under that same path; eight further mutations covering the trigger, the function bodies and the search_path pins; a compensating object error (two overloads, none of the other) classifies `PARTIAL`; an out-of-scope M5 blocks preflight and recovery alike; the marker is shown to reach `pg_stat_activity` from a held-idle session. Read-only on the target's PostgreSQL 17.6, from a deliberately hostile session path: `PINNED_POLICY_COMPARISON_MATCHES_ON_PG17`. Suite: **116 passed, 0 failed**. |

**Still unverified:** the Supabase "Deploy to production" integration setting (it gates merging, not this apply), the extension-present rollback test, and every live check in §18. **Alexa's incident remains unverified until controlled live testing confirms audible ringing and correct routing.**

## 1. Inspection basis (unchanged; see rev 1/rev 2 and WORK_LOG 2026-09-10)

Live production (read-only) still matches: Edge Functions `inbound-call-claim` v38, `twilio-voice-status` v40, `twilio-voice-inbound` v44, `twilio-recording-status` v34, `repair-twilio-number-ownership` v3; newest migration `20260823222926`; `calls.status` CHECK `ringing|connected|completed|failed|no-answer`; `notifications.type` CHECK lacks `voicemail`; `profiles.availability_status` exists (`Available`/`Offline` only) with a column-scoped UPDATE grant; home org `all-ring` with `voicemail_enabled=false`; `recording_retention_days=7`; `call-recordings` org-wide readable; `voicemail-assets` public; pg_cron and pg_net enabled (existing cron jobs call Edge Functions through `net.http_post` with private secret tables). Tooling: `npx tsc --noEmit` exit 0; app-config baseline **81** errors on `main`; ten focused inbound suites 139/139; `deno` absent; Twilio documentation unreachable from this environment (facts are marked SDK-verified, per Chris's references, or verify live).

## 2. Pinned findings (unchanged; all ten CONFIRMED — see rev 1 §2)

Incident `0bb30fa8…` (2026-09-09 20:31 UTC): five `<Client>` legs ended ≈0.23 s after TwiML with `DialCallStatus=no-answer`, no claim, greeting + hangup. Strong evidence of no registered Device; not proof; attribution unproven.

---

## 3. D13 — "Missed in AgentFlow" is separate from the mobile outcome

### 3.1 Rule (unchanged)
Mark the parent `calls` row missed (`is_missed=true`, `missed_reason='forwarded_to_mobile'`, `missed_for_agent_id=<owner>`, `missed_recipient_ids=[owner]`) **in the same transaction that reserves the mobile stage**, before any mobile TwiML; insert one notification (`event_key=missed_call:<call_id>`) to the intended agent at that point. Never cleared by acceptance, bridging or a connected conversation. Provider `status`/`duration` stay Twilio-authoritative and accurate (`outcome='forwarded_answered'` + `answered_by_agent_id` are recorded alongside). Counted once per parent call; a later voicemail adds only a `voicemail:<call_id>` notification. Label: **"Missed in AgentFlow — forwarded to mobile."**

### 3.2 Writer and reader audit (rev 3 additions in bold)

| Site | Today | Change |
|---|---|---|
| `finalize_inbound_call_terminal` external-answer branch (`20260823222805:225-238`) | retracts `is_missed=false` | M6 `CREATE OR REPLACE` removes the retraction; rest verbatim. |
| `markMissedAndNotify` (`twilio-voice-inbound/index.ts:680-724`) | marks + notifies at voicemail/hangup | Becomes a thin caller of the SQL commit (`mark_inbound_missed`, §7.3) which writes `is_missed`, `missed_reason`, `missed_for_agent_id`, **`missed_recipient_ids`**, then notifies via tier 0. |
| `twilio-voice-status` (`index.ts:244, 433` projections; `:478` notify) | selects `…agent_id, is_missed, direction, caller_id_used, routed_agent_ids` and resolves recipients through tiers 1–4 | **Both projections add `missed_for_agent_id, missed_reason, missed_recipient_ids`** so its convergence path resolves through tier 0. Duration/ladder logic untouched. **Deployment dependency:** must be live before any org's `routing_engine='v2'`. |
| `resolveMissedCallRecipientsFromDb` (`notification-recipients.ts:174-373`) | tiers 1–4 | **Tier 0**: if `call.missed_recipient_ids` is non-empty → validate those ids (same org; `status='Active'`); recipients = the valid subset; if none is Active → tier 4 (managers) only; **tiers 1–3 are never consulted when the snapshot is present**. Legacy rows (empty snapshot) keep tiers 1–4. |
| `buildMissedCallNotificationRows` | one body | D13 body/label when `missed_reason='forwarded_to_mobile'`; `metadata.reason`. |
| Readers `MissedCallsWidget.tsx:50-59`, `DashboardDetailModal.tsx:414-418` | `agent_id = userId` for non-admins (never matches a missed row — pre-existing defect) | `.or('agent_id.eq.<uid>,missed_for_agent_id.eq.<uid>,missed_recipient_ids.cs.{<uid>},routed_agent_ids.cs.{<uid>}')` with UUID validation before interpolation. |
| Contact history items | no missed label | `describeInboundCallOutcome(row)` helper (`src/lib/inbound-call-labels.ts`). |
| `record_inbound_mobile_accept` / `record_inbound_mobile_bridge` | (rev 1 cleared `is_missed`) | Neither touches `is_missed`; SQL-tested. |
| `handle_call_workflow_events` / `trg_workflow_call_created` (`baseline:10251`, AFTER INSERT only) | — | **Documented limitation kept as is:** a D13 `UPDATE` dispatches no workflow event; no automation redesign in this plan. |
| RLS Phase 1 `calls` policies | — | Unchanged; all writes are service-role RPCs. |

**Scenario that must hold (tested in SQL and live): offline contact owner A, dialed-number owner B, no browser targets.** `plan_inbound_route` creates the attempt in `owner_mobile`, writes `missed_recipient_ids=[A]`, and the handler inserts `missed_call:<call_id>` for A. Later the parent `completed` callback reaches `twilio-voice-status`; it sees durable `is_missed`, calls the shared helper, tier 0 returns `[A]`, the upsert is a no-op. B never appears in any tier because tiers 1–4 are skipped. If the first insert failed, the sweep or the next handler inserts for A (still tier 0). If the lead is reassigned to C afterward, the snapshot still says A. Only if A is no longer Active does the notification go to org Admins.

### 3.3 Invariant #30 wording change (narrow, unchanged from rev 2)
`is_missed` is monotonic once written by an accepted guarded writer; the mobile forward marks it at the forward commit with `missed_reason`, `missed_for_agent_id` and `missed_recipient_ids`; the external answer proof and `answered_by_agent_id` are recorded alongside and never retract it; the finalize RPC's retraction is removed by M6. Ownership, signatures, tenant scoping, terminal freezing untouched. No backfill.

### 3.4 Durable recovery of notifications (gap 3; safeguard 2 as implemented)
- **State:** `calls.missed_notified_at` and `voicemails.notified_at` (NULL = owed), plus per-record `*_notify_attempts`, `*_notify_next_at`, `*_notify_error`. No other pending flags exist.
- **One recipient rule, one completion rule:** `public.converge_inbound_notifications(p_call_row_id)` (M7). Missed-call recipients = `private.resolve_snapshot_recipients(org, missed_recipient_ids)` — the snapshot's Active same-org members, else the organization's Active Admins. Voicemail recipients = the recipient agent, or the snapshot group ∪ the currently configured group, resolved the same way. Rows: `type='missed_call'` / `'voicemail'`, `event_key='missed_call:<call_id>'` / `'voicemail:<voicemail_id>'`, D13 body from `private.missed_call_label(missed_reason)`, `ON CONFLICT (user_id, event_key) DO NOTHING`. **Completion** is stamped only when a row exists for EVERY required recipient; otherwise attempts+1 and `next_at = now() + min(6 h, 2^attempts min)`.
- **Owners of the retry:** (a) the handler that created the obligation converges in-request (bounded); (b) every later handler for the same call converges again — `<Dial action>` stage returns, `voicemail_done`, the recording callback, and **the parent status callback in `twilio-voice-status`** (its `calls` projections carry `missed_for_agent_id, missed_reason, missed_recipient_ids`; snapshot rows are routed to the RPC by `insertMissedCallNotifications`, never to TypeScript tiers 1–4; an RPC error is a retryable 503 there, an incomplete result is sweep-owned 200); (c) `public.sweep_inbound_notifications(100)` via pg_cron `inbound-notify-sweep` every 2 minutes, selecting due records (`next_at` reached, attempts < 50), each converged inside its own subtransaction so one failure never blocks the others. **There is no automatic age-based abandonment**; records that exhaust 50 attempts stay owed and are counted in the sweep result (`exhausted_missed`) for operators. The cron job is scheduled last (M7), only if pg_cron is installed, after every table and function it needs exists. No backfill.
- **D13 mark is never pending:** it is written inside the reservation transaction; if that transaction fails the handler does not forward (§8.3).
- **Voicemail:** media and metadata are stored first (`status='stored'`), the Twilio source is deleted (its failure is a durable retryable state — §10), then the notification is converged; a failure leaves `notified_at NULL` and the callback answers 200 (sweep-owned). A redelivered callback converges again.
- **No attempt row:** recovery never needs one. `voicemails.attempt_id` is a nullable FK written only when the signed `attempt_id` resolves to an existing attempt of the same call; otherwise NULL. Missed-call recovery keys on `calls`.

---

## 4. Design overview (unchanged shape)

```
initial → resolve DID/org → ingest_inbound_call → plan_inbound_route (ONE transaction):
   owner|group · eligibility · reservation · attempt row · (immediate) commit_owner_mobile incl. D13
owner:  DND → owner_voicemail | busy → owner_voicemail | not connected → owner_mobile (D13 committed) |
        owner_browser 20 s → advance_to_owner_mobile (re-check, D13 committed) → owner_mobile → not accepted/not bridged → owner_voicemail
group:  eligible (explicit ≤10) → one wave 20 s → group_voicemail | empty → group_voicemail
after hours: identical (D8). routing_engine='legacy' until the §14 gate flips an org to 'v2'.
```

---

## 5. Decisions and supporting defaults

### 5.1 D1–D13 mapping (as implemented)
| Decision | Where it lives |
|---|---|
| D1 automatic inbound readiness while signed in + Available + connected + not on a call | provider-owned Device (§6.1) + presence generations (§6.2) + `is_phone_connected` / `is_agent_busy` in `plan_inbound_route` |
| D2 contact's assigned agent first | `resolveOwnerCandidate` (direct line > contact owner > none) → `plan_inbound_route(owner)` |
| D3 offline / unanswered → agent's mobile | immediate `owner_mobile` in `plan_inbound_route` when not connected; `advance_to_owner_mobile` after the browser ring; both through `commit_owner_mobile` |
| D4 20-second browser ring | `browser_ring_seconds` DEFAULT 20 → `<Dial timeout>`; measured per §8.2 (P17) |
| D5 admin-selected group for unassigned callers | `inbound_group_agent_ids` (1–10, validated) → group mode |
| D6 mobile unanswered → agent's AgentFlow voicemail | `owner_mobile` return not bridged ⇒ `owner_voicemail`, mailbox `agent:<owner>` in the signed recording URL |
| D7 busy → straight to that agent's voicemail | `is_agent_busy` ⇒ `owner_voicemail` with `missed_reason='busy'` |
| D8 after hours: same routing | v2 initial path skips the business-hours branch for routing (the after-hours SMS is still sent) |
| D9 ringtone on default speakers AND headset | `applyRingtoneOutputs` on every `registered` (all outputs by default) |
| D10 ring all Available/connected/non-busy group members simultaneously | one `group_browser` wave of the eligible members (≤ 10 `<Client>` nouns) |
| D11 On Break / DND bypass browser AND mobile → voicemail | `plan_inbound_route` and `commit_owner_mobile` refuse on `availability_status IN ('On Break','Do Not Disturb')` |
| D12 mobile conversations never recorded; details saved | `buildMobileForwardTwiml` has no `record` attribute; accept/bridge/leg-end evidence on the attempt |
| D13 every mobile forward counts once as "Missed in AgentFlow — forwarded to mobile" | `commit_owner_mobile` (in-transaction mark, never cleared), `finalize` retraction removed (M6), readers §3.2 |

### 5.2 Supporting defaults (explicit approval needed)
P1 direct-line precedence · P2 explicit group of 1–10 (validated server-side, §7.2) · P3 shared-mailbox membership/history access · P4 ineligible owner ⇒ group · P5 mobile ring 20 s · P6 Press 1 only · P7 mobile caller ID unset · P8 busy ceilings (ringing reservations 5 min; accepted mobile until leg-end/Dial-action, cap 4 h; `calls` rows 4 h) · P9 presence 3 min / 45 s · P10 retire legacy routing knobs under v2 · P11 retire per-number overrides except `is_direct_line` · P12 `answered_by_agent_id` · P13 voicemail retention: separate `voicemail_retention_days` DEFAULT 30 + 90-day unheard cap (reusing the 7-day recording setting would purge unheard voicemail) · P14 availability CHECK · P15 `routing_engine` cutover flag · P16 ten-target posture (Conference/TaskRouter are separate designs) · **P17 (decided 2026-09-10): measurement-based calibration toward ≈ 20 s — `browser_ring_seconds` DEFAULT 20 is the provider setting, observed browser/server timings are recorded per call (§8.2), the requirement is not redefined as "at least 20 s", no exact timing is promised, and no browser-side cancellation mechanism exists.** All of P1–P16 approved 2026-09-10.

---

## 6. Change set A — Browser

### 6.1 Device lifetime (as implemented)
The Twilio Device is PROVIDER-OWNED: `FloatingDialer` close and `DialerPage` session end no longer call `destroyClient`; the only teardown triggers are identity loss (`authUserId` changes/clears ⇒ `destroyClient()` + presence reset) and the provider's own re-initialisation. `destroyTwilioDevice` exposes a `destroying` promise that `initTwilioDevice` awaits, so a fresh registration can never race an unregistering Device. Readiness truth: `unregistered` clears `twilioVoiceReadyRef` and drops a `ready` status to `connecting`; `makeCall` and the network-online recovery consult the ref, not React state. Recovery is bounded (3 attempts per 60 s, 2 s settle) and runs ONLY while `callStateRef === 'idle'` and not dialing. `IncomingCallModal.tsx` is deleted (the floating dialer is the ring surface). Source contracts: vitest `inboundDeviceLifetime`.

### 6.2 Presence with registration generations (gap 4)
- **Identity of a registration is minted in memory**, never persisted: on every Device `registered` event the provider creates `registration_id = crypto.randomUUID()` and resets `seq = 0`. A duplicated tab (which copies `sessionStorage` from its opener) starts its own Device and therefore its own `registration_id`; a reload does the same; the previous registration's row simply expires or is closed by its own unregister write.
- **Every write carries `(registration_id, seq)`** with `seq` incremented before each send (heartbeat, state change, unregister). `heartbeat_phone_registration` upserts **only the caller's own `(auth.uid(), registration_id)` row** and applies the write only when `p_seq > stored seq`; otherwise it returns `{applied:false, reason:'stale_seq'}` and changes nothing. Consequences: a delayed `pagehide` unregister for an old registration cannot touch the new registration (different id); a reordered older heartbeat for the same registration cannot re-open a closed one (lower `seq`); two tabs can never overwrite each other (different ids).
- **Cadence:** heartbeat every 45 s while registered; immediate writes on `registered`/`unregistered`/`error`, on `visibilitychange`→visible and `online`. Hidden-tab timer throttling (≥1/min) still lands ≥2 beats inside the 3-minute freshness window.
- **Logout:** `AuthContext.logout()` issues a `keepalive` fetch to the RPC (`p_registered=false`, current id, next seq) **before** awaiting `signOut()`; `pagehide`/`beforeunload` do the same for the current registration. Other tabs of the same user receive `SIGNED_OUT` and unregister their own registrations; any that fail expire within 3 minutes.
- **Identity change in one tab:** the provider's identity-loss teardown unregisters the old identity's registration (its own id/seq); the new identity mints a new registration on `registered`.
- **Protections preserved:** nothing in the presence path reads or writes `availability_status`; the presence heartbeat never triggers Device re-init; recovery (§6.1) is skipped while `callStateRef.current !== 'idle'` or `isDialingRef.current`.
- Server view: `is_phone_connected(agent_id)` = `EXISTS (registration WHERE registered AND last_seen_at ≥ now() - interval '3 minutes')`. Rows older than 24 h are deleted for the caller's own agent inside the RPC.

### 6.3 Availability (as implemented)
`AgentStatusContext` exposes the three MANUAL states (`Available`, `On Break`, `Do Not Disturb`) persisted on the REAL operator's `profiles.availability_status` via `updateProfile` (invariant #31), and derives `On a Call` (Twilio call state) and `Offline (phone disconnected)` (Device not ready) without ever writing them. The picker lives in the top-bar user menu and is hidden under "View As"; `ProfileInfoCard` no longer carries an availability select (its save would have overwritten the top-bar value with a stale copy); `AgentModal` shows another agent's stored value read-only. Persistence across reload comes from `realProfile`. Server semantics: `On Break`/`Do Not Disturb` ⇒ voicemail (D11, refused by `commit_owner_mobile` too); `Offline` ⇒ not connected ⇒ mobile (D3).

### 6.4 Ringtone and alerts (as implemented)
The Voice SDK plays the incoming ringtone; `incomingCallAlerts.ts` is notification-only (the Telnyx-era start/stop stubs are removed). D9: on every `registered`, `applyRingtoneOutputs` sets `device.audio.ringtoneDevices` to every available output (speakers AND headset) unless the per-browser preference (`ProfileRingtoneOutputCard`, localStorage) selects specific outputs — an empty intersection (headset unplugged) falls back to all outputs; unsupported browsers (no `setSinkId`) are reported, never silent. `ringtoneDevices.test()` provides a test ring.

### 6.5 Settings and surfaces (as implemented)
Admin: `InboundV2Section` (engine flag via `set_inbound_routing_engine`, explicit group ≤ 10 via `set_inbound_group`, browser/mobile ring seconds, voicemail retention days) mounted at the top of Inbound Routing; the legacy cards stay for `legacy` organizations. Agent (My Profile): `ProfileInboundCard` (mobile number E.164, forward on/off, personal greeting text/URL — self-owned `agent_inbound_settings`), `ProfileRingtoneOutputCard`, `ConnectionDiagnostics` (Device state, presence generation, last write result, ring measurements). Readers: `MissedCallsWidget` and `DashboardDetailModal` scope "my" missed calls by `agent_id | missed_for_agent_id | missed_recipient_ids | routed_agent_ids` (UUID-validated) and show the D13 label + inline `VoicemailPlayer`; the contact timeline (`CallHistoryItem`) shows the label and the voicemail; the dialer history description carries the label; the notification drawer renders `voicemail` rows with an inline player.

---

## 7. Change set B — Database (four new migrations M4–M7; applied files untouched)

### 7.1 M4 `…_inbound_agent_settings_and_registrations.sql`
`agent_inbound_settings` (`agent_id` PK → profiles, `organization_id`, `mobile_forward_number` E.164 CHECK, `mobile_forward_enabled` DEFAULT true, `voicemail_greeting_text` ≤ 500, `voicemail_greeting_url` https ≤ 2048, timestamps; loop-guard trigger refusing a mobile that equals one of the organization's own numbers by last-10 digits; RLS self select/insert/update + same-org Admin select). `agent_phone_registrations` keyed **`(agent_id, registration_id)`** with `seq bigint NOT NULL DEFAULT 0`, `registered`, `registered_at`, `last_seen_at`, `last_state`, `last_detail (≤64)`, timestamps; index `(organization_id, agent_id, registered, last_seen_at)`.
```sql
CREATE FUNCTION public.heartbeat_phone_registration(p_registration_id uuid, p_seq bigint, p_registered boolean, p_state text, p_detail text DEFAULT NULL)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$ … $$;
  -- v_agent := auth.uid(); v_org := get_org_id(); raise 42501 if either is NULL; validate p_state/p_detail;
  -- INSERT … VALUES (v_agent, p_registration_id, v_org, p_registered, CASE WHEN p_registered THEN now() END, now(), p_state, p_detail, p_seq)
  -- ON CONFLICT (agent_id, registration_id) DO UPDATE SET registered = EXCLUDED.registered, seq = EXCLUDED.seq,
  --   registered_at = CASE WHEN EXCLUDED.registered AND NOT r.registered THEN now() ELSE r.registered_at END,
  --   last_seen_at = now(), last_state = EXCLUDED.last_state, last_detail = EXCLUDED.last_detail, updated_at = now()
  --   WHERE r.organization_id = v_org AND EXCLUDED.seq > r.seq;            -- stale/reordered writes are ignored
  -- GET DIAGNOSTICS v_rows; DELETE own rows older than 24 h; RETURN jsonb {applied: v_rows>0, reason}
CREATE FUNCTION public.is_phone_connected(p_agent_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER …;
```
Grants: `REVOKE ALL FROM PUBLIC, anon`; `GRANT SELECT` to `authenticated` on both; `GRANT INSERT, UPDATE ON agent_inbound_settings TO authenticated`; `GRANT ALL TO service_role`; RPC EXECUTE to `authenticated` + `service_role`.

### 7.2 M5 `…_inbound_routing_v2_settings.sql`
Columns `routing_engine text DEFAULT 'legacy' CHECK (legacy|v2)`, `inbound_group_agent_ids uuid[] DEFAULT '{}'`, `browser_ring_seconds int DEFAULT 20 (5–120)`, `mobile_ring_seconds int DEFAULT 20 (5–120)`, `voicemail_retention_days int DEFAULT 30 (1–365)`, CHECKs `inbound_group_size ≤ 10` and `inbound_v2_requires_group`; `profiles_availability_status_check` (P14: Available | On Break | Do Not Disturb | Offline). **Server-side group validation (explicit):**
- `CREATE FUNCTION private.validate_inbound_group(p_org uuid, p_ids uuid[]) RETURNS uuid[]` — raises `22023` unless: `p_ids` non-null, `1 ≤ cardinality ≤ 10` **after** `SELECT DISTINCT`, no NULL element, and **every** id matches `profiles` where `organization_id = p_org AND status = 'Active' AND btrim(coalesce(twilio_client_identity,'')) <> ''`; returns the distinct array.
- `CREATE TRIGGER trg_inbound_routing_settings_validate BEFORE INSERT OR UPDATE OF inbound_group_agent_ids, routing_engine ON public.inbound_routing_settings` — when `NEW.routing_engine='v2'` or the array is non-empty, `NEW.inbound_group_agent_ids := private.validate_inbound_group(NEW.organization_id, NEW.inbound_group_agent_ids)`; so a direct PostgREST write by an Admin cannot store duplicates, foreign-org ids, inactive agents, or agents without a client identity, and cannot activate v2 with an invalid group.
- `CREATE FUNCTION public.set_inbound_group(p_ids uuid[]) RETURNS jsonb SECURITY DEFINER` (Admin/Super Admin of `get_org_id()` per `profiles`, not the JWT) and `public.activate_inbound_routing_v2() RETURNS jsonb` (same authorization; re-validates the group; returns the checklist of §14 prerequisites it can check in SQL — group valid, ≥1 fresh registration in the org, every group member's/owner's settings row state — and only then sets `routing_engine='v2'`). EXECUTE to `authenticated` (authorization inside) + `service_role`.

### 7.3 M6 `…_inbound_route_attempts_d13_and_recovery.sql`
```sql
CREATE TABLE public.inbound_route_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL UNIQUE REFERENCES public.calls(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('owner','group')),
  owner_agent_id uuid, owner_source text CHECK (owner_source IN ('contact','direct_line')),
  eligibility_reason text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('owner_browser','owner_mobile','owner_voicemail','group_browser','group_voicemail','done')),
  stage_started_at timestamptz NOT NULL DEFAULT now(),
  reserved_agent_ids uuid[] NOT NULL DEFAULT '{}',
  mobile_number_dialed text, mobile_child_call_sid text,
  mobile_accepted_at timestamptz, mobile_accept_result text CHECK (mobile_accept_result IN ('accepted','accepted_after_hangup','no_digit','wrong_digit')),
  mobile_bridged_at timestamptz, mobile_bridge_evidence text CHECK (mobile_bridge_evidence IN ('dial_bridged','not_bridged','unconfirmed')),
  mobile_leg_ended_at timestamptz,
  voicemail_kind text CHECK (voicemail_kind IN ('agent','group')), voicemail_agent_id uuid, voicemail_group_ids uuid[],
  missed_marked_at timestamptz,
  provider_outcomes jsonb NOT NULL DEFAULT '[]'::jsonb,       -- bounded to the last 20 entries
  final_outcome text, terminal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ON public.inbound_route_attempts USING gin (reserved_agent_ids) WHERE NOT terminal;
CREATE INDEX ON public.inbound_route_attempts (organization_id, terminal, created_at);
ALTER TABLE public.calls
  ADD COLUMN answered_by_agent_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN missed_reason text CHECK (missed_reason IN ('no_answer','busy','dnd','offline_no_mobile','forwarded_to_mobile','group_empty')),
  ADD COLUMN missed_for_agent_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN missed_recipient_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN missed_notified_at timestamptz;
CREATE INDEX ON public.calls (missed_for_agent_id, created_at DESC) WHERE is_missed;
CREATE INDEX ON public.calls USING gin (missed_recipient_ids) WHERE is_missed;
CREATE INDEX ON public.calls (created_at) WHERE is_missed AND missed_notified_at IS NULL;
CREATE OR REPLACE FUNCTION public.finalize_inbound_call_terminal(uuid, uuid, text, boolean, boolean) … ;   -- retraction removed, otherwise verbatim
```
Private routine (not callable by clients): **`private.commit_owner_mobile(p_attempt_id, p_call_row_id, p_org_id, p_owner uuid, p_mobile text)`** — assumes the owner's advisory lock is held by the caller; re-evaluates DND (`availability_status IN ('On Break','Do Not Disturb')`) and busy (`is_agent_busy(p_org_id, p_owner, p_call_row_id)`); also refuses `owner_ineligible` (not Active/same org) and `no_mobile`; on refusal returns `{forward:false, reason}` without writing; otherwise in the **same subtransaction** (either UPDATE landing zero rows raises and rolls BOTH back, returned as `call_not_forwardable` / `stage_conflict`): `UPDATE inbound_route_attempts SET stage='owner_mobile', stage_started_at=now(), reserved_agent_ids=ARRAY[p_owner], mobile_number_dialed=p_mobile, missed_marked_at=now() WHERE id=p_attempt_id AND NOT terminal AND stage IN ('owner_browser','owner_mobile')` *(the `owner_mobile` self-transition is the immediate-forward insert path, see below)* and `UPDATE calls SET is_missed=true, missed_reason='forwarded_to_mobile', missed_for_agent_id=p_owner, missed_recipient_ids=ARRAY[p_owner], updated_at=now() WHERE id=p_call_row_id AND organization_id=p_org_id AND direction='inbound' AND agent_id IS NULL`; returns `{forward:true, mobile:p_mobile}`.

RPCs (`SECURITY DEFINER`, `search_path = public, pg_temp`, `REVOKE FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE TO service_role`):
- **`plan_inbound_route(p_call_row_id, p_org_id, p_owner_agent_id, p_owner_source, p_candidate_group_ids uuid[]) → jsonb`.** Locks (`pg_advisory_xact_lock(hashtext('inbound_agent:'||id))`, sorted) the owner or all candidates; evaluates availability, `is_phone_connected`, `is_agent_busy(…, p_call_row_id)`; decides the first stage; `INSERT INTO inbound_route_attempts … ON CONFLICT (call_id) DO NOTHING`. **If the first stage is `owner_mobile` (owner not connected, Available, not busy, mobile configured)** the insert is made with `stage='owner_mobile'` and the same transaction calls `private.commit_owner_mobile` (which performs the D13 writes and snapshots the destination). If the mobile is not configured/enabled ⇒ first stage `owner_voicemail` with `mark_inbound_missed(reason='offline_no_mobile')` in the same transaction. Returns `{created, attempt, stage, targets, reasons}`. **Duplicate initial webhook:** `created=false`, the existing attempt is returned and the handler re-emits the TwiML for the persisted stage (idempotent).
- **`advance_to_owner_mobile(p_attempt_id, p_org_id, p_call_row_id)` → jsonb.** Locks the owner; requires `stage='owner_browser' AND NOT terminal`; loads the mobile from `agent_inbound_settings`; calls `private.commit_owner_mobile`. **Zero rows / CAS miss:** returns `{updated:false, stage:<current>, terminal}` after re-reading; the handler then serves the TwiML that matches the persisted stage (`owner_mobile` ⇒ the same mobile `<Dial>` from the snapshot; `owner_voicemail` ⇒ voicemail; `done` ⇒ hangup). If the refusal is `dnd|busy`, the handler advances to `owner_voicemail` (`advance_inbound_route_stage` + `mark_inbound_missed(reason)`).
- **`mark_inbound_missed(p_call_row_id, p_org_id, p_reason, p_recipient_ids uuid[], p_for_agent_id uuid)` → jsonb.** The one missed writer besides `commit_owner_mobile`: sets `is_missed=true`, `missed_reason` (first writer keeps its reason), `missed_for_agent_id` (COALESCE), `missed_recipient_ids` (COALESCE non-empty), guarded `agent_id IS NULL AND outcome IS DISTINCT FROM 'forwarded_answered'`. Idempotent.
- **`advance_inbound_route_stage(p_attempt_id, p_org_id, p_from_stage, p_to_stage, p_patch jsonb)`** — generic CAS (`stage = p_from_stage AND NOT terminal`); `owner_mobile` is refused here (22023) — it is reachable only through `advance_to_owner_mobile`; `p_patch` may set `final_outcome`, `voicemail_kind`, `voicemail_agent_id`, `voicemail_group_ids` and append one bounded `outcome` entry; returns `{updated, stage, terminal, reason ok|stage_mismatch}`.
- **`record_inbound_mobile_accept(p_attempt_id, p_org_id, p_call_row_id, p_agent_id, p_child_call_sid, p_digits)`** — under the owner lock; requires stage `owner_mobile`, the signed agent = owner, and a `^CA…$` child SID (bound on first record, cross-checked afterwards); results `accepted` | `accepted_after_hangup` (parent `ended_at` set or terminal) | `no_digit` | `wrong_digit`; idempotent on redelivery; touches nothing on `calls`.
- **`record_inbound_mobile_bridge(p_attempt_id, p_org_id, p_call_row_id, p_agent_id, p_dial_bridged boolean, p_dial_call_status text, p_dial_call_sid text, p_dial_call_duration int)`** — requires `mobile_accept_result='accepted'`; if `p_dial_bridged IS TRUE` ⇒ `mobile_bridged_at=now()`, evidence `dial_bridged`, and `UPDATE calls SET outcome='forwarded_answered', answered_by_agent_id=COALESCE(answered_by_agent_id,p_agent_id), provider_session_id=COALESCE(provider_session_id,p_dial_call_sid), status=CASE WHEN status='ringing' THEN 'connected' ELSE status END, updated_at=now() WHERE … agent_id IS NULL …`; if `p_dial_bridged IS FALSE` ⇒ evidence `not_bridged`; if NULL (field absent) ⇒ evidence `unconfirmed`, **no `calls` write**. Never writes `is_missed` or `duration`.
- **`record_inbound_mobile_leg_end(p_attempt_id, p_org_id, p_child_call_sid, p_call_status, p_call_duration)`** — sets `mobile_leg_ended_at`, appends the provider outcome; ends the reservation.
- **`is_agent_busy(p_org_id, p_agent_id, p_exclude_call_id)`** `STABLE` — §8.4 (calls 4 h; ringing reservations 5 min; unaccepted mobile 5 min; accepted mobile until `mobile_leg_ended_at` with a 4 h cap), excluding `p_exclude_call_id`.
- **`converge_inbound_notifications(p_call_row_id)`** and **`sweep_inbound_notifications(p_limit)`** live in **M7** (they need `voicemails`) — §3.4; the guarded `cron.schedule('inbound-notify-sweep', '*/2 * * * *', …)` is the last statement of M7 and runs only where pg_cron is installed.
Policies: RLS on, zero policies (service-role only).

### 7.4 M7 `20260915053646_inbound_voicemails.sql` (as implemented)
`public.voicemails` (`id, organization_id, call_id, attempt_id` nullable validated FK, `recipient_kind agent|group, recipient_agent_id, recipient_group_ids, recording_sid UNIQUE ^RE…$, recording_source, provider_account_sid, storage_bucket 'voicemails', storage_path UNIQUE, duration_seconds, status pending|stored|failed|purged, source_cleanup_state pending|deleted|failed + attempts/next_at/error, notified_at + notify_attempts/next_at/error, listened_at`), `calls.voicemail_id`, `notifications_type_check` + `'voicemail'`, private bucket `voicemails` (audio/mpeg, 25 MB), `can_access_voicemail(uuid)` (recipient, snapshot ∪ configured group member, org Admin, super admin — same org), policies `voicemails_select` / `voicemails_update_listened` (+ column-scoped `GRANT UPDATE (listened_at)`), `voicemail_objects_select` on `storage.objects`. RPCs (service role): `upsert_voicemail_from_recording(p_recording_sid, p_call_row_id, p_org_id, p_attempt_id, p_mailbox 'agent:<uuid>'|'group', p_storage_path, p_duration, p_status, p_account_sid DEFAULT NULL)` (stored is sticky; cross-call SID reuse refused; sets `calls.voicemail_id`), `mark_voicemail_source_deleted`, `record_voicemail_cleanup_failure` (backoff), `voicemails_cleanup_batch`, `voicemails_expired_batch(p_org_id, p_listened_cutoff, p_unheard_cutoff, p_limit)`, `mark_voicemails_purged`; `converge_inbound_notifications`, `sweep_inbound_notifications`; guarded pg_cron schedule (§3.4). Rollback file drops all of it and unschedules the sweep (gated on zero stored voicemails or an export, §14).

### 7.5 Generated types — `src/integrations/supabase/types.ts` was extended by hand to the SQL signatures (new tables `agent_inbound_settings`, `agent_phone_registrations`, `inbound_route_attempts`, `voicemails`; new `calls` / `inbound_routing_settings` columns; every new RPC) and is now held identical to generator output from an isolated schema by `scripts/verify_inbound_generated_types.sh` (§0c). Run that script before release; after M4–M7 reach a hosted database, a plain `supabase gen types` regen is a confirmation, not the test (AGENT_RULES #30 rev 8(b)).

### 7.6 (M8 removed — no comment-only migration.)

### 7.7 Exact RLS approval scope — `#APPROVE_RLS_CHANGE` granted 2026-09-10 for exactly this scope, **development-only (local database); not for production or any remote database**
`agent_inbound_settings` (self select/insert/update + admin select) · `agent_phone_registrations` (self select + org select; no client writes) · `inbound_route_attempts` (RLS on, zero policies) · `voicemails` (`voicemails_select`, `voicemails_update_listened`) · `storage.objects` `voicemail_objects_select` on bucket `voicemails`. No existing policy on `calls`, `profiles`, `notifications`, `phone_numbers`, `inbound_routing_settings`, `call-recordings` is modified; RLS Phase 1 postconditions stay satisfied.

---

## 8. Change set C — Server routing (`twilio-voice-inbound`)

### 8.1 Planner (`planner.ts`) — atomic reservation incl. immediate forwarding (gap 1)
`handleInitialInbound`: legacy engine unchanged unless `routing_engine='v2'` (rev 5 exception: when the engine flag cannot be READ after bounded retries the call takes the infrastructure-failure path for every organization — never routed by assumption; the rollback state with the v2 columns absent still runs legacy, see §0c row 4). v2: owner resolution → candidate group → **`plan_inbound_route`** (one transaction). Then, by returned stage: `owner_browser`/`group_browser` ⇒ `persistRoutedAgents` (R14) ⇒ `<Client>` TwiML; **`owner_mobile` ⇒ the D13 commit and destination snapshot already happened inside the RPC ⇒ notify (tier 0) ⇒ mobile TwiML**; `owner_voicemail`/`group_voicemail` ⇒ notify ⇒ voicemail TwiML. If `plan_inbound_route` fails after 3 retries ⇒ **safe path**: voicemail TwiML with the mailbox in the signed recording URL and `mark_inbound_missed(reason='no_answer', recipients=[owner] or group)`; never a mobile `<Dial>`. No lazy attempt creation.

### 8.2 The 20-second browser ring (gap 6) — P17 decided: measurement-based calibration toward ≈ 20 s
- **Requirement:** the owner's browser rings for **20 seconds** (D4). Provider setting: `<Dial timeout="{browser_ring_seconds}">` with `inbound_routing_settings.browser_ring_seconds` DEFAULT 20 (5–120, integer seconds — Twilio's only control; the value used is recorded on the attempt as `browser_ring_timeout_sent`). Twilio documents that the ring may exceed the timeout by up to five seconds (per Chris's Dial reference; not verifiable from this environment). The requirement is **not** redefined as "at least 20 seconds"; no exact timing is promised; and there is deliberately **no separate browser-controlled call-cancellation mechanism** (the browser never ends an inbound leg on its own timer).
- **Measurement (implemented):** (i) agent-perceived ring = Device `incoming` → `cancel`/`accept`/`reject`, measured in `TwilioContext` and written to the presence row as `last_detail = 'ring:<ms>:<outcome>'` and to the in-memory diagnostics ring buffer shown by the Phone connection diagnostics card (My Profile); (ii) server span = attempt `stage_started_at` → the `<Dial action>` entry appended to `provider_outcomes` (`dial_action`, with `at`); (iii) the SDK waits up to 2 s for ringtone playback before emitting `incoming` (SDK-verified), which shortens the audible ring relative to the provider window. **Calibration:** after live calls, compare (i) and (ii) with the setting and, if the audible ring is consistently short of ≈ 20 s or long past it, adjust `browser_ring_seconds` from data — never from an assumed band.
- **Ten `<Client>` limit and signed checks:** the explicit group is validated to ≤ 10 members by CHECK + trigger + RPC; every mobile callback carries server-issued `call_row_id / org_id / attempt_id / agent_id` that the SQL cross-checks against the attempt; the Client identity validator is never applied to a phone number (`buildMobileForwardTwiml` accepts E.164 only).

### 8.3 Stage handlers (as implemented in `stages.ts`; safeguards 1 and 5)
- **`owner_browser` return.** Answered (`DialCallStatus completed|answered`) ⇒ attempt `done` (`browser_answered`) + `finalize_inbound_call_terminal('completed')`, empty TwiML. Otherwise `advance_to_owner_mobile`: `{updated:true, forward:true, mobile}` ⇒ converge notifications ⇒ mobile TwiML from the returned snapshot; `{updated:true, forward:false, stage:'owner_voicemail', reason dnd|busy|no_mobile|owner_ineligible}` ⇒ converge ⇒ owner voicemail TwiML; `{updated:false}` ⇒ the PERSISTED stage's TwiML (`owner_mobile` ⇒ the same mobile `<Dial>` from the snapshot, `owner_voicemail` ⇒ voicemail, `done` ⇒ empty, `call_not_forwardable` ⇒ empty because the call was answered by a browser claim or is terminal, `stage_conflict` while still `owner_browser` ⇒ voicemail — never a re-ring from a return). **RPC failure after 3 bounded retries ⇒ `mark_inbound_missed(no_answer)` best effort + owner voicemail TwiML — never the mobile `<Dial>`.**
- **`owner_mobile` return (parent `<Dial action>`).** `DialCallStatus / DialCallSid / DialCallDuration / DialBridged` ⇒ `record_inbound_mobile_bridge` (`DialBridged` parsed strictly: `"true"` ⇒ true, `"false"` ⇒ false, anything else incl. absent ⇒ null). Next step per §0b safeguard 5: `dial_bridged` ⇒ `done` (`mobile_bridged`) + finalize completed + empty TwiML; `unconfirmed` + recorded `accepted` + documented answered status ⇒ `done` (`mobile_unconfirmed_ended`) + finalize completed + empty TwiML, no attribution; otherwise ⇒ `owner_voicemail` (no new missed mark) + owner voicemail TwiML. A machine pickup that never pressed 1 was hung up by the whisper and arrives here as `not_bridged`. A bridge RPC failure is treated as `unconfirmed` for the TwiML decision and records nothing.
- **`mobile_whisper` (child leg `<Number url>`).** First request ⇒ `<Gather numDigits="1" timeout="5" actionOnEmptyResult="true">` ("AgentFlow call from …. Press 1 to accept.") followed by `<Hangup/>`; the Gather action (`gather=1`) ⇒ `record_inbound_mobile_accept(child CallSid, Digits)`: only a recorded `accepted` returns the empty response that lets Twilio bridge; `no_digit` / `wrong_digit` / `accepted_after_hangup` / an unrecorded acceptance (RPC failure) ⇒ `<Say>…<Hangup/>` (never bridge an acceptance the database did not record).
- **`mobile_leg_status` (child `<Number statusCallback>`, not TwiML).** `initiated/ringing/answered` ⇒ `append_inbound_provider_outcome`; terminal (`completed|busy|no-answer|failed|canceled`) ⇒ `record_inbound_mobile_leg_end` (releases the accepted-mobile reservation). Write failure ⇒ **503** so the override-configured callback redelivers.
- **`group_browser` return.** Answered ⇒ `done` + finalize completed. Otherwise `advance_inbound_route_stage(group_browser → group_voicemail, voicemail_group_ids = the rung members)` + `mark_inbound_missed('no_answer', recipients = the rung members)` + converge ⇒ group voicemail TwiML; a stage mismatch follows the persisted stage (never a re-ring).
- **`voicemail_done` (`<Record action>`).** attempt `→ done` (`voicemail_left`) from its voicemail stage + finalize completed + converge; empty TwiML. The recording itself arrives at `twilio-recording-status?source=voicemail…` (§10).
- **Initial inbound (§8.1).** Owner = direct-line owner (P1) else the contact's assigned agent (D2) else none (D5 group). `plan_inbound_route` failure after 3 retries ⇒ `mark_inbound_missed('no_answer', [owner] or group)` + converge + voicemail TwiML with the mailbox in the signed recording URL and no attempt id — never a mobile `<Dial>`. Browser stages persist the reserved wave (`append_call_routed_agents`, R14) BEFORE any `<Client>` is emitted; persistence failure or an empty identity set moves the attempt to its voicemail stage with a missed mark for the reserved agents.

### 8.4 Busy correctness (as implemented)
`is_agent_busy(org, agent, exclude_call)` is derived, never stored: a `calls` row where the agent is `agent_id` or `answered_by_agent_id`, status `ringing|connected`, `ended_at IS NULL`, created within 4 h; or a non-terminal attempt reserving the agent in a ringing stage started < 5 min ago, an unaccepted `owner_mobile` < 5 min old, or an accepted `owner_mobile` whose child leg has not ended (< 4 h). Two end signals for a bridged conversation: the parent `<Dial action>` / status callback (ends the `calls` row) and the child `completed` statusCallback (`mobile_leg_ended_at`); either alone keeps the other's reservation honest (SQL A5, A5b, A13).

### 8.5 Signed callback contracts (as implemented)
All v2 callbacks are self URLs `?stage=<owner_browser|owner_mobile|mobile_whisper|mobile_leg_status|group_browser|voicemail_done>&call_row_id&org_id&attempt_id&agent_id` signed by Twilio over the full URL; malformed identifiers are refused with empty TwiML and zero writes; the SQL functions cross-check attempt ↔ call ↔ org ↔ owner. `<Dial action>` URLs and `<Number statusCallback>` URLs carry the connection-override fragment `#rc=3&rp=5xx,ct,rt` (whether Twilio honours overrides on `action` URLs is a live check). Legacy `fallback=` callbacks are dispatched unchanged.

### 8.6 Response policy (as implemented)
TwiML-consuming requests (initial, every `<Dial action>`, whisper, `<Record action>`) always answer **200 with safe TwiML** — a 5xx there would make Twilio drop the caller; durable state and recovery (attempt CAS, D13 in-transaction, converge + sweep, `twilio-voice-status` as the second terminal writer) make the TwiML decision safe to serve. Non-TwiML callbacks answer 503 on write failure so they are redelivered: `mobile_leg_status`, `twilio-voice-status` (lookup/update/notify-RPC failures), `twilio-recording-status` (see §10: 503 only while storage/metadata persistence is incomplete or the source deletion is owed; 200 once stored + deleted even if the notification is still owed).

---

## 9. Change set D — Mobile handoff (gap 5; as implemented)

TwiML (`buildMobileForwardTwiml`): `<Dial timeout="{mobile_ring_seconds}" action="{stage=owner_mobile}#rc=3&rp=5xx,ct,rt"><Number url="{stage=mobile_whisper}" statusCallback="{stage=mobile_leg_status}#…" statusCallbackEvent="initiated ringing answered completed">+E.164</Number></Dial>` — **no `record` attribute, no recording callback, no `callerId` (P7)**; the destination is the snapshot persisted by `commit_owner_mobile`, never re-read from settings, and must be E.164 (the builder throws otherwise; vitest-enforced). Whisper: `<Gather input="dtmf" numDigits="1" timeout="5" actionOnEmptyResult="true">Press 1</Gather><Hangup/>`.

**Facts and their sources.** (a) **Acceptance** = signed Gather action `Digits=1` → `record_inbound_mobile_accept` (`accepted` | `accepted_after_hangup` when the parent already ended | `no_digit` | `wrong_digit`; the child SID is bound on first record and cross-checked afterwards). (b) **Bridging** = the parent `<Dial action>` request's **`DialBridged`** boolean (documented Dial action parameter per Chris's Dial reference) → `record_inbound_mobile_bridge`; `DialCallStatus/DialCallSid/DialCallDuration` are recorded as provider evidence and never used to infer bridging; a machine-answered whisper ends `completed` without bridging. (c) **Child-leg lifecycle** = `<Number statusCallback>` events → provider outcomes + `record_inbound_mobile_leg_end`; the child's duration includes the whisper and proves nothing about bridging. (d) **Insufficient evidence** (no `DialBridged` field) ⇒ `unconfirmed`: no attribution, no `outcome` write, no duration proof; the call stays "Missed in AgentFlow — forwarded to mobile" with provider status/duration intact. The next-step TwiML for `unconfirmed` reconciles with the documented Dial-action results (§0b safeguard 5, §8.3) so a provider-reported completed conversation is not followed by a voicemail prompt, while attribution stays unconfirmed.
**Remaining live verification cases:** `DialBridged` present and `true` for accept+bridge; `false` (or absent) for machine pickup without Press 1, for `no_digit` timeout, for Press 1 after the caller hung up; `DialCallStatus` values in each; `<Number statusCallbackEvent>` delivery and the child `CallDuration` semantics; whether `<Hangup/>` in the whisper prevents bridging; default caller ID (P7); whether connection overrides apply to `action` URLs; `actionOnEmptyResult` delivery of the empty-digit Gather action.

---

## 10. Change set E — Voicemail (gap 3 alignment; safeguard 3; as implemented)
`twilio-recording-status?source=voicemail&mailbox=agent:<uuid>|group&call_row_id&org_id[&attempt_id]` (SIGNED query, validated; a mailbox is never free text or a phone number). Pipeline: download → upload to the PRIVATE `voicemails` bucket (`<org>/<yyyymmdd>/<CallSid>-<RecordingSid>.mp3`) → `upsert_voicemail_from_recording(status='stored', path, duration, AccountSid)` verified → Twilio source DELETE (2xx/404 = success ⇒ `mark_voicemail_source_deleted`; otherwise `record_voicemail_cleanup_failure` ⇒ **503**, and the redelivered callback — classified `cleanup_retry` by the stored-but-undeleted row — performs CLEANUP ONLY; `recording-retention-purge` also retries due cleanups) → `converge_inbound_notifications` (best effort; failure ⇒ 200, sweep-owned). Download/upload/persist failures preserve the source, write a `failed` row best effort and answer 503. Duplicate deliveries after full success converge and ack 200. Retention (P13): `voicemails_expired_batch(org, listened_cutoff = now − voicemail_retention_days, unheard_cutoff = now − 90 d)` → object removal → `mark_voicemails_purged`, only after the removal succeeded. Playback (P3): `VoicemailPlayer` (signed URL, 5 min) in the notification drawer (`voicemail` rows carry `metadata.voicemail_id`), the Missed Calls widget and the contact timeline; `listened_at` is the only browser write. Conversation recordings and `calls.recording_*` are untouched.

---

## 11. Files touched (as implemented)
**Frontend (edit):** `src/contexts/TwilioContext.tsx` (provider-owned lifetime, identity-loss teardown, readiness truth on `unregistered`, bounded idle-only recovery, presence generations + ringtone outputs on `registered`, P17 ring measurement), `src/lib/twilio-voice.ts` (`destroying` promise awaited by init), `src/components/layout/FloatingDialer.tsx` and `src/pages/DialerPage.tsx` (no UI destroys), `src/contexts/AuthContext.tsx` (logout keepalive), `src/contexts/AgentStatusContext.tsx` (rewritten: manual availability + derived states), `src/components/layout/TopBar.tsx`, `src/components/settings/profile/ProfileInfoCard.tsx`, `src/components/contacts/AgentModal.tsx`, `src/lib/incomingCallAlerts.ts` (notification-only), `src/components/settings/InboundRoutingManager.tsx` (mounts the v2 section), `src/components/settings/MyProfile.tsx` (mounts three cards), `src/components/dashboard/widgets/MissedCallsWidget.tsx`, `src/components/dashboard/DashboardDetailModal.tsx`, `src/components/contacts/conversation-history/conversationTypes.ts` + `CallHistoryItem.tsx`, `src/components/contacts/FullScreenContactView.tsx` (select), `src/lib/dialer-api.ts` (history label), `src/components/notifications/NotificationRow.tsx`, `src/lib/notification-presentation.ts`, `src/hooks/useInboundCallerDisplayLines.ts` (comment), `src/integrations/supabase/types.ts`, `src/components/layout/__tests__/topBarViewAsShell.test.tsx` (mock shape). **Frontend (new):** `src/lib/phonePresence.ts`, `phonePresenceClient.ts`, `ringtoneOutputs.ts`, `voicemails.ts`, `inbound-call-labels.ts`, `missedCallScope.ts`, `agentAvailability.ts`, `inboundSettingsValidation.ts`; `src/components/voicemail/VoicemailPlayer.tsx`; `src/components/settings/profile/ProfileInboundCard.tsx`, `ProfileRingtoneOutputCard.tsx`, `ConnectionDiagnostics.tsx`; `src/components/settings/inbound-routing/InboundV2Section.tsx`. **Deleted:** `src/components/dialer/IncomingCallModal.tsx`.
**Edge (edit):** `twilio-voice-inbound/index.ts` (v2 settings load, owner resolution, `stage=` dispatcher; legacy `fallback=` handlers untouched), `twiml.ts` (v2 builders); `twilio-voice-status/index.ts` (the two `calls` projections + comment only); `twilio-recording-status/index.ts` + `idempotency.ts` (voicemail branch); `_shared/notifications.ts` (Deno-free; snapshot rows ⇒ converge RPC), `_shared/notification-recipients.ts` (tier 0, D13 body); `recording-retention-purge/index.ts` (voicemail retention + cleanup passes). **Edge (new):** `twilio-voice-inbound/planner.ts`, `stages.ts`. **Not modified:** `inbound-call-claim`, `twilio-voice-webhook`, `twilio-token`, `repair-twilio-number-ownership`, `_shared/twilioNumberConfig.ts`.
**Database (new, unapplied):** `supabase/migrations/20260914000530…000400` (M4–M7), `supabase/migrations/rollback/20260914000530…000400.rollback.sql`, `supabase/tests/inbound_v2_harness.sql`, `inbound_registrations.sql`, `inbound_group_validation.sql`, `inbound_route_attempts.sql`, `inbound_voicemails.sql`, `scripts/run_inbound_sql_tests.sh` (extended). **Docs:** `implementation_plan.md`, `WORK_LOG.md`, `AGENT_RULES.md`.
**Explicitly NOT touched:** applied migrations; `calls`/`profiles`/`notifications` policies; `claim_inbound_call`; `dialer_sessions`; campaign calling windows; `business_hours` data; outbound `makeCall`/`device.connect()`; browser `.webm` outbound recording; `call-recordings` policies; Twilio number configuration; the Supabase GitHub integration; any production row.

---

## 12. Tests (fail-first) and static gates — as run on 2026-09-11
**SQL (local PostgreSQL 16, disposable database, whole files roll back; `scripts/run_inbound_sql_tests.sh`):** M1–M3 suites (4) + R9 two-session proof, then v2 harness + M4–M7 + `inbound_registrations` R1–R6 (generations, stale seq, own-row-only, org read scope, freshness, fail-closed), `inbound_group_validation` G1–G5, `inbound_route_attempts` A1–A14 incl. A5b (owner browser → mobile atomicity, D13 persistence through accept/bridge/finalize, immediate offline forwarding, Offline ≠ DND, intervening claim refusal, DND during the ring, acceptance variants, absent `DialBridged`, group wave/reservation, stage ceilings, ACLs), `inbound_voicemails` V1–V9 (upsert/stored sticky/`provider_account_sid`, cleanup state, mailbox authorization incl. storage predicate, converge/sweep), and the two-session owner-reservation proof — **all green**. Fail-first was demonstrated: the v2 suites fail without M4–M7.
**Vitest (jsdom):** new `inboundStages` (29), `inboundV2Twiml` (9), `missedRecipientTier0` (11), `voicemailRecordingPipeline` (9), `phonePresence` (11), `ringtoneOutputs` (7), `inboundCallLabels` (9), `inboundDeviceLifetime` (13, source contracts); existing inbound/recording/status/notification suites unchanged and green; `inboundBrowserLifecycleWrites` still audits exactly 6 guarded browser `calls` write sites. Full run: 158 files / 2357 tests passed; **11 files fail identically on `main`** (they import the Supabase client without `VITE_SUPABASE_URL` in this environment — pre-existing, unrelated).
**Static gates:** `npx tsc --noEmit` exit 0; `tsc -p tsconfig.app.json` 81 errors, **byte-identical set to `main`**; eslint on every touched file: 0 errors (pre-existing warnings only); `npm run build` exit 0; esbuild bundles clean for `twilio-voice-inbound` (7 local inputs), `twilio-voice-status` (5), `twilio-recording-status` (2), `recording-retention-purge` (1), sole external `esm.sh/@supabase/supabase-js@2`; M4–M7 replay clean on the local database (`deno` absent; `deno check` not run).
**What mocked tests do not prove:** audible ringing on speakers and headset, mobile acceptance and bridging, provider ring timing, real Twilio callback shapes and redelivery, RLS behaviour on a Supabase-hosted database (the harness stubs `auth.uid()`/roles), pg_cron scheduling. These stay explicitly unproven until §13's live checks run.

---

## 13. Verification matrix (additions in bold)
As rev 2, plus: **offline owner A / number owner B: A gets one missed notification, B none — also after a failed first insert, repeated parent callbacks, and reassignment of the contact**; **immediate offline forward: D13 mark visible before the mobile rings**; **duplicate initial webhook and duplicate Dial action deliveries**; **20-second ring: browser and server measurements reported per call (no band assumed)**; **`DialBridged` cases (accept+bridge, machine pickup, no digit, Press 1 after hangup) with the resulting evidence and label**; **presence: duplicate tab, reload, delayed pagehide, reordered heartbeat, logout, identity change**; **rollback drain: a v2 mobile conversation active for 30 minutes, a recording callback that failed processing, a late callback arriving after the flag flip**; **notification recovery by the sweep after a forced insert failure**. Waived/deferred items stay not passed; unexecuted live tests are reported as unproven.

---

## 14. Cutover gate, release order, rollback (gap 7; safeguard 4)
> **Release preflight (rev 13, 2026-09-12):** `RELEASE_READINESS.md` carries the verified targets, the per-step effects/prerequisites/checks/recovery, the executable drain gate (§4 there) and the controlled live checklist. Two environment facts established by read-only inspection change how this section is executed: **pg_cron is installed in production**, so M7 schedules both sweeps the moment it is applied; and the `agentflow` Vercel project **auto-deploys `main` to production**, so a merge is itself the frontend release.

**Proposed release sequence (each step separately approved; nothing here has been executed):** M4 → M5 → M6 → M7 applied and verified (types regenerated and diffed against §7.5) → `twilio-voice-status` (projections + snapshot routing) → `twilio-recording-status` → `recording-retention-purge` → `twilio-voice-inbound` (both engines; every org still `legacy`) → frontend release → per-org prerequisites (fresh registrations observed, group validated, mobile numbers or acknowledged voicemail-only, mailbox access verified, ring measurements reviewed) → `set_inbound_routing_engine('v2')` for that org (an approved production settings write, invariant #28).

**Rollback / recovery (conservative):**
1. **Flag first.** `set_inbound_routing_engine('legacy')` (or the admin card) stops NEW v2 calls only. Every deployed handler keeps serving `stage=` and `source=voicemail` callbacks for outstanding v2 work; **the compatible versions stay deployed** — removing callback compatibility is out of scope.
2. **Drain gate — SUPERSEDED BY THE EXECUTABLE VERSION IN `RELEASE_READINESS.md` §4** (rev 13). Use that script, not this prose. It keeps every rule below and corrects two defects in the wording that stood here: "v2-era calls" is now the DURABLE ownership rule (`calls.routing_engine = 'v2' OR a route attempt exists`, corrective pass 6) rather than an era, and the missed-notification check no longer requires a non-empty recipient snapshot — a v2 call whose intended recipient is still UNRESOLVED carries an EMPTY snapshot and is owed work (corrective pass 7). On an isolated database the old check returned 0 for exactly such a row while the corrected one returns 1. The gate also reports source deletion still owed after a purge, and work whose retry budget is exhausted; **no check filters by age or attempt count**, so nothing outstanding can be hidden by being old or by having run out of retries. Unchanged: every count must be zero; an attempt whose parent ended and whose obligations are complete may be closed only by an approved ops SQL, never silently; and only after every count is zero does the **30-minute quiet period** start, covering Twilio's override retries and late recording callbacks — it is never proof on its own. Only then may earlier function versions be restored, and only if no organization remains on `v2`.
3. **Migrations.** Additive; rollback files exist for M4–M7 and run in reverse order. The M6 rollback restores every function it replaced but **never restores a `finalize_inbound_call_terminal` body that clears `is_missed`** (D13 monotonicity survives rollback). Shared functions are restored only after checking every organization is on `legacy` and no v2 obligation remains. The M7 rollback unschedules the sweep and is gated on zero stored voicemails or an export. Restoring earlier `twilio-voice-status`/`twilio-recording-status` versions would route recipients through tiers 1–4 and store `source=voicemail` recordings into `calls.recording_*` — hence the gate above.
4. **Frontend** rollback = Vercel redeploy; presence/availability writes are best-effort and idempotent.

---

## 15. Invariant interactions (as implemented)
#8 sole `calls.duration` writer: unchanged — no v2 code writes `duration` (SQL-tested: `record_inbound_mobile_bridge` never touches `is_missed`/`duration`; `twilio-voice-status` changes are projection-only). #9 TwilioContext re-entrancy refs preserved (`callStateRef`/`isDialingRef` gate the recovery and the ring measurement never writes call state). #20/#31 profiles: availability is written by `updateProfile` on the REAL operator only; presence never touches `availability_status`. #25 immutable applied migrations: M4–M7 are new files (authored versions `202609110001xx`, to be renamed at apply). #28 production read-only: honoured — local database only. #30 narrowed per §3.3: `is_missed` monotonic; `finalize_inbound_call_terminal`'s retraction removed by M6; browser zero inbound `calls` writes (audit still 6 guarded outbound sites); R13 untouched; R14 extended to the v2 waves. RLS scope exactly §7.7.

## 16. Rule updates made
`AGENT_RULES.md` #30 amended narrowly (D13 monotonic missed classification; retraction removed by M6) and new invariant **#32** (Inbound Calling v2: provider-owned Device lifetime, presence generations, atomic mobile commitment, one notification rule in SQL, bridge evidence, cleanup recovery, conservative rollback, development-only status).

## 17. Decisions — resolved
D1–D13 settled; P1–P16 approved; P17 = measurement-based calibration toward ≈ 20 s (§8.2); `#APPROVE_RLS_CHANGE` granted development-only for §7.7. Still Chris's call, later and separately: applying M4–M7 to production, each deployment step of §14, enabling `v2` per organization, and any Twilio setting.

## 18. Limits and what remains unproven
Twilio docs unreachable (egress) — Dial/Number/Gather facts are taken from Chris's references and the SDK sources and are marked verify-live; `deno` absent (`deno check` not run; esbuild closure only); the SQL harness stubs Supabase auth/roles, so RLS is proven only against the harness; no live call, no Twilio console, no remote database; **Alexa's incident attribution remains unproven** — the incident evidence is consistent with no registered Device, and v2's provider-owned lifetime removes that class of failure, but a live inbound test is the only proof. Live checks still owed (§13): audible ring on speakers + headset, 20-second ring measurement, mobile Press 1 accept/bridge/machine/no-digit/after-hangup cases with observed `DialBridged` values, voicemail storage/cleanup/playback, presence generations across duplicate tabs/reload/logout, sweep scheduling on a database with pg_cron, and the rollback drain.

---

# §19. My Profile / Inbound Calling UI simplification (rev 19 — FRONTEND UX REFACTOR ONLY, awaiting approval)

**Label:** REFACTOR (user-facing My Profile / Preferences simplification). **Authored:** 2026-09-19 from `b8c9acd` (= `origin/main`), branch `claude/gallant-archimedes-rmk0jt`.
**Status:** APPROVED 2026-09-19 (all five defaults accepted) and **IMPLEMENTED** on `claude/gallant-archimedes-rmk0jt`. Frontend only: no migration, no Edge Function deployment, no production Vercel deployment, no production write. Not merged to `main`. Automatic Vercel preview deployments occurred through the existing Git integration; production remained on `main` @ `b8c9acd`.

**Scope boundary (non-negotiable).** No change to inbound routing behaviour, Twilio call behaviour, availability semantics, voicemail routing, ownership, telemetry, Edge Functions, database schema, RLS, cron or production configuration. **No Supabase migration. No Edge Function deployment. No production Vercel deployment** (automatic Vercel preview deployments occur through the existing Git integration on push). The routing matrix validated in PRODUCTION (AVAILABLE → browser → mobile forwarding → voicemail; OFFLINE → mobile forwarding → voicemail; ON BREAK / DND → voicemail; known contact → assigned owner first; unknown → configured inbound group; D13 missed-call marking) is untouched — the refactor never reads or writes routing tables and never touches `twilio-voice-inbound`, `twilio-voice-status`, `twilio-recording-status`, `inbound-call-claim`, routing RPCs or migrations.

## 19.1 Inspection basis

`AGENT_RULES.md` (§3 multi-tenancy/`.maybeSingle()`, §7 component standards < 200 lines / Zod / Tailwind-only, §8 workflow, §9 doc rule, §10 forbidden patterns), `VISION.md`, `WORK_LOG.md` newest entries (no conflicting frontend work in flight). **Production state reconciled read-only on 2026-09-19 — the repository docs predating it are stale:** PR #372 shipped the frontend and Chris then activated v2 for his organization, so `inbound_routing_settings` holds exactly one organization at `routing_engine='v2'` (inbound group of 1, browser and mobile ring 20 s), with 4 `routing_engine='v2'` calls, 4 inbound route attempts, 1 stored voicemail and 1 agent with mobile forwarding enabled. Live routing, DND, unanswered→mobile, voicemail and recovery-sweep tests have all passed in production. Nothing was mutated: SELECTs only. Files read: `MyProfile.tsx`, `profile/ProfileInboundCard.tsx`, `profile/ProfilePreferencesCard.tsx`, `profile/ProfileRingtoneOutputCard.tsx`, `profile/ConnectionDiagnostics.tsx`, `profile/ProfileInfoCard.tsx`, `src/lib/ringtoneOutputs.ts`, `src/lib/inboundSettingsValidation.ts`, `src/contexts/AgentStatusContext.tsx`, `src/contexts/UnsavedChangesContext.tsx`, the `applyRingtoneOutputs` call sites in `src/contexts/TwilioContext.tsx` (lines 2020, 2042), and the tests `ringtoneOutputs.test.ts`, `inboundDeviceLifetime.test.ts`, `twilioVoiceLifecycle.test.ts`, `twilioProviderLifecycle.test.tsx`, `profileInboundCard.test.tsx`, `profilePreferencesNotifications.test.tsx`.

**Pinned constraint found during inspection:** `src/lib/__tests__/inboundDeviceLifetime.test.ts` asserts the literal source strings `void applyRingtoneOutputs(device);` and the absence of `applyRingtoneOutputs(getTwilioDevice())` in `TwilioContext.tsx`. The refactor therefore keeps both call sites **byte-identical** — `applyRingtoneOutputs` keeps its one-argument call shape and simply stops accepting a preference.

## 19.2 Change 1 — Call Forwarding moves into Preferences

`ProfileInboundCard` (standalone card "Inbound calls to your mobile") is replaced by `ProfileCallForwardingSection`, rendered as a subsection **inside** `ProfilePreferencesCard`. Preferences becomes the home for **Appearance · Notifications · Call Forwarding · Timezone**, in that order, separated by `border-t border-border/50` dividers — no nested cards.

Persistence is unchanged: self-owned `public.agent_inbound_settings` row, `.maybeSingle()` read, `upsert(..., { onConflict: "agent_id" })` with `agent_id`, `organization_id`, `mobile_forward_number` (E.164 via the existing `normalizeMobileForwardNumber`), `mobile_forward_enabled`, `voicemail_greeting_text`, `voicemail_greeting_url`, `updated_at`. **No data moves to `user_preferences`. No RLS change. No routing change.** `organization_id` still comes from `realProfile` (the real operator, never the View As profile), and the section renders `null` when `isImpersonating` — identical to today's card.

User-facing surface:

| Element | Copy |
|---|---|
| Section title | **Call Forwarding** |
| Description | Send unanswered calls to your mobile. |
| Switch | Forward unanswered calls |
| Input | Mobile number |
| Textarea | Voicemail greeting |
| Save | `Save call forwarding` → toast **"Call forwarding saved."** |
| Not-activated (engine `legacy`) | Call forwarding isn't available for your agency yet. Your settings are saved and apply once it's turned on. |
| Engine unknown | We couldn't confirm whether call forwarding is active for your agency. Your settings are saved either way. |

The two banner states are kept distinct on purpose: the existing rule (and its test) is that an **unconfirmed** engine is never reported as legacy. `data-testid="inbound-pending-activation"` and `data-engine` are preserved. No "Inbound Calling v2", "routing engine", "E.164", "Twilio", "presence" or "routing attempts" wording remains in the user-facing string set.

**Greeting audio URL — decision for approval.** Today the card exposes a raw `https://…/greeting.mp3` input with no upload path anywhere in the product, so a normal agent cannot produce a value for it. **Proposed (default): remove the input from the UI and preserve any stored value verbatim** — the loaded `voicemail_greeting_url` is held in state and written back unchanged on every save, so no existing row is nulled and backend greeting selection is bit-for-bit unaffected. Alternative if Chris prefers: keep it with plain wording ("Recorded greeting link (optional)"). *Chris decides; default is removal.*

**Two save buttons in one card** (Save Preferences → `profiles`; Save call forwarding → `agent_inbound_settings`) is deliberate: the two write different tables with different failure modes, and merging them would change persistence semantics. The call-forwarding button sits inside its own subsection and is disabled until that subsection is dirty.

Component size (AGENT_RULES §7): `ProfilePreferencesCard.tsx` is already 254 lines, so the notifications block is extracted too. Post-refactor targets: `ProfilePreferencesCard.tsx` ≈ 160, `ProfileCallForwardingSection.tsx` ≈ 175, `ProfileNotificationsSection.tsx` ≈ 70 — all under 200.

## 19.3 Change 2 — incoming ring outputs become fixed system behaviour

`ProfileRingtoneOutputCard` is deleted (device list, checkboxes, Refresh, Test ring, per-browser preference). `src/lib/ringtoneOutputs.ts` is refactored so runtime behaviour is unequivocally **every available output**:

- `computeRingtoneDeviceIds(available)` loses its preference parameter and returns all non-empty ids.
- `RingtoneOutputPref`, `DEFAULT_RINGTONE_OUTPUT_PREF`, `loadRingtoneOutputPref`, `saveRingtoneOutputPref` are **removed** — the stored preference is no longer read by any code path, so a legacy `{"mode":"selected"}` value in `localStorage` cannot restrict ringing.
- `applyRingtoneOutputs(device)` keeps its call shape and its two safety behaviours: output selection unsupported (Firefox/Safari) ⇒ `{ supported:false, applied:[] }`, never a throw, browser default rings; a sink id that vanishes between enumeration and `set()` ⇒ retry with every currently available output, and `[]` only if that also fails. Conversation/`speakerDevices` audio is still never written — outbound audio untouched.
- **Proposed (for approval):** a best-effort one-time `clearLegacyRingtoneOutputPref()` (try/catch, module-guarded, fired on the first apply) deletes the stale `agentflow_ringtone_outputs_v1` key so the dead preference cannot linger in agents' browsers. Purely cosmetic cleanup; say the word and it is dropped.
- `listAudioOutputs` and `testRingtoneOutputs` stay exported as troubleshooting helpers (used by the retained debug component in 19.4).

`TwilioContext.tsx` keeps both call sites verbatim; the only proposed edit there is a **two-line comment correction** (the `onDeviceChange` comment currently says "re-apply the saved preference", which will no longer be true). Comment-only, zero behaviour change, zero effect on the pinned source assertions — *flagged because the brief says not to touch TwilioContext unless necessary; recommend yes.* Twilio Device lifecycle, registration and presence are untouched.

## 19.4 Change 3 — diagnostics hidden, telemetry retained

`ConnectionDiagnostics` is removed from the `MyProfile` render. **The component file is kept** as internal/debug-only code with a header note saying it is intentionally not mounted — it is the only reader UI for the ring measurements and presence generations we will want during live inbound troubleshooting. **Nothing under the diagnostics infrastructure is deleted**: `src/lib/phonePresence.ts`, `phonePresenceClient.ts`, the presence writes/registration tracking, the P17 ring measurement in `TwilioContext`, and all logging stay exactly as they are. *Alternative if Chris prefers zero dead code: delete the component (recoverable from git) — default is keep-unmounted.*

## 19.5 Change 4 — copy cleanup (Preferences)

| Before | After |
|---|---|
| Preferences subtitle "Theme, notifications, and timezone" | "Appearance, notifications, call forwarding, and timezone" |
| "Dark Mode / Toggle between dark and light interface" | "Dark mode" (switch label carries the meaning) |
| "Alerts for missed calls, leads, wins, and messages while AgentFlow is hidden" | "Receive alerts while AgentFlow is in the background." |
| "Enabled — alerts fire when AgentFlow is hidden or in the background." | "Enabled." |
| "By default an incoming call rings on every audio output…this setting is per browser." | *(no user-facing setting at all)* |
| "When you are signed out, disconnected, or do not answer within 20 seconds…" | "Send unanswered calls to your mobile." |
| "Stored as E.164. Cannot be one of the agency's own AgentFlow numbers." | *(removed — inline validation error only when needed)* |

**Deliberately kept** (they help an agent act): the blocked-notifications recovery sentence ("allow notifications for this site in your browser's site settings, then toggle again"), the unsupported-browser state, the "Not yet connected" captions on the disabled Email/SMS toggles, and every save/validation error message. Validation moves to **Zod** with an inline field error ("Enter a valid mobile number." / "Keep your greeting under 500 characters."); the database loop-guard rejection (number equals one of the agency's own numbers) still surfaces its message.

## 19.6 Files to touch, and why

**Edit**
1. `src/components/settings/MyProfile.tsx` — drop the three imports/renders (Changes 1–3).
2. `src/components/settings/profile/ProfilePreferencesCard.tsx` — four named subsections, reordered, shortened copy, renders the two new sections (Changes 1, 4).
3. `src/lib/ringtoneOutputs.ts` — fixed all-outputs behaviour, preference machinery removed (Change 2).
4. `src/components/settings/profile/ConnectionDiagnostics.tsx` — header comment only: internal/debug-only, not mounted (Change 3).
5. `src/contexts/TwilioContext.tsx` — **comment only** (2 lines), see 19.3. Requires Chris's nod.
6. `docs/SETTINGS_LAYOUT.md` — My Profile bullet list now lists the Preferences subsections.
7. `WORK_LOG.md` — newest-first entry (AGENT_RULES §9).
8. `implementation_plan.md` — this section.

**New**
9. `src/components/settings/profile/ProfileCallForwardingSection.tsx` — the moved feature (same table, same fields, same impersonation guard).
10. `src/components/settings/profile/ProfileNotificationsSection.tsx` — extracted so the parent stays under 200 lines.

**Delete**
11. `src/components/settings/profile/ProfileInboundCard.tsx` — superseded by 9 (no duplicate write path).
12. `src/components/settings/profile/ProfileRingtoneOutputCard.tsx` — feature removed from the user UI.

**Tests**
13. `src/components/settings/profile/__tests__/profileCallForwardingSection.test.tsx` *(new)* — acceptance 4–9.
14. `src/components/settings/profile/__tests__/myProfileSurface.test.tsx` *(new)* — acceptance 1–3 (render + source contract).
15. `src/lib/__tests__/ringtoneOutputs.test.ts` *(rewrite)* — acceptance 10, 11 and the two fail-safe paths.
16. `src/lib/__tests__/twilioVoiceLifecycle.test.ts` *(one line)* — drops the preference argument at line 146; the vanished-sink fallback is still proven via `failNextSet`.
17. `src/contexts/__tests__/twilioProviderLifecycle.test.tsx` *(one line)* — removes `loadRingtoneOutputPref` from the module mock.
18. `src/components/settings/profile/__tests__/profileInboundCard.test.tsx` *(delete)* — replaced by 13, which carries its two banner-honesty cases forward.

**Not touched:** `RELEASE_READINESS.md` (a historical release record; the supersession is recorded in `WORK_LOG.md` instead — say if you want it amended), every Edge Function, every migration, `AgentStatusContext`, `phonePresence*`, `incomingCallAlerts`, `twilio-voice.ts`, and all routing/availability/voicemail code.

## 19.7 Tests and gates

New/updated assertions map 1:1 to the acceptance list: (1) no "Incoming ring outputs" in My Profile; (2) no "Phone connection diagnostics"; (3) no standalone "Inbound calls to your mobile" card; (4) Preferences shows "Call Forwarding"; (5) existing settings load; (6) mobile number persists (upsert payload asserted: table, `agent_id`, `organization_id`, normalized E.164); (7) toggle persists; (8) greeting persists **and an untouched stored greeting URL is written back unchanged**; (9) View As renders nothing and writes nothing; (10) all available outputs applied; (11) a pre-seeded legacy `selected` preference cannot narrow the applied set; plus unsupported-browser and unplugged-device fail-safes; (12) source contract — no diff under `supabase/`, and the `TwilioContext` ringtone call sites unchanged.

Gates to run before handoff: focused Vitest (`npx vitest run src/components/settings/profile src/lib/__tests__/ringtoneOutputs.test.ts src/lib/__tests__/inboundDeviceLifetime.test.ts src/lib/__tests__/twilioVoiceLifecycle.test.ts src/contexts/__tests__/twilioProviderLifecycle.test.tsx`), then the full `npm test`, `npx tsc --noEmit`, `npm run build`, `git diff --check`, and `git diff --stat -- supabase/` proving it is empty.

## 19.8 Risks

| Risk | Mitigation |
|---|---|
| A behaviour change leaks into routing | The diff touches only `src/components/settings/profile/*`, `MyProfile.tsx`, `src/lib/ringtoneOutputs.ts` and one comment in `TwilioContext.tsx`; an empty `supabase/` diff is a gate. |
| The pinned source assertions in `inboundDeviceLifetime.test.ts` break | Call sites kept byte-identical; that suite is in the focused run. |
| Call forwarding buried in a collapsed card | Preferences keeps its existing collapsible (no Settings redesign); the subsection is second-to-last with its own heading and divider. Say the word if you want Preferences open by default. |
| Agents lose a greeting URL they had set | The value is loaded, held and written back unchanged on every save, and a test pins that; the field is only hidden, never cleared. |

## 19.9 Open questions for Chris (all default-safe)

1. Remove the greeting **audio URL** input (default: yes, value preserved) or keep it with plain wording?
2. Keep `ConnectionDiagnostics.tsx` as unmounted debug-only code (default: yes) or delete it?
3. Allow the **comment-only** correction in `TwilioContext.tsx` (default: yes)?
4. Include the best-effort cleanup of the stale `agentflow_ringtone_outputs_v1` localStorage key (default: yes)?
5. Amend `RELEASE_READINESS.md`'s UI description (default: no — WORK_LOG records the supersession)?
