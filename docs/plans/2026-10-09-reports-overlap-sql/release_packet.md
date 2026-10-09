# Reports overlap-seconds correction (R-3) — PR-B release packet

**Status: files approved; NOT merged and NOT applied.** Chris's plan approval covers adding these files on branch `claude/reports-overlap-sql-20261009` (base `main` `8d53531d0edc509cc97fdc49a06c4873438ca67d`). Applying the three production migrations, and any rollback, each needs Chris's separate exact approval (AGENT_RULES #28/#41).

**Merge rule: this PR merges only in the same approved window as the production apply, never before it.** `supabase/ops/reports_integrity_enable.sql` is the documented #41 recovery source. If its corrected pin reached `main` while production still runs the old body, an emergency re-enable from `main` would refuse and leave Reports disabled. If the apply is not approved, or it refuses at step 2, this PR stays unmerged.

Source plan: `docs/plans/2026-10-09-reports-refresh-audit/implementation_plan.md` (§4.2, §7.3, §8) on branch `claude/reports-refresh-audit-20261009` @ `fb837372c742978066456898618fd66e33ed4a7e`, file sha256 `a8864a3b9b2517b1ff67aacf154efd242d02c686df94e217e35a623171618989`. §6 below copies its release order and failure handling verbatim.

No RLS policy, grant, table data, Edge Function, frontend file or workflow is changed by this PR.

## 1. Finding

`quality.sessions.overlap_seconds_removed` reports 1–5 duplicate seconds when no sessions overlap. Production (read-only, agency): W1 3, W2 4, W3 2, W4 1, W5 5, all with `overlapping_rows` 0. The Reports page and every CSV print, for example, "0 overlapping rows; 3 duplicate seconds removed."

**Root cause:** `supabase/migrations/20261006043731_reports_integrity_readers.sql:348-349` computes `floor(Σ every agent's raw spans) − Σ report_session_seconds`, and `report_session_seconds` returns `floor(Σ union)` per agent. Subtracting N per-agent floors from one grand-total floor leaves 0 to N−1 seconds of residue even with zero overlap.

**Correction:** sum each agent's exact (microsecond `numeric`) raw-minus-union difference and floor once. With no overlapping rows the result is exactly 0. With overlap it is the true duplicate time floored once: never negative, at most 1 s low in total. The union is the same `range_agg(tstzrange(span_start,span_end,'[)'))` construction `report_session_seconds` uses, over the already-materialized `s` session facts.

| Fixture window | Exact removed | Current body | Corrected body |
|---|---|---|---|
| No overlap, 3 agents (10-02) | 0 | 2 | **0** |
| Partial overlap + exact duplicate (10-04) | 1,810.75 | 1,811 | **1,810** |
| Sub-second overlap (10-05) | 0.4 | 1 | **0** |
| Four days (10-02..10-05) | 1,811.15 | 1,813 | **1,811** |

**Unchanged:** signature, `RETURNS jsonb`, `LANGUAGE sql`, `STABLE`, SECURITY INVOKER, owner `postgres`, `search_path=pg_catalog, pg_temp`, ACL `{postgres=X/postgres}`. `private.report_session_facts` and `private.report_session_seconds` are not touched, so every session total, by-agent value and the late-ended-session rule stay the same.

## 2. Exact diff

### 2.1 `private.report_integrity_quality` body (md5 `d330c5bea75fb160a0f55e72ed2fe191` → `c1355d551fba0cc2217150f5531d1b31`)

The only change inside the function, preimage `20261006043731_reports_integrity_readers.sql` vs `20261009170100_reports_integrity_quality_overlap_seconds.sql`:

```diff
@@ -29,3 +29,5 @@
        AND other.span_end>other.span_start AND other.span_start<s.span_end AND other.span_end>s.span_start)),
-    'overlap_seconds_removed',greatest(0,(SELECT coalesce(floor(sum(extract(epoch FROM span_end-span_start))),0) FROM s WHERE span_end>span_start)
-      -(SELECT coalesce(sum(session_seconds),0) FROM private.report_session_seconds(p_org,p_start,p_end,p_agents)))));
+    'overlap_seconds_removed',greatest(0,(SELECT coalesce(floor(sum(u.raw_seconds-u.union_seconds)),0) FROM (
+      SELECT g.raw_seconds,(SELECT sum(extract(epoch FROM upper(r)-lower(r))) FROM unnest(g.spans) r) union_seconds
+      FROM (SELECT sum(extract(epoch FROM s.span_end-s.span_start)) raw_seconds,range_agg(tstzrange(s.span_start,s.span_end,'[)')) spans
+            FROM s WHERE s.span_end>s.span_start GROUP BY s.agent_id) g) u))));
```

### 2.2 `supabase/ops/reports_integrity_enable.sql` (line 11 only; file sha256 `a5433ce8…98a32` → `d1698e45…a653`)

```diff
@@ -8,7 +8,7 @@ DO $enable$ DECLARE f record; sig text; client_role text; expected_execute boole
   ('private.report_session_seconds(uuid,timestamptz,timestamptz,uuid[])','3d33b720751a1913c81ad284ae6ffd43',true,'s'),
   ('private.report_call_facts(uuid,timestamp with time zone,timestamp with time zone,uuid[])','bacbfd0629221957cae28ba28728c8bd',true,'s'),
   ('public.get_report_call_summary(date,date,uuid)','34cdfab92f6acaa5a383c743088c1720',true,'s'),
-  ('private.report_integrity_quality(uuid,timestamptz,timestamptz,uuid[])','d330c5bea75fb160a0f55e72ed2fe191',false,'s'),
+  ('private.report_integrity_quality(uuid,timestamptz,timestamptz,uuid[])','c1355d551fba0cc2217150f5531d1b31',false,'s'),
   ('private.report_access_v2(text,uuid)','a221335ae305cee01097bc796d5e7cdd',true,'s'),
   ('private.report_monthly_amount(text)','405647c4982f4b9475f834efa6f2beee',false,'i'),
   ('private.report_policy_value_facts(uuid,uuid[])','f543eeb4ee5aa7906e3225527d873935',false,'s'),
```

The other fourteen pins, the grant loop and the effective-privilege assertions are byte-identical to `main`.

### 2.3 `scripts/reports_integrity_fixture.py`

- New `migration(suffix)` helper: finds a migration by its unique suffix, so the post-apply version rename needs no other edit.
- The historical steps now read the applied `20261006044003_reports_integrity_release_enable.sql` (old pins), because the ops enable now carries the corrected pin. With only the pin changed and the fixture unchanged, the suite fails at "new enable rejects inherited legacy grants".
- Asserts the release disable equals `supabase/ops/reports_disable.sql` and the release enable equals `supabase/ops/reports_integrity_enable.sql`, byte for byte.
- Adds 18 steps after the scale step (listed in §4.2).

The full diff is in the commit (`git diff origin/main -- scripts/reports_integrity_fixture.py`: 31 insertions, 1 deletion).

## 3. Files and hashes

| # | File | New / modified | Bytes | SHA-256 |
|---|---|---|---|---|
| 1 | `supabase/migrations/20261009170000_reports_overlap_release_disable.sql` | new | 3,883 | `17141977ba6480f8e99153665e185385e3f6ef203b122efdf67947a62d5079b2` |
| 2 | `supabase/migrations/20261009170100_reports_integrity_quality_overlap_seconds.sql` | new | 7,295 | `23288ee886e0cf6c487c54e47ce8783ec3a043f62d4fc99ed0c4c6aad57b726f` |
| 3 | `supabase/migrations/20261009170200_reports_overlap_release_enable.sql` | new | 4,503 | `d1698e45ecd7e068893f40841428c6fcc1fce7a1c57aa0abf796acfdde61a653` |
| 4 | `supabase/migrations/rollback/20261009170100_reports_integrity_quality_overlap_seconds.rollback.sql` | new | 6,717 | `0f066b8fbca71b783d713b5fbf332e951f9ad999fbdc7bd185500973f98de470` |
| 5 | `supabase/tests/reports_integrity_overlap_fixture.sql` | new | 6,156 | `7eec2b4fdb5ce21eaddf4ed14eea695a06094ffd7e33206fb0051eed563284f5` |
| 6 | `supabase/tests/reports_integrity_overlap.sql` | new | 5,108 | `bc5dd082b296b9d3561b3596abdbb9455d346b7a71d760726714f8489d0eabea` |
| 7 | `supabase/ops/reports_integrity_enable.sql` | modified (line 11) | 4,503 | `d1698e45ecd7e068893f40841428c6fcc1fce7a1c57aa0abf796acfdde61a653` (was `a5433ce838eec87b338c9b3a79cfc939e2fdfb30ac232a4d948227522ae98a32`) |
| 8 | `scripts/reports_integrity_fixture.py` | modified | 11,761 | `06a6dee3ebbdbb3213fc178427395e64e0cad02a62624d0df5783e754c123c16` |

**Byte equalities verified on this branch:**
- File 1 == `supabase/ops/reports_disable.sql` (unchanged on `main`; sha256 `17141977…5079b2`).
- File 3 == file 7, the updated ops enable (sha256 `d1698e45…a653`).
- File 7 differs from `main` only at line 11.
- File 2's function body md5 is `c1355d551fba0cc2217150f5531d1b31`, computed from the file text and confirmed by the guard and postcondition running on PostgreSQL.
- File 4's function body is byte-identical to the `20261006043731` preimage (md5 `d330c5bea75fb160a0f55e72ed2fe191`).
- All eight files match the locally proven candidates byte for byte.

**Guards in file 2, in order:**
1. Replay: refuses if the reader's md5 is already `c1355d55…`.
2. Exact preimage of the reader **and** its two dependencies: `report_session_facts` `245c7ce4f7bf47f6347595822f70a947` (INVOKER) and `report_session_seconds` `3d33b720751a1913c81ad284ae6ffd43` (DEFINER). This covers owner, SECURITY mode, volatility, `search_path` and exact `proacl={postgres=X/postgres}`.
3. Reports-only disabled window: refuses if anon or authenticated can execute any `private.report_%`, `public.get_report_%` or `public.rpc_report_%`.

The postcondition checks the new md5, owner, INVOKER, `STABLE`, `prorettype=jsonb`, `search_path`, exact ACL, and that anon, authenticated and service_role have no EXECUTE.

File 4 mirrors these guards with the md5s swapped and restores the byte-identical preimage text.

**CI triggers:** all eight files match `reports-backend.yml` globs (`supabase/migrations/*reports*.sql`, `rollback/*reports*.sql`, `supabase/ops/reports_*.sql`, `supabase/tests/reports_*.sql`, the fixture). `reporting-integrity`, `reports-frontend`, `dialer-dnc-backend` and `sms-consent` are triggered by `supabase/**` paths. No workflow file changes.

## 4. Local evidence

Disposable PostgreSQL 16.15 at 127.0.0.1:55463 (loopback TCP only, trust auth, own data directory). The suites ran from this branch's working tree with the eight files in place. No hosted database was contacted. The cluster was stopped afterwards.

### 4.1 Suites

| Command | Result |
|---|---|
| `PGURL=postgresql://postgres@127.0.0.1:55463 bash scripts/run_reports_integrity_tests.sh` | **PASS**, exit 0: every original step plus the 18 new steps; "All native Reports integrity semantics, controls and recovery proofs passed." |
| `PGURL=… bash scripts/run_reports_rpc_tests.sh` | **PASS**, exit 0: "ALL REPORTS RPC PROOFS PASSED (suite + 6 negative controls + drift + replay + disable/enable + rollback) AND POLICY PROOFS" |
| `PGURL=… bash scripts/run_profile_rpc_tests.sh` | **PASS**, exit 0: "ALL PROFILE RPC PROOFS PASSED (suite + negative control + rollback)" |
| `env -u PGHOST -u PGDATABASE PGURL=postgres://postgres@127.0.0.1:55463 bash scripts/run_reporting_integrity_tests.sh` | **PASS**, exit 0: 50,000-row indexed fixture; native policy and booking SQL, permissions and independent-session contention |

The regenerated `reports-integrity-payloads.json` (sha256 `f7f3f7cf9d91fffc794d6e10d19e693f31bab5471ab6dd0c2d05b5548f08963a`; not committed) equals the `main` baseline payload, except for `as_of` and `scope.today`, which reflect the generation date (2026-10-08 → 2026-10-09). The browser gate's input is therefore unchanged.

### 4.2 The 18 new integrity steps (all passed)

1. Overlap fixture and 60-payload preimage.
2. Correction refuses an enabled Reports surface (seal unchanged).
3. Correction refuses reader SECURITY drift.
4. Correction refuses reader ACL drift (GRANT to service_role).
5. Correction refuses session-reader drift.
6. Corrected enable refuses the uncorrected reader.
7. Release disable seals Reports only.
8. Correction applies in the disabled window (md5 `c1355d55…`).
9. Correction replay refuses.
10. Historical `20261006044003` enable refuses the corrected reader.
11. Corrected enable refuses `search_path` drift.
12. Corrected enable refuses inherited legacy grants.
13. Corrected enable restores only verified v2 (`assert_sealed(true)`), with the source fingerprint unchanged and the 60-payload comparison.
14. Assertions and negative controls.
15. Rollback refuses an enabled Reports surface.
16. Rollback refuses reader drift.
17. Rollback restores the exact preimage, only while disabled (proof transaction).
18. Corrected reader retained after the rollback proof.

### 4.3 60-payload identity and the 20 corrected values

The fixture snapshots 60 payloads, before and after the correction: five quality-bearing v2 RPCs × 12 cases. The cases are five fractional windows, an agent filter, integrity agency and personal, the 50,000-call scale org, and O1 Admin agency, Team Leader team and Agent personal.

Output of step 13: `overlap compare: 60 payloads, 60 identical outside overlap_seconds_removed, 20 corrected`. The 20 corrected values are exactly these:

| RPC | 10-02 | 10-04 | 10-05 | 10-02..10-05 |
|---|---|---|---|---|
| `get_report_call_summary_v2` | 2 → 0 | 1811 → 1810 | 1 → 0 | 1813 → 1811 |
| `get_report_call_volume_v2` | 2 → 0 | 1811 → 1810 | 1 → 0 | 1813 → 1811 |
| `get_report_disposition_breakdown_v2` | 2 → 0 | 1811 → 1810 | 1 → 0 | 1813 → 1811 |
| `get_report_campaign_performance_v2` | 2 → 0 | 1811 → 1810 | 1 → 0 | 1813 → 1811 |
| `get_report_lead_source_performance_v2` | 2 → 0 | 1811 → 1810 | 1 → 0 | 1813 → 1811 |

The other 40 payloads, and every field other than `overlap_seconds_removed` (and `as_of`) in all 60, are identical.

### 4.4 Assertions (`supabase/tests/reports_integrity_overlap.sql`)

- **Fixture-residue guard:** the old two-second residue is reproduced on 10-02.
- **10-02, no overlap, fractional spans:** `overlapping_rows` 0, removed 0, session seconds 2175. By agent: 630, 1500 (adjacent pair) and 45 (clipped at agency midnight).
- **10-03:** clipped remainder 1800, removed 0.
- **10-04:** overlapping rows 5, removed 1810, union 4520. By agent: 4500 and 20.
- **10-05:** sub-second overlap, rows 2, removed 0, union 9.
- **Agent filter (10-04, agent two):** rows 3, removed 11, union 20.
- **Multi-day 10-02..10-05, on all five RPCs:** rows 7, removed 1811. Union 8506; by agent 5130, 1521 and 1855.

### 4.5 Negative controls

"Reports overlap correction assertions and three negative controls passed." Each `rt.reject_mutation` control swaps one expression and confirms an assertion trips, then confirms the function was restored:

1. The previous expression, restored on top of the corrected body: 10-02 removed must be 0, and it fails.
2. A per-agent-floor variant `sum(floor(raw)−floor(union))`: four-day removed must be 1811, and it fails.
3. An unclipped session end (`least(p_end,now(),` → `least(now(),` in `report_session_facts`): 10-02 session seconds must be 2175, and it fails.

### 4.6 Rollback proof

The rollback refuses while Reports are enabled, and refuses on reader drift.

The proof runs inside a transaction that is deliberately rolled back. In order, it shows that:
1. Release disable runs.
2. The rollback restores md5 `d330c5bea75fb160a0f55e72ed2fe191`.
3. A rollback replay refuses ("refusing replay").
4. The corrected ops enable refuses the restored body ("unverified body") and Reports stay sealed.
5. The historical `20261006044003` enable re-enables v2.
6. `overlap compare: 60 payloads, 60 identical outside overlap_seconds_removed, 0 corrected` shows all 60 payloads equal the preimage exactly.

Afterwards, the corrected reader `c1355d55…` is retained, v2 stays enabled, and the source fingerprint is unchanged.

## 5. Production read-only expectation

The evidence is a production read-only SELECT and database-role simulation inside `begin read only … rollback`, on PostgreSQL 17.6 at as_of 2026-10-09 14:41–15:01 UTC. The full corrected body was executed inline as a SELECT, beside the deployed function, for the agency scope:

| Window | session_seconds | overlapping_rows | Removed now | Removed after apply | Other quality fields |
|---|---|---|---|---|---|
| W1 2026-10-01..10-07 | 95,862 | 0 | 3 | **0** | identical |
| W2 2026-09-01..09-30 | 417,083 | 0 | 4 | **0** | identical |
| W3 2026-09-08..10-07 | 396,827 | 0 | 2 | **0** | identical |
| W4 2026-10-06 | 6,460 | 0 | 1 | **0** | identical |
| W5 2025-10-08..2026-10-07 | 809,767 | 0 | 5 | **0** | identical |

Expected read-back after step 4:
- The W1–W5 role simulation (Chris, agency) shows `overlap_seconds_removed` **3/4/2/1/5 → 0** on all five quality-bearing RPCs.
- **Session seconds are unchanged:** 95,862 / 417,083 / 396,827 / 6,460 / 809,767.
- The Team Leader team and Agent personal scopes are already 0 and stay 0.
- The live reader md5 is `c1355d55…` with ACL `{postgres=X/postgres}`.
- Fifteen pins match, only the six v2 RPCs grant authenticated/service_role, and anon is denied on all 34.

The catalog preflight on the same date showed:
- Reader md5 `d330c5…`, deps `245c7ce4…`/`3d33b720…`.
- 34 Reports functions, 6 client-executable.
- No migration after `20261008151523`.
- Replay guard 0 and preimage guards 3/3 pass. The disabled-window guard refuses now, by design.

## 6. Release order and failure handling (verbatim from implementation_plan.md §8)

**Release order** (AGENT_RULES #41 pattern; each step read back):

| Step | Action | Expect |
|---|---|---|
| 0 | Exact-head CI green on PR-B: reports-backend (native PG 17.6 + browser), reports-frontend, reporting-integrity, **dialer-dnc-backend** and **sms-consent** (both triggered by `supabase/**` paths). Read-only preflight of the 34 functions, the 15 pins, effective grants (incl. inheritance) and the replay check. **Security advisor category counts recorded** (as in the Oct 6 release). | all gates pass; preflight shows only the quality pin pending |
| 1 | Disable | 0 client-executable Reports functions; Reports shows "temporarily unavailable" for about 1–2 minutes |
| 2 | Correction | new md5, unchanged ACL |
| 3 | Guarded enable | fifteen pins; grants only on the six v2 functions; anon denied on all 34 |
| 4 | Read-back; merge PR-B in the same window | W1–W5 role simulation shows 0 removed seconds and unchanged session seconds; advisor counts unchanged; the merged ops enable equals the live pins |

**If a step fails:**
- **Step 2 refuses** (nothing changed): re-enable with the exact `20261006044003` bytes as a new migration. Do not merge PR-B.
- **Step 3 refuses:** Reports stays disabled, which fails closed.
  - A lock timeout: re-run step 3.
  - Otherwise, investigate the cause: one of the 14 shared pins or inherited grants. Step 2's postcondition has already proven the corrected body, so **rolling it back is not a remedy for a step-3 refusal**. The historical enable shares those 14 pins and the same grant loop, so it would refuse for the same reasons.
  - Rollback is only for an owner-decided reversal of the fix.
- **Reversal (separate exact approval):**
  1. Disable.
  2. Apply the rollback (restores preimage `d330c5…` while disabled).
  3. Re-enable with the `20261006044003` bytes.
  4. **Revert the repo side in the same change:** the ops pin line 11 and the fixture's corrected-state steps, so `main`'s recovery source again matches production.

**Approvals:** adding the files is covered by plan approval. **Applying them, and any rollback, needs Chris's separate exact approval** (#28/#41). No RLS change, data write or Edge change is involved.

### Step-to-file mapping (this branch)

| Step | `apply_migration` name | Exact bytes |
|---|---|---|
| 1 | `reports_overlap_release_disable` | `supabase/migrations/20261009170000_reports_overlap_release_disable.sql` (== `supabase/ops/reports_disable.sql`) |
| 2 | `reports_integrity_quality_overlap_seconds` | `supabase/migrations/20261009170100_reports_integrity_quality_overlap_seconds.sql` |
| 3 | `reports_overlap_release_enable` | `supabase/migrations/20261009170200_reports_overlap_release_enable.sql` (== `supabase/ops/reports_integrity_enable.sql`) |
| Reversal 2 | `reports_integrity_quality_overlap_seconds_rollback` | `supabase/migrations/rollback/20261009170100_reports_integrity_quality_overlap_seconds.rollback.sql` |
| Recovery re-enable (step-2 refusal, reversal 3) | a new name | exact bytes of `supabase/migrations/20261006044003_reports_integrity_release_enable.sql` |

Authored versions `20261009170000/100/200` sort after production's newest recorded version, `20261008151523`. Production assigns the real versions at apply time.

## 7. After a successful apply

1. **Rename all four files to the recorded production versions, including the rollback file**, on this branch before the merge, per the established #41 practice, with identical SQL bytes:
   - `supabase/migrations/<v1>_reports_overlap_release_disable.sql`
   - `supabase/migrations/<v2>_reports_integrity_quality_overlap_seconds.sql`
   - `supabase/migrations/<v3>_reports_overlap_release_enable.sql`
   - `supabase/migrations/rollback/<v2>_reports_integrity_quality_overlap_seconds.rollback.sql`

   `scripts/reports_integrity_fixture.py` finds each file by suffix, so the rename needs no other edit. Re-run `run_reports_integrity_tests.sh` after the rename.
2. Merge PR-B in the same window (step 4), once the merged ops enable equals the live pins.
3. Record a production-release note next to this packet: recorded versions, readback values, advisor counts and CI run IDs.
   - Amend AGENT_RULES #41: the new `report_integrity_quality` pin `c1355d55…`; still fifteen pins.
   - Add a WORK_LOG entry, newest first.
4. Leave `docs/plans/2026-10-05-reports-integrity/source_manifest.json` and `production-release.md` unchanged. They are the historical record of the Oct 6 release.

## 8. Repo-side revert on reversal

If Chris approves a reversal (§6 "Reversal"), the same change that applies the rollback and the `20261006044003`-bytes re-enable must also revert the repo side, so that `main`'s recovery source again matches production:
- Restore `supabase/ops/reports_integrity_enable.sql` line 11 to `d330c5bea75fb160a0f55e72ed2fe191` (file sha256 `a5433ce8…98a32`).
- Revert the fixture's corrected-state steps in `scripts/reports_integrity_fixture.py`.

The applied migration files stay as the historical record; applied migrations are never edited or replayed.

## 9. Unverified (exact reason)

- **DDL and guard execution on PostgreSQL 17.6:** only PostgreSQL 16 binaries exist locally. The corrected expression itself ran on production 17.6 as a read-only SELECT. CI's `postgres:17.6` job will execute the DDL.
- **Hosted apply, readback and rollback:** not executed. Each needs Chris's separate exact approval; production was only read.
- **Browser gate:** not re-run for this change. Its input payload JSON is unchanged (§4.1).
- **Exact-head CI on PR-B:** pending. No PR has been opened from this branch yet.
