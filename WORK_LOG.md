## 2026-10-15 — Commission production authority correction after migration-2 SET failure

**Status:** Production release paused safely after schema migration **20261015211858** applied byte-identically. The
next operations migration failed atomically with `42501 permission denied to set parameter "agentflow.comp_operation"`.
No operations functions, reference import, FFL data, availability, activation, merge or deploy followed the failure.

**Correction on draft PR #447:** the still-unapplied operations migration now forward-corrects the applied schema to
a dedicated `agentflow_comp_operator` role: NOLOGIN, NOSUPERUSER, NOBYPASSRLS, no client/server-key membership.
Only trusted `postgres` is a member so migration/rollback can administer the six owned write RPCs. Authenticated
loses all commission base-table write grants. Those six public write RPCs are SECURITY DEFINER owned by the narrow
role; the role remains subject to RLS, and both policies and the first trigger re-resolve the real JWT/profile actor
through the canonical helpers. The legacy custom-GUC authority is not used by migration 2.

**Production boundary:** migration 1 remains production history exactly as version `20261015211858`. The revised
migration 2 and every later release step require a fresh exact production approval after CI/review.
