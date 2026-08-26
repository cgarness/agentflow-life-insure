#!/usr/bin/env bash
# =====================================================================================================
# ⛔ ALREADY EXECUTED (circa 2026-03) — DO NOT RUN. Kept only as a historical record.
# =====================================================================================================
# This is a one-shot script that MUTATES PRODUCTION MIGRATION HISTORY
# (supabase_migrations.schema_migrations) with no guards, no project binding, no confirmation and
# no `set -e`. Its effects are already baked into production's recorded history: the 11 versions it
# marks `applied` are present in production's 262 pre-baseline rows today, and the 4 it marks
# `reverted` are already absent.
#
# It names NONE of the ten post-baseline versions that must be preserved, so it is not a threat to
# them — but it is an ungated production-mutating executable sitting at the repo root, and running
# it again would issue 15 unnecessary `migration repair` calls against the live project.
#
# Migration-history reconciliation is governed by
# supabase/rollback/20260806_baseline_history_reconciliation_runbook.md and is gated on explicit
# approval. Do not use this file as a template — it predates every safety control in that runbook.
# =====================================================================================================
exit 1   # refuse to run; remove this line only with explicit approval and a documented reason

npx supabase migration repair --status reverted 20260303233508
npx supabase migration repair --status reverted 20260304225558
npx supabase migration repair --status reverted 20260304232944
npx supabase migration repair --status reverted 20260305154544
npx supabase migration repair --status applied 20260303233510
npx supabase migration repair --status applied 20260304000001
npx supabase migration repair --status applied 20260307090000
npx supabase migration repair --status applied 20260307101000
npx supabase migration repair --status applied 20260307233600
npx supabase migration repair --status applied 20260307235939
npx supabase migration repair --status applied 20260308093000
npx supabase migration repair --status applied 20260308120000
npx supabase migration repair --status applied 20260308143000
npx supabase migration repair --status applied 20260308170000
npx supabase migration repair --status applied 20260308171000
