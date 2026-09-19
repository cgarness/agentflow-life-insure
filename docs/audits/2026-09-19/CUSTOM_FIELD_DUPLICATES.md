# Custom-Field Duplicate Audit — production `jncvvsvckxhqgqvkppmj`

**Date:** 2026-09-19 · **Author:** Custom-Field Canonicalization build · **Type:** READ-ONLY

> **NOTHING WAS MUTATED.** This audit was produced entirely with SELECT statements over MCP. No row was
> deleted, merged, renamed, deactivated or updated. No migration was applied. The duplicate rows
> described below are **still present and still active** — consolidating them is a separate project
> requiring Chris's own approval (§6).

> **POINT-IN-TIME SNAPSHOT.** Every count here is as of 2026-09-19. Re-run §5's queries before acting
> on any of it: references that are empty today may not be empty later.

---

## 1. Summary

| | |
|---|---|
| Normalized names with more than one active org-scoped definition | **10** |
| Physical rows in those groups | **25** |
| Organizations affected | **1** (`a0000000-0000-0000-0000-000000000001`, Family First Life - Chris Garness) |
| Scope of every affected row | **100% personal** (`organization_id` set, `created_by` set) |
| Active state of every affected row | **100% active** |
| Distinct creators involved | **3** (one Admin, two Agents) |
| Agency-wide definitions anywhere in production | **0** |
| References to these rows by UUID, anywhere | **0** |
| Contact rows whose JSONB would need rewriting to merge them | **0** (see §4) |

**Root cause.** `public.custom_fields` has exactly two unique indexes, both partial. The personal one
carries `created_by` **in the key**:

```sql
CREATE UNIQUE INDEX custom_fields_personal_lower_name_unique
  ON public.custom_fields USING btree (organization_id, created_by, lower(btrim(name)))
  WHERE ((organization_id IS NOT NULL) AND (created_by IS NOT NULL) AND (active IS TRUE));
```

N users in one organization may therefore each legally hold their own `Gender`. Nothing enforced an
organization-wide name namespace until `trg_custom_fields_logical_name_guard`.

**Why this was only visible to Admins.** `custom_fields_select` exposes another user's personal rows
only to an Admin or Super Admin. Each Agent's import mapper showed exactly one `Gender`; only the
Admin saw three. The duplicates were always real — the *symptom* was role-dependent.

---

## 2. The duplicate groups

Scope: `organization_id IS NOT NULL` (the only rows the mapper ever sees —
`customFieldsSupabaseApi.getAll` filters on `organization_id`).

| Normalized name | Rows | Raw spellings | Distinct creators | Distinct types | All active |
|---|---|---|---|---|---|
| `amt requested` | 3 | `Amt Requested` | 3 | **2** — Number, Text, Number | yes |
| `beneficiary` | 3 | `Beneficiary` | 3 | 1 | yes |
| `favorite hobby` | 3 | `Favorite Hobby` | 3 | 1 | yes |
| `gender` | 3 | `Gender` | 3 | 1 | yes |
| `have life insurance` | 3 | `Have Life Insurance` | 3 | 1 | yes |
| `ad` | 2 | `Ad` | 2 | 1 | yes |
| `date/time` | 2 | `Date/Time` | 2 | **2** — Text, Number | yes |
| `history of heart attack stroke cancer` | 2 | `History of Heart Attack Stroke Cancer` | 2 | 1 | yes |
| `interested in` | 2 | `Interested In` | 2 | 1 | yes |
| `status` | 2 | `Status` | 2 | 1 | yes |

**Every group shares ONE exact raw spelling.** No group needs a name decision — only a row decision.

**Two groups have divergent `type`** and are the only ones needing an explicit human choice at
consolidation time: `amt requested` (Number / Text / Number) and `date/time` (Text / Number).

---

## 3. Row-level detail

All rows: `organization_id = a0000000-0000-0000-0000-000000000001`, `applies_to = ["Leads"]`,
`required = false`, `active = true`, `default_value = ""`, `dropdown_options = []`.

`age_rank` is the order the approved representative rule would produce among personal rows
(oldest `created_at` first, then lowest `id`). No row in this table is agency-wide, so the rule's
first tier — agency beats personal — is not exercised by any current data.

| Normalized | id | Name | Type | `created_by` (email · role) | `created_at` | age_rank |
|---|---|---|---|---|---|---|
| `ad` | `ef8b8933-a95c-4d22-8306-a84854522213` | Ad | Text | cgarness.ffl@gmail.com · Admin | 2026-08-04 18:27:34Z | 1 |
| `ad` | `2ad2b194-4de6-4f0f-9a22-0f88abea4ed8` | Ad | Text | segura.solutions29@gmail.com · Agent | 2026-08-05 18:56:43Z | 2 |
| `amt requested` | `4de732e3-dfe5-4c50-820b-b7e8c61568dc` | Amt Requested | **Number** | cgarness.ffl@gmail.com · Admin | 2026-08-04 18:29:38Z | 1 |
| `amt requested` | `58113a45-de96-43a9-9fce-08fbceebec92` | Amt Requested | **Text** | chrisgarness702@gmail.com · Agent | 2026-08-05 16:04:52Z | 2 |
| `amt requested` | `52f293fd-1555-42e4-9105-1bbf89bba33a` | Amt Requested | **Number** | segura.solutions29@gmail.com · Agent | 2026-08-05 18:56:54Z | 3 |
| `beneficiary` | `ab72bf09-ef00-4b65-92b3-cff9754d66ad` | Beneficiary | Text | cgarness.ffl@gmail.com · Admin | 2026-08-04 18:30:53Z | 1 |
| `beneficiary` | `cc482290-21df-4661-9e6e-eed705ed5a26` | Beneficiary | Text | chrisgarness702@gmail.com · Agent | 2026-08-05 16:04:56Z | 2 |
| `beneficiary` | `ebb9dbad-8b0e-4717-a6a6-7363ae9a9070` | Beneficiary | Text | segura.solutions29@gmail.com · Agent | 2026-08-05 18:57:03Z | 3 |
| `date/time` | `9d29f985-975e-481b-85e2-86bdc01a970d` | Date/Time | **Text** | chrisgarness702@gmail.com · Agent | 2026-08-05 16:04:40Z | 1 |
| `date/time` | `509b7d2b-0c39-480d-9298-5a73db74ded9` | Date/Time | **Number** | segura.solutions29@gmail.com · Agent | 2026-08-05 18:56:22Z | 2 |
| `favorite hobby` | `fa1c8229-a34e-4aca-b949-234502b008a0` | Favorite Hobby | Text | cgarness.ffl@gmail.com · Admin | 2026-08-04 18:31:46Z | 1 |
| `favorite hobby` | `ce262cad-f1c9-43a1-abe0-3ad1dbcbf2f3` | Favorite Hobby | Text | chrisgarness702@gmail.com · Agent | 2026-08-05 16:05:17Z | 2 |
| `favorite hobby` | `f6c9119b-a8c7-4c8e-9080-c629b2810274` | Favorite Hobby | Text | segura.solutions29@gmail.com · Agent | 2026-08-05 18:57:53Z | 3 |
| `gender` | `c5481e46-ae6c-413b-bb3a-69306b9d74da` | Gender | Text | cgarness.ffl@gmail.com · Admin | 2026-08-04 18:31:30Z | 1 |
| `gender` | `93b8a966-2309-402d-a4f9-b65ef0b33209` | Gender | Text | chrisgarness702@gmail.com · Agent | 2026-08-05 16:05:05Z | 2 |
| `gender` | `b444cfee-9e05-4fc7-a04c-9a8cb5144511` | Gender | Text | segura.solutions29@gmail.com · Agent | 2026-08-05 18:57:41Z | 3 |
| `have life insurance` | `48da04c6-8355-4d8f-983e-156fa1fdfe4e` | Have Life Insurance | Text | cgarness.ffl@gmail.com · Admin | 2026-08-04 18:31:38Z | 1 |
| `have life insurance` | `74d8f03d-509b-46be-b99d-3efb2d4c7da4` | Have Life Insurance | Text | chrisgarness702@gmail.com · Agent | 2026-08-05 16:05:10Z | 2 |
| `have life insurance` | `d1b66beb-9b0f-43fb-a78f-dd7814670e09` | Have Life Insurance | Text | segura.solutions29@gmail.com · Agent | 2026-08-05 18:57:35Z | 3 |
| `history of heart attack…` | `5eedf4c7-9502-4004-922c-adbcba714f7d` | History of Heart Attack Stroke Cancer | Text | cgarness.ffl@gmail.com · Admin | 2026-08-05 17:16:53Z | 1 |
| `history of heart attack…` | `8fe16adb-944e-4708-8921-d624b638986a` | History of Heart Attack Stroke Cancer | Text | segura.solutions29@gmail.com · Agent | 2026-08-05 18:57:46Z | 2 |
| `interested in` | `c00eb656-d5e2-4e20-ba6b-fb43a7db1955` | Interested In | Text | cgarness.ffl@gmail.com · Admin | 2026-08-04 18:31:57Z | 1 |
| `interested in` | `c5515905-cb86-405c-a3a4-282b33fbe70f` | Interested In | Text | segura.solutions29@gmail.com · Agent | 2026-08-14 17:20:35Z | 2 |
| `status` | `e6c1da77-e64b-4f21-ae8a-7a0be0c6937b` | Status | Text | cgarness.ffl@gmail.com · Admin | 2026-08-04 18:29:26Z | 1 |
| `status` | `bb439d54-6539-48ee-9353-04ea48f69317` | Status | Text | segura.solutions29@gmail.com · Agent | 2026-08-05 18:57:24Z | 2 |

### Wider inventory (context, not duplicates)

| Owner | Rows | Distinct normalized names | Agency-wide | Personal | Inactive |
|---|---|---|---|---|---|
| Family First Life - Chris Garness | 36 | 21 | 0 | 36 | 0 |
| Jayvion's Agency | 3 | 3 | 0 | 3 | 0 |
| System templates (`organization_id IS NULL`) | 72 | 32 | — | — | 0 |

The 72 system templates contain their own historical duplicates (72 rows / 32 names). They are
**out of scope in every sense**: `getAll` filters them out by `organization_id`, so they never reach
the mapper; `custom_fields_insert` requires `organization_id IS NOT NULL`, so the app cannot create
them; and the guard skips `organization_id IS NULL` entirely.

---

## 4. Reference audit — what a consolidation would have to rewrite

### 4.1 The four identifier forms

`custom:` is **overloaded** — it prefixes two different payloads. Any consolidation must treat them
separately.

| # | Form | Where it lives | Persisted? | Orphaned by a merge/rename? |
|---|---|---|---|---|
| 1 | **UUID** `custom_fields.id`, as `custom:<uuid>` | mapper option value (`import-field-matching.ts`), consumed in `ImportLeadsModal.tsx` | **No** — session state only | No |
| 2 | **Canonical NAME** as a JSONB key | `leads/clients/recruits.custom_fields` | **Yes** — the real persistence layer | **Yes, silently** |
| 3 | **`custom:<NAME>`** layout id | encoded `ContactManagement.tsx:1618`; decoded `contactFieldLayout.ts:128-132`, `FullScreenContactView.tsx:1037-1039`; stored in `user_preferences.settings.contact_field_layout` and `contact_management_settings.field_order_{lead,client,recruit}` | **Yes** | **Yes, silently** |
| 4 | **Workflow `field_name`** (raw name) | `workflows.trigger_config` JSONB; read by `workflow-time-based-trigger/index.ts:261` and matched in `get_active_workflows_for_trigger` | **Yes** | **Yes, silently** |

Two further facts:

- **No foreign key anywhere references `custom_fields.id`** (`rg 'REFERENCES "public"."custom_fields"'` → no hits). Deleting a row breaks no referential constraint — which is precisely why a merge must be reasoned about by hand rather than trusted to the database.
- `workflow-executor`'s `custom_field_key` condition branch (`ConditionConfigPanel.tsx:136`, `workflow-types.ts:395`) has **no consumer** — `workflow-executor/index.ts:338-348` only does `contact[field]`, so `custom_field` conditions always evaluate null. Dead form; nothing to migrate.

### 4.2 Live reference counts (2026-09-19)

Every JSONB/config store in `public` swept for the 25 duplicate UUIDs and for the `custom:` prefix:

| Store | Duplicate-UUID hits | Contains `custom:` |
|---|---|---|
| `workflow_nodes.config` | 0 | no |
| `workflows.trigger_config` | 0 | no |
| `saved_reports.config` | 0 | no |
| `report_layouts.layout` | 0 | no |
| `scheduled_reports.report_sections` | 0 | no |
| `user_preferences.settings` | 0 | no |
| `contact_management_settings.field_order_{lead,client,recruit}` | 0 | no |
| `contact_management_settings.required_fields_*` | 0 | no |
| `campaigns.queue_filters` | 0 | no |
| `import_history.import_completion_metadata` | 0 | no |
| `activity_logs.metadata` | 0 | no |
| `notifications.metadata` | 0 | no |

**Zero references of forms 1, 3 and 4 exist in production today.**

### 4.3 Contact values — populated, but requiring no rewrite

| Canonical name | `leads` rows with the key | `clients` | `recruits` |
|---|---|---|---|
| Amt Requested | 534 | 2 | 0 |
| Gender | 512 | 2 | 0 |
| History of Heart Attack Stroke Cancer | 463 | 2 | 0 |
| Beneficiary | 459 | 2 | 0 |
| Favorite Hobby | 455 | 2 | 0 |
| Have Life Insurance | 442 | 2 | 0 |
| Ad | 436 | 2 | 0 |
| Interested In | 389 | 1 | 0 |
| Status | 288 | 2 | 0 |
| Date/Time | 246 | 2 | 0 |

**The single most important consolidation finding.** These JSONB objects are keyed by **NAME**, and
every duplicate group shares one exact spelling. Merging the definition rows therefore requires
**no contact-data rewrite whatsoever** — ~4,200 lead rows keep working untouched. A consolidation is
a `custom_fields`-only operation.

Reserved non-field keys sharing that JSONB namespace, which any cleanup or guard must exempt:
`tags`, `Full Name`, `__agentflow`, `additional_policies` (`supabase-conversion.ts:26`).

### 4.4 Writers and readers of the name-keyed JSONB

**Writers** — `ImportLeadsModal.tsx:1015`, `supabase-contacts.ts:172,456`, `supabase-leads.ts:50`,
`supabase-clients.ts:136,265`, `supabase-recruits.ts:128,146`, `DialerPage.tsx:4063-4077,4109`,
`supabase-conversion.ts:32-44`, `import-contacts/index.ts:266-321`, and the DB-side
`convert_lead_to_client_atomic` RPC (`20260812042319:117-132`).

**Readers** — `supabase-contacts.ts:407`, `supabase-clients.ts:234`, `supabase-recruits.ts:202`,
`DialerPage.tsx:228,4054`, `FullScreenContactView.tsx:1045,1116-1134`, `contactRequiredFields.ts:129`,
`workflow-time-based-trigger/index.ts:261`.

**`import-contacts` never queries `custom_fields`** — it copies `row.customFields` verbatim into the
JSONB column. The only name validation on that path is client-side
(`import-campaign-schemas.ts:275-303`).

### 4.5 Server-side writers of the definitions table

There is **no** server-side INSERT into `public.custom_fields` — no seed, no org-provisioning clone,
no RPC (`grep -rniE "INSERT INTO (public\.)?\"?custom_fields\"?" supabase/` → zero hits across all
migrations and edge functions). The only server-side statement against it is
`wipe_organization_operational_data` (`baseline:6465`), which DELETEs an organization's rows.
Consequence for the guard: it has **no privileged writer to exempt**.

---

## 5. Re-validation queries

Run these read-only before any consolidation action.

```sql
-- 5.1 Current duplicate groups (org-scoped).
SELECT organization_id,
       lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) AS normalized_name,
       count(*) AS physical_rows,
       count(*) FILTER (WHERE active)          AS active_rows,
       count(*) FILTER (WHERE created_by IS NULL) AS agency_rows,
       count(DISTINCT created_by)              AS distinct_creators,
       count(DISTINCT name)                    AS distinct_spellings,
       count(DISTINCT type)                    AS distinct_types
  FROM public.custom_fields
 WHERE organization_id IS NOT NULL
 GROUP BY 1, 2
HAVING count(*) > 1
 ORDER BY physical_rows DESC, normalized_name;

-- 5.2 Does any store still reference a duplicate UUID? (Extend the probe list if the schema grows.)
--     Expect zero hits, as of 2026-09-19.

-- 5.3 Would a merge need a contact-data rewrite? Expect distinct_spellings = 1 for every group;
--     any group > 1 requires a JSONB key migration and must be planned separately.

-- 5.4 Post-consolidation assertion: no contact JSONB key lost its definition.
SELECT DISTINCT k
  FROM public.leads l, jsonb_object_keys(l.custom_fields) k
 WHERE l.organization_id = :org
   AND k NOT IN ('tags','Full Name','__agentflow','additional_policies')
   AND NOT EXISTS (
     SELECT 1 FROM public.custom_fields cf
      WHERE cf.organization_id = l.organization_id
        AND cf.active
        AND lower(btrim(regexp_replace(cf.name, '\s+', ' ', 'g')))
          = lower(btrim(regexp_replace(k,       '\s+', ' ', 'g')))
   );
```

---

## 6. Proposed follow-on project — "Custom Field Duplicate Consolidation"

**Not part of this build. Requires its own plan and Chris's own exact approval. No destructive
production action without it.**

**6.1 Preconditions.** The forward guard (`20260919010000`) must be **applied** first, so the cleaned
state cannot immediately re-dirty. §5's queries must be re-run — this audit is a snapshot.

**6.2 Canonical-row selection.** The same rule the mapper uses, per group:

1. agency-wide (`created_by IS NULL`) over personal;
2. then oldest `created_at`;
3. then lowest `id`.

The two divergent-`type` groups — `amt requested` and `date/time` — are decided **by Chris
explicitly**, not by the rule. Every other group is unambiguous.

**6.3 Reference rewrites.** Provably **none** today: 0 UUID references, 0 `custom:<name>` layout
entries, 0 workflow configs, and every group shares one spelling so no contact JSONB changes. This
must be **re-proven at execution time, not assumed**.

**6.4 Prefer non-destructive.** Set `active = false` on non-canonical rows rather than `DELETE`,
per invariant #28's archival preference. A soft retire is fully reversible and leaves the audit trail
intact; a delete is neither. Note that deactivating rows is safe under the guard's lenient
re-activation semantics, so a mistake can be undone — but re-activating two rows of one name is also
still possible, so the cleanup must not be considered self-enforcing.

**6.5 Rollback / recovery.** A full pre-change `custom_fields` export, **proven** per invariant #29
before a single row changes: checksum-verified, re-parsed by the exact mechanism a recovery would
use, and compared full-row in **both** directions against the still-unchanged live source, with zero
differences. Validating the live table proves nothing about the artifact.

**6.6 Validation.** Before/after row counts per normalized name; §5.4 returning zero rows; a re-run
of the §4.2 sweep; and a spot-check that the mapper still offers one option per name.

**6.7 Explicit non-goals.** Renaming any field (there is no rename propagation — invariant #27);
changing the JSONB storage model; widening `custom_fields` RLS.

---

## 7. Related open item

**CUSTOM FIELD OWNERSHIP / VISIBILITY CANONICALIZATION** — a separate architecture decision, recorded
during this build and deliberately not taken here.

The name namespace is now organization-wide while ownership stays per-row, and
`custom_fields_select` still hides another user's personal definitions. An Agent who tries to create
a field whose name another Agent already owns is therefore refused and — correctly — **is not given a
mapping**, because importing by name would write values into a definition they could never resolve
through the normal contact-field read path (`FullScreenContactView` renders from
`customFieldsSupabaseApi.getAll`). The import mapper fails closed and tells them to ask an Admin.

That is an intentional temporary limitation of the personal-field visibility model, not a bug in the
guard. The decision to take later: should custom fields become **agency-schema definitions readable
by every agency user, with management still permission-controlled**? That would resolve the
limitation at its root. It is not attempted here, and `custom_fields` RLS was not widened.
