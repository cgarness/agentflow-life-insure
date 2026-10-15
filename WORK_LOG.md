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

**Verification:** corrected code head `215ab05c673b171b36b107d68c5f3fb7f9cedc35` is green on all workflows. PostgreSQL 17.6 passed the full commission runner, including the production-shaped restricted-SET and non-super CREATEROLE probes, privilege/role negatives, 59 concurrency assertions, rollback and reapply. Corrected operations SHA-256 is `dc0c524b36abc4b97db83dfdd10ed9f62ab14fc4c9f8957ed0a56273a60c1c25`; rollback SHA-256 is `593abb853cbe30fe423924b9d0e2dcbf874c92dc66ffb3860f6b86a1f299cc01`.

**Production boundary:** migration 1 remains production history exactly as version `20261015211858`. Current production has zero comp grid/import/availability/access/settings rows, no operation role and no write RPCs. Fresh exact approval is required before migration 2.
