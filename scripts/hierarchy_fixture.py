"""Disposable fixture for hierarchy stabilization (synthetic data only; never production).

Plan: docs/plans/2026-10-23-hierarchy-stabilization/implementation_plan.md §8 (Harness).

Emits SQL for a DISPOSABLE local database that reproduces the production PREIMAGE of every object the hierarchy
migrations read, replace or guard, copied VERBATIM from the applied migrations (baseline 20260806000000 and the later
migrations that replaced an object), plus:
  * Supabase-like roles (anon, authenticated, service_role) and the verbatim production auth.uid();
  * a counting public.set_claim stub (production writes auth.users.raw_app_meta_data) and logging stubs for the two
    production-only profiles side-effect triggers (UV sync, platform-admin notification), under their production
    trigger definitions;
  * the production ACLs of every emitted table, column and function (read-only catalog check, 2026-10-23);
  * the hierarchy_test helper schema (NOT production objects): id/org/key/label/sp/path_of (synthetic ids and
    paths by shape key), claims/act_as (fresh, stale or forged PostgREST claims), as_user/as_anon/as_system (run one
    statement as that caller: 'OK <rows>' or 'REJECTED <sqlstate>: <message>'), probe (as_user + what changed,
    always rolled back), try/rows/check/eq, take_snap/diff_snap, canonical/stale/stale_fingerprint/missing_pairs/
    consistency (path-based, usable in every state), acl/fn_md5/trg_md5/pol_md5 (pinned-search_path digests),
    set_claim_calls/side_effects (stub counters), shape/shapes_json (hierarchy_shapes.json);
  * the synthetic production-shaped data from supabase/tests/fixtures/hierarchy_shapes.json, written through the
    verbatim preimage triggers in the order that reproduces production's 4 stale paths and 6 missing ancestor pairs.
    Parents are always inserted before children (the M2 builder rejects a child-before-parent multi-row INSERT).

The schema part ends with an assertion block that compares each guarded object with its production digest and ACL;
a fixture that does not reproduce the preimage fails to load instead of silently testing something else.

Usage:  python3 scripts/hierarchy_fixture.py [--part schema|data|all]   (default all)  > fixture.sql

Extending (authorization / RPC suites): append to the lists below, never reorder them.
  TABLES               baseline CREATE TABLE blocks (+ primary key) in dependency order
  LATER_COLUMNS        columns added after the baseline, as production has them today
  FOREIGN_KEYS         baseline FK blocks (only the ones the hierarchy needs)
  BASELINE_FUNCTIONS   (schema, name) of baseline CREATE OR REPLACE FUNCTION blocks
  MIGRATION_BLOCKS     (migration suffix, header, terminator) blocks from later migrations
  BASELINE_TRIGGERS    baseline trigger names (CREATE OR REPLACE TRIGGER "name" ... ;)
  PRODUCTION_ONLY_TRIGGERS  later-migration triggers whose functions are stubbed (definitions stay verbatim)
  POLICY_TABLES        tables whose baseline policies are emitted verbatim (RLS enabled)
  WHOLE_MIGRATIONS     later migrations applied verbatim after the policies (e.g. the calls command split)
  FUNCTION_ACLS        production EXECUTE grantees per function ('PUBLIC' kept as the PUBLIC pseudo-role)
  PREIMAGE_DIGESTS     production md5(pg_get_functiondef) under search_path '"$user", public, extensions'
  TRIGGER_DIGESTS, POLICY_DIGESTS  production md5(pg_get_triggerdef) / md5(pg_get_expr) under the same path
  AUTHZ_*              the authorization surface the RLS / RPC suites exercise (the 17 direct is_ancestor_of callers,
                       their entry points, sale-identity triggers, contact history): DDL blocks, production unique
                       indexes, functions (latest definition, extracted to the end of the dollar-quoted body),
                       post-function statements, and their ACLs / digests, merged into the dicts above
No production URL is accepted and nothing here connects anywhere.
"""
from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SHAPES = json.loads((ROOT / 'supabase/tests/fixtures/hierarchy_shapes.json').read_text())
SENTINEL = 'agentflow-hierarchy-synthetic-fixture'


def read(path):
    return (ROOT / path).read_text()


def migration(suffix):
    paths = list((ROOT / 'supabase/migrations').glob('*_' + suffix + '.sql'))
    assert len(paths) == 1, suffix
    return paths[0].read_text()


def block(source, header, end):
    start = source.index(header)
    assert source.count(header) == 1, header
    return source[start:source.index(end, start) + len(end)]


def function_block(source, header):
    """One function definition, from its (unique) header to the end of its dollar-quoted body and the closing ';'."""
    start = source.index(header)
    assert source.count(header) == 1, header
    body = re.compile(r'\bAS\s+(\$[A-Za-z_]*\$)').search(source, start)
    close = source.index(body.group(1), body.end())
    return source[start:source.index(';', close + len(body.group(1))) + 1]


base = read('supabase/migrations/20260806000000_baseline_production_schema.sql')

# ── Object lists ──────────────────────────────────────────────────────────────────────────────────────────
TABLES = ['organizations', 'teams', 'agency_group_members', 'profiles', 'invitations', 'role_permissions', 'leads',
          'clients', 'recruits', 'calls', 'contact_emails', 'tasks', 'dispositions',
          # authorization surface (AUTHZ_* below): tables the is_ancestor_of callers read or write
          'campaigns', 'campaign_leads', 'import_history', 'wins', 'notifications', 'appointments', 'contact_notes',
          'contact_activities', 'messages', 'workflow_executions', 'call_logs', 'company_settings']
EXTRA_UNIQUE = ['ALTER TABLE ONLY "public"."invitations"\n    ADD CONSTRAINT "invitations_token_key" UNIQUE ("token");']
LATER_COLUMNS = {
    'calls': ['routed_agent_ids uuid[]', 'recording_source_sid text', 'answered_by_agent_id uuid', 'missed_reason text',
              'missed_for_agent_id uuid', "missed_recipient_ids uuid[] NOT NULL DEFAULT '{}'::uuid[]",
              'missed_notified_at timestamp with time zone', 'missed_notify_attempts integer NOT NULL DEFAULT 0',
              'missed_notify_next_at timestamp with time zone', 'missed_notify_error text', 'routing_engine text',
              'voicemail_id uuid', 'dialer_admission_required boolean NOT NULL DEFAULT false', 'attempt_id uuid',
              "duration_source text NOT NULL DEFAULT 'legacy_unknown'::text", 'duration_provider_account text',
              'duration_provider_sid text', 'duration_sequence bigint', 'duration_observed_at timestamp with time zone',
              'duration_conflict boolean NOT NULL DEFAULT false'],
    'clients': ['sold_date date', 'draft_date date', 'payment_frequency text', 'primary_policy_id uuid',
                'date_of_birth text', 'age integer', 'best_time_to_call text', 'spouse_info jsonb', 'lead_conversion jsonb'],
    'wins': ['sold_date date', 'premium_snapshot boolean NOT NULL DEFAULT false', 'policy_id uuid',
             'recorded_at timestamp with time zone DEFAULT clock_timestamp()',
             "event_time_source text NOT NULL DEFAULT 'event'::text"],
    'notifications': ['event_key text NOT NULL DEFAULT (gen_random_uuid())::text', 'dismissed_at timestamp with time zone'],
    'campaign_leads': ['disposition_version bigint NOT NULL DEFAULT 0'],
    'appointments': ['booking_request_id uuid', 'booking_kind text', 'external_identity_guarded boolean NOT NULL DEFAULT false'],
}
FOREIGN_KEYS = [('profiles', c) for c in ('profiles_id_fkey', 'profiles_organization_id_fkey', 'profiles_team_id_fkey',
                                          'profiles_upline_id_fkey')] + \
               [('invitations', c) for c in ('invitations_invited_by_fkey', 'invitations_organization_id_fkey',
                                             'invitations_team_id_fkey', 'invitations_upline_id_fkey')]
BASELINE_FUNCTIONS = [
    ('public', 'get_user_role'), ('public', 'is_super_admin'), ('public', 'get_org_id'), ('public', 'get_user_org_id'),
    ('public', 'super_admin_own_org'), ('public', 'is_agency_group_peer_organization'),
    ('public', 'has_contacts_permission'),
    ('public', 'compute_hierarchy_path'), ('public', 'update_hierarchy_path'), ('public', 'cascade_hierarchy_update'),
    ('public', 'is_ancestor_of'), ('public', 'enforce_profile_field_authorization'), ('public', 'on_profile_update'),
    ('public', 'update_updated_at'), ('public', 'sync_leads_user_id'), ('profile_authz', 'can_update_profile'),
    ('public', 'provision_organization'),
]
MIGRATION_BLOCKS = [
    ('google_sheets_import_foundation', 'CREATE OR REPLACE FUNCTION public._contacts_permission_default(', '\n$function$;'),
    ('profile_book_and_team_stats_rpcs', 'CREATE OR REPLACE FUNCTION private.resolve_downline_ids(', '\n$$;'),
    ('dialer_disposition_dnc_integrity', 'CREATE FUNCTION private.guard_dialer_core_write()', '\n$$;'),
    ('dialer_disposition_dnc_integrity', 'CREATE TRIGGER calls_guard_dialer_core ', ';'),
    ('call_attempt_duration_provenance', 'CREATE FUNCTION private.guard_call_reporting_fields()', 'END $$;'),
    ('call_attempt_duration_provenance', 'CREATE TRIGGER calls_reporting_fields ', ';'),
]
PRODUCTION_ONLY_TRIGGERS = [
    ('platform_admin_registration_notifications', 'CREATE TRIGGER trg_zz_platform_admin_notify_user_registered\n'),
    ('uv_profile_save_driven', 'CREATE TRIGGER uv_profile_saved '),
    ('uv_profile_save_driven', 'CREATE TRIGGER uv_profile_deleted '),
]
BASELINE_TRIGGERS = ['on_profile_update_trigger', 'profiles_updated_at', 'trg_00_enforce_profile_field_authorization',
                     'trg_cascade_hierarchy_update', 'trg_update_hierarchy_path', 'tr_sync_leads_user_id']
POLICY_TABLES = ['profiles', 'invitations', 'role_permissions', 'leads', 'clients', 'recruits', 'calls',
                 'contact_emails', 'tasks']
WHOLE_MIGRATIONS = ['rls_phase1_calls_command_split']
FULL = ['PUBLIC', 'anon', 'authenticated', 'service_role']
FUNCTION_ACLS = {
    'public.get_user_role()': FULL, 'public.is_super_admin()': FULL, 'public.get_org_id()': FULL,
    'public.get_user_org_id()': FULL, 'public.super_admin_own_org(uuid)': FULL,
    'public.is_agency_group_peer_organization(uuid)': FULL,
    'public.has_contacts_permission(text)': ['authenticated', 'service_role'],
    'public._contacts_permission_default(text,text)': [],
    'public.compute_hierarchy_path(uuid)': FULL, 'public.update_hierarchy_path()': FULL,
    'public.cascade_hierarchy_update()': FULL, 'public.is_ancestor_of(uuid,uuid)': FULL,
    'public.enforce_profile_field_authorization()': ['service_role'], 'public.on_profile_update()': FULL,
    'public.update_updated_at()': FULL, 'public.sync_leads_user_id()': FULL,
    'public.set_claim(uuid,text,jsonb)': ['service_role'],
    'profile_authz.can_update_profile(uuid)': ['authenticated'],
    'private.resolve_downline_ids(uuid,uuid)': [], 'private.guard_dialer_core_write()': [],
    'public.provision_organization(text,text,uuid)': ['service_role'],
    'private.guard_call_reporting_fields()': [],
}
PREIMAGE_DIGESTS = {   # production, read-only catalog check 2026-10-23 (PostgreSQL 17.6)
    'public.is_ancestor_of(uuid,uuid)': '7c5213032696734f2e0c5ffe5a71a07a',
    'public.compute_hierarchy_path(uuid)': 'b9aaa16d5b974676ce18d55c5dce9e18',
    'public.update_hierarchy_path()': 'd9ff2d22fcc0bd5e55ea288850ad1cfe',
    'public.cascade_hierarchy_update()': '8392e93e9b09f726dcb097cb54dae522',
    'public.enforce_profile_field_authorization()': 'b9b4c345b470c94923cddace49cd1d5b',
    'public.on_profile_update()': 'b44d4c7ddc97d62d2cc9a3b22a8fc057',
    'public.update_updated_at()': '35c07ee4479953bb6577590456412a5f',
    'public.get_org_id()': 'fb1d12f537aac3b3ed18c9e0628f2251',
    'public.get_user_org_id()': 'd0f6b3730b5b6f08fc52543305221fef',
    'public.get_user_role()': '80bfd3a79274e5f8784815a992846d1c',
    'public.super_admin_own_org(uuid)': 'da9f7335f68b64964351b9f488300b96',
    'public.is_super_admin()': '0ee0a6f421304027869f3a4d83bcf995',
    'public.is_agency_group_peer_organization(uuid)': 'e7357b34de2504ee3e32bcef208b0532',
    'public.has_contacts_permission(text)': 'b656907ca141c08a9ba9f5c867c42b6a',
    'public._contacts_permission_default(text,text)': 'bc6356dde683e628b88b631dd5f6d01e',
    'public.sync_leads_user_id()': '499ab441eb6b0fabd3b5ec0f3a080ec2',
    'profile_authz.can_update_profile(uuid)': 'c9761a65a963c45cb7aa6dc178bfde36',
    'private.guard_dialer_core_write()': 'c2fbba6d647babc57c9b4c429d13a551',
    'private.guard_call_reporting_fields()': '7df31398a10a3fb6fa17d3cf515439ca',
    'private.resolve_downline_ids(uuid,uuid)': 'c119d832a688df55357ada5304cc7f5e',
    'public.provision_organization(text,text,uuid)': 'cc9f3fe7848d884fa068d5e57e0a7ad9',
}
TRIGGER_DIGESTS = {    # production md5(pg_get_triggerdef) under the same pinned search_path
    ('profiles', 'on_profile_update_trigger'): '3a263cfd07d006faf8ee054842f785a7',
    ('profiles', 'profiles_updated_at'): '8dc89bf1e11c8e19fc11aaaa220640a1',
    ('profiles', 'trg_00_enforce_profile_field_authorization'): 'fc02958ebc6986a60bda53127323bb7c',
    ('profiles', 'trg_cascade_hierarchy_update'): '869f33cd50c475f78bb754fa9aa8efdd',
    ('profiles', 'trg_update_hierarchy_path'): '800fa050d8f940e783b14569fd01faef',
    ('profiles', 'trg_zz_platform_admin_notify_user_registered'): 'b0225cf3906ab258d4fad48728565b30',
    ('profiles', 'uv_profile_deleted'): '16cb310e99ab92eb2aee766ff3fd1c95',
    ('profiles', 'uv_profile_saved'): '1019dbecc18f15bc55524d6f41b6fab6',
    ('calls', 'calls_guard_dialer_core'): 'bce9db5747cd6023eaeef99a38e5ec64',
    ('calls', 'calls_reporting_fields'): '577beff3268dd0e9c58106b4a1088d65',
}
POLICY_DIGESTS = {     # production md5(coalesce(pg_get_expr(qual), '-')), md5(coalesce(pg_get_expr(with_check), '-'))
    ('calls', 'Calls Hierarchical Select'): ('11a30ab26c1dc348d1125863fd71a6fd', '336d5ebc5436534e61d16e63ddfca327'),
    ('calls', 'Calls Hierarchical Insert'): ('336d5ebc5436534e61d16e63ddfca327', '983d0bbf7a63d66586402747d60138d0'),
    ('calls', 'Calls Hierarchical Update'): ('37497d04aa864ed0d6b80d2ab0a01810', '983d0bbf7a63d66586402747d60138d0'),
    ('calls', 'Calls Hierarchical Delete'): ('37497d04aa864ed0d6b80d2ab0a01810', '336d5ebc5436534e61d16e63ddfca327'),
    ('calls', 'Calls Agency Group Peer Read'): ('a36f312edeb7736e973228017e906b32', '336d5ebc5436534e61d16e63ddfca327'),
    ('clients', 'Clients Hierarchical Access'): ('6bc2d03ca69f509d66711ec272b223e8', '6bc2d03ca69f509d66711ec272b223e8'),
    ('leads', 'Leads Hierarchical Access'): ('4db40edfe28246948621a7c90b7b4309', '4db40edfe28246948621a7c90b7b4309'),
    ('leads', 'leads_select_unassigned_pool'): ('9faff67becc97fc02a4e9cc94cee4474', '336d5ebc5436534e61d16e63ddfca327'),
    ('leads', 'leads_select_view_all_pool'): ('6e11ec5a0b253da186e8757edda6eca0', '336d5ebc5436534e61d16e63ddfca327'),
    ('recruits', 'Recruits Hierarchical Access'): ('6bc2d03ca69f509d66711ec272b223e8', '6bc2d03ca69f509d66711ec272b223e8'),
    ('contact_emails', 'contact_emails_select'): ('795bda19a5048190ff71471b375c4a0f', '336d5ebc5436534e61d16e63ddfca327'),
    ('profiles', 'profiles_select_hierarchical'): ('5234dd30570f6c000db0ed918c53621f', '336d5ebc5436534e61d16e63ddfca327'),
    ('profiles', 'profiles_select_org'): ('9487a015e08548797c981a4eba3e104c', '336d5ebc5436534e61d16e63ddfca327'),
    ('profiles', 'profiles_update_authorized'): ('ae2876d9b9a5119ce5b8c3dd971a573d', 'ae2876d9b9a5119ce5b8c3dd971a573d'),
    ('tasks', 'tasks_select_team_leader'): ('98e4d5f1c5fac3108c9f9a938cfa08de', '336d5ebc5436534e61d16e63ddfca327'),
}
# ── Authorization surface (hierarchy_stabilization_rls.sql / _rpcs.sql) ───────────────────────────────────────
# The 17 direct is_ancestor_of callers (plan §2), the entry points that reach them, the sale-identity triggers they
# write through and the tables they read, copied verbatim and digest-checked like the core objects, so the suites run
# production's own code before and after M1–M3. Not reproduced (recorded residual risk in the suites): the Phase 2A
# commission engine behind private.policy_sale_commission_step (writer role agentflow_policy_commission_writer is
# cluster-global), the performance summary readers, the RLS policies of the tables added here (reached only through
# definer functions or as the system caller), and production's side-effect triggers on leads / clients /
# campaign_leads / tasks (contact-history capture, workflows, assignment notifications, campaign counters).
# AUTHZ_DDL: (migration suffix, header, terminator); emitted after every table, column and core policy.
AUTHZ_DDL = [
    ('policy_identity_sale_integrity', 'ALTER TABLE public.wins ADD CONSTRAINT wins_event_time_source_check', ';'),
    ('leaderboard_sale_recording', 'CREATE TABLE private.policy_sale_receipts (', '\n);'),
    ('leaderboard_sale_recording', 'ALTER TABLE private.policy_sale_receipts ENABLE ROW LEVEL SECURITY;', ';'),
    ('leaderboard_sale_recording', 'REVOKE ALL ON private.policy_sale_receipts FROM', ';'),
    ('policy_identity_sale_integrity', 'CREATE TABLE private.policy_identities (', '\n);'),
    ('policy_identity_sale_integrity', 'CREATE INDEX policy_identities_client ON', ';'),
    ('policy_identity_sale_integrity', 'ALTER TABLE private.policy_identities ENABLE ROW LEVEL SECURITY;', ';'),
    ('policy_identity_sale_integrity', 'REVOKE ALL ON private.policy_identities FROM', ';'),
    ('policy_identity_sale_integrity', 'ALTER TABLE public.wins ADD CONSTRAINT wins_policy_registry_fk', ';'),
    ('policy_identity_sale_integrity', 'CREATE TABLE private.policy_sale_reversals(', '\n);'),
    ('policy_identity_sale_integrity', 'ALTER TABLE private.policy_sale_reversals ENABLE ROW LEVEL SECURITY;', ';'),
    ('policy_identity_sale_integrity', 'REVOKE ALL ON private.policy_sale_reversals FROM', ';'),
    ('team_dialer_association_provenance', 'CREATE TABLE private.team_queue_associations (', '\n);'),
    ('team_dialer_association_provenance', 'ALTER TABLE private.team_queue_associations ENABLE ROW LEVEL SECURITY;', ';'),
    ('team_dialer_association_provenance', 'REVOKE ALL ON private.team_queue_associations FROM', ';'),
    ('contact_history_operational_events', 'CREATE TABLE public.contact_history_events (', '\n);'),
    ('contact_history_operational_events', 'ALTER TABLE public.contact_history_events ENABLE ROW LEVEL SECURITY;', ';'),
    ('contact_history_operational_events', 'REVOKE ALL ON public.contact_history_events FROM', ';'),
    ('contact_history_operational_events', 'GRANT SELECT ON public.contact_history_events TO authenticated;', ';'),
]
# Production unique indexes the functions rely on (ON CONFLICT targets, lineage, idempotency), as pg_indexes prints
# them (read-only catalog check, 2026-10-23).
AUTHZ_INDEXES = [
    'CREATE UNIQUE INDEX uq_notifications_user_event_key ON public.notifications USING btree (user_id, event_key);',
    'CREATE UNIQUE INDEX campaign_leads_campaign_lead_unique ON public.campaign_leads USING btree (campaign_id, lead_id) '
    'WHERE (lead_id IS NOT NULL);',
    'CREATE UNIQUE INDEX uq_wins_idempotency_key ON public.wins USING btree (idempotency_key) '
    'WHERE (idempotency_key IS NOT NULL);',
    'CREATE UNIQUE INDEX wins_policy_identity ON public.wins USING btree (organization_id, policy_id) '
    'WHERE (policy_id IS NOT NULL);',
    'CREATE UNIQUE INDEX uq_clients_lead_id ON public.clients USING btree (lead_id) WHERE (lead_id IS NOT NULL);',
    'CREATE UNIQUE INDEX company_settings_org_unique ON public.company_settings USING btree (organization_id);',
]
# AUTHZ_FUNCTIONS: (source, header) — the LATEST definition (or the one production runs), extracted up to the end of
# its dollar-quoted body. Order matters only for LANGUAGE sql bodies that call another function listed here.
AUTHZ_FUNCTIONS = [
    ('baseline', 'CREATE OR REPLACE FUNCTION "public"."normalize_us_state"('),
    ('baseline', 'CREATE OR REPLACE FUNCTION "public"."_contacts_filtered_leads"('),
    ('baseline', 'CREATE OR REPLACE FUNCTION "public"."get_contacts_lead_kanban"('),
    ('baseline', 'CREATE OR REPLACE FUNCTION "public"."contacts_lead_ids_matching"('),
    ('baseline', 'CREATE OR REPLACE FUNCTION "public"."search_contacts_leads"('),
    ('baseline', 'CREATE OR REPLACE FUNCTION "public"."get_contact_scope_agents"('),
    ('baseline', 'CREATE OR REPLACE FUNCTION "public"."delete_contact"('),
    ('baseline', 'CREATE OR REPLACE FUNCTION "public"."_import_undo_context"('),
    ('baseline', 'CREATE OR REPLACE FUNCTION "public"."_import_undo_blockers"('),
    ('baseline', 'CREATE OR REPLACE FUNCTION "public"."undo_contact_import"('),
    ('campaign_leads_membership_uniqueness_and_attachment_core', 'CREATE OR REPLACE FUNCTION private.campaign_actor()'),
    ('campaign_leads_membership_uniqueness_and_attachment_core',
     'CREATE OR REPLACE FUNCTION private.assert_import_set_campaign_compatible('),
    ('campaign_leads_membership_uniqueness_and_attachment_core', 'CREATE OR REPLACE FUNCTION public.add_leads_to_campaign('),
    ('team_dialer_association_provenance', 'CREATE OR REPLACE FUNCTION private.can_administer_campaign('),
    ('team_dialer_association_provenance', 'CREATE FUNCTION private.can_authorize_campaign_lead('),
    ('team_dialer_association_provenance', 'CREATE OR REPLACE FUNCTION private.attach_leads_to_campaign_core('),
    ('team_dialer_association_provenance', 'CREATE FUNCTION public.validate_team_queue_association('),
    ('import_campaign_creation_and_retry', 'CREATE OR REPLACE FUNCTION private.assert_may_assign_to('),
    ('import_campaign_creation_and_retry', 'CREATE OR REPLACE FUNCTION public.create_import_campaign('),
    ('import_campaign_creation_and_retry', 'CREATE OR REPLACE FUNCTION private.import_attachment_status('),
    ('import_campaign_creation_and_retry', 'CREATE OR REPLACE FUNCTION public.finalize_contact_import('),
    ('import_campaign_creation_and_retry', 'CREATE OR REPLACE FUNCTION public.retry_import_campaign_attachment('),
    ('notifications_idempotency_recipients_security', 'CREATE OR REPLACE FUNCTION public.notify_win('),
    ('reports_secure_scoped_rpcs', 'CREATE FUNCTION private.report_permission_flags('),
    ('reports_secure_scoped_rpcs', 'CREATE FUNCTION private.report_agency_time_zone('),
    ('reports_secure_scoped_rpcs', 'CREATE FUNCTION private.report_agent_name('),
    ('reports_scopes_and_policy_premium', 'CREATE FUNCTION private.report_access_v2('),
    ('reports_scopes_and_policy_premium', 'CREATE FUNCTION public.get_report_scope_v2('),
    ('performance_scoped_summaries', 'CREATE FUNCTION private.performance_scope('),
    ('contact_history_read_model', 'CREATE FUNCTION public.contact_history_contact_visible('),
    ('contact_history_operational_events', 'CREATE FUNCTION public.contact_history_event_visible('),
    ('lead_client_conversion_preservation', 'CREATE OR REPLACE FUNCTION "public"."convert_lead_to_client_atomic"('),
    ('lead_client_conversion_preservation', 'CREATE OR REPLACE FUNCTION private.guard_client_lead_conversion()'),
    ('leaderboard_sale_recording', 'CREATE FUNCTION private.policy_sale_values('),
    ('leaderboard_sale_recording', 'CREATE FUNCTION public.create_client_with_sale('),
    ('leaderboard_sale_recording', 'CREATE FUNCTION public.convert_lead_to_client_with_sales('),
    ('policy_identity_sale_integrity', 'CREATE FUNCTION private.has_primary_policy('),
    ('policy_identity_sale_integrity', 'CREATE FUNCTION private.ensure_policy_identity()'),
    ('policy_identity_sale_integrity', 'CREATE FUNCTION private.check_policy_sale_complete()'),
    ('policy_identity_sale_integrity', 'CREATE FUNCTION private.guard_policy_win()'),
    ('policy_identity_sale_integrity', 'CREATE OR REPLACE FUNCTION private.insert_policy_sale('),
    ('policy_identity_sale_integrity', 'CREATE FUNCTION public.record_client_policy('),
    ('lead_client_conversion_preservation', 'CREATE OR REPLACE FUNCTION public.update_client_with_policy_sale('),
    ('policy_commission_tracking', 'CREATE FUNCTION private.policy_commission_toggle('),
    ('policy_commission_tracking', 'CREATE FUNCTION policy_commission_authz.access('),
    ('policy_commission_tracking', 'CREATE FUNCTION private.policy_sale_commission_step('),
    ('policy_commission_tracking', 'CREATE FUNCTION public.update_client_with_policy_sale_handoff('),
]
# Statements run after the functions: the guarded in-place patch production applied to policy_sale_values and
# create_client_with_sale (20261005161611 $patch$), the sale-identity and conversion-history triggers, and the
# contact-history read policy.
AUTHZ_AFTER = [
    ('policy_identity_sale_integrity', 'DO $patch$', 'END $patch$;'),
    ('policy_identity_sale_integrity', 'CREATE TRIGGER clients_policy_identity ', ';'),
    ('policy_identity_sale_integrity', 'CREATE CONSTRAINT TRIGGER clients_policy_sale_complete ', ';'),
    ('policy_identity_sale_integrity', 'CREATE CONSTRAINT TRIGGER wins_policy_sale_complete ', ';'),
    ('policy_identity_sale_integrity', 'CREATE TRIGGER wins_policy_identity_guard ', ';'),
    ('lead_client_conversion_preservation', 'CREATE OR REPLACE TRIGGER clients_lead_conversion_guard ', ';'),
    ('contact_history_operational_events', 'CREATE POLICY contact_history_events_select ', ';'),
]
CLIENT = ['authenticated', 'service_role']
AUTHZ_FUNCTION_ACLS = {   # production EXECUTE grantees (read-only catalog check 2026-10-23); postgres is the owner
    'public.normalize_us_state(text)': FULL,
    'public._contacts_filtered_leads(jsonb)': CLIENT, 'public.get_contacts_lead_kanban(jsonb,integer)': CLIENT,
    'public.contacts_lead_ids_matching(jsonb)': CLIENT, 'public.search_contacts_leads(jsonb)': CLIENT,
    'public.get_contact_scope_agents()': CLIENT, 'public.delete_contact(text,uuid)': CLIENT,
    'public._import_undo_context(uuid)': [], 'public._import_undo_blockers(uuid,uuid,uuid[])': [],
    'public.undo_contact_import(uuid)': CLIENT, 'private.campaign_actor()': [],
    'private.assert_import_set_campaign_compatible(uuid,uuid[])': [], 'public.add_leads_to_campaign(uuid,uuid[],uuid)': CLIENT,
    'private.can_administer_campaign(uuid)': [], 'private.can_authorize_campaign_lead(uuid,uuid)': [],
    'private.attach_leads_to_campaign_core(uuid,uuid[],uuid)': [],
    'public.validate_team_queue_association(uuid,uuid,uuid)': ['authenticated'],
    'private.assert_may_assign_to(uuid,text,boolean,uuid,uuid)': [],
    'public.create_import_campaign(text,text,text,uuid,uuid[],text)': CLIENT,
    'private.import_attachment_status(uuid,uuid,uuid[])': [], 'public.finalize_contact_import(uuid)': CLIENT,
    'public.retry_import_campaign_attachment(uuid)': CLIENT, 'public.notify_win(uuid)': CLIENT,
    'private.report_permission_flags(uuid,text)': [], 'private.report_agency_time_zone(uuid)': [],
    'private.report_agent_name(text,text)': [], 'private.report_access_v2(text,uuid)': [],
    'public.get_report_scope_v2(text)': CLIENT, 'private.performance_scope(uuid,text)': [],
    'public.contact_history_contact_visible(uuid,uuid,text)': CLIENT,
    'public.contact_history_event_visible(public.contact_history_events)': CLIENT,
    'public.convert_lead_to_client_atomic(uuid,jsonb)': CLIENT, 'private.guard_client_lead_conversion()': [],
    'private.policy_sale_values(jsonb)': [], 'public.create_client_with_sale(uuid,uuid,jsonb,boolean)': CLIENT,
    'public.convert_lead_to_client_with_sales(uuid,uuid,jsonb,uuid)': CLIENT, 'private.has_primary_policy(jsonb)': [],
    'private.ensure_policy_identity()': [], 'private.check_policy_sale_complete()': [], 'private.guard_policy_win()': [],
    'private.insert_policy_sale(uuid,jsonb,text,uuid)': [], 'public.record_client_policy(uuid,uuid,jsonb,boolean)': CLIENT,
    'public.update_client_with_policy_sale(uuid,jsonb)': CLIENT, 'private.policy_commission_toggle(uuid,text,boolean,text)': [],
    # production also grants agentflow_policy_commission_writer (a cluster-global role not created here)
    'policy_commission_authz.access(uuid)': ['authenticated'],
    'private.policy_sale_commission_step(text,text,uuid,text,jsonb,boolean,jsonb)': [],
    'public.update_client_with_policy_sale_handoff(uuid,uuid,jsonb,jsonb)': ['authenticated'],
}
AUTHZ_DIGESTS = {   # production md5(pg_get_functiondef) under '"$user", public, extensions' (read-only, 2026-10-23)
    'public.normalize_us_state(text)': 'c8905751f7543ef1f6be8e7325d9c666',
    'public._contacts_filtered_leads(jsonb)': '6df00e220c88d6a5a22569bb86554387',
    'public.get_contacts_lead_kanban(jsonb,integer)': '02a5760801b220289bb0831c21457cd7',
    'public.contacts_lead_ids_matching(jsonb)': '8d9823e76b8cf53703906788fa201651',
    'public.search_contacts_leads(jsonb)': '8e25f7f6b9f404f0de7849a7b3b6d901',
    'public.get_contact_scope_agents()': '1d5da52e11bb2d02a1d7084172a29af8',
    'public.delete_contact(text,uuid)': '41682f805f639442d73d3063f685ac85',
    'public._import_undo_context(uuid)': 'e76a16e60cb8f3d9d3643ca1de7dee45',
    'public._import_undo_blockers(uuid,uuid,uuid[])': '1f4ad83013de7dd3cb2de1451e6ab6c2',
    'public.undo_contact_import(uuid)': 'acb2d7afcf2457f9ae7cbb90653476b5',
    'private.campaign_actor()': 'f582e43731a968fb2e0961e80939ff7e',
    'private.assert_import_set_campaign_compatible(uuid,uuid[])': 'cbcd0c1243fbb8094aa20555fd9bb450',
    'public.add_leads_to_campaign(uuid,uuid[],uuid)': '71862c3e89d8228e88f0b8f2e12fd273',
    'private.can_administer_campaign(uuid)': '146b69ca79b189afaeec82b45fd0344f',
    'private.can_authorize_campaign_lead(uuid,uuid)': 'f525386709edd464e4f0d04c5aef88e0',
    'private.attach_leads_to_campaign_core(uuid,uuid[],uuid)': '8ce5a69279c2d517191c91ed3ce1ffe4',
    'public.validate_team_queue_association(uuid,uuid,uuid)': '57bc686ed327ad74f31f9e62a4c42b79',
    'private.assert_may_assign_to(uuid,text,boolean,uuid,uuid)': '4041471667f2cd1dc0cd5a21123fb933',
    'public.create_import_campaign(text,text,text,uuid,uuid[],text)': '0c507cf92d8323e97758d7b11905cdce',
    'private.import_attachment_status(uuid,uuid,uuid[])': '8b8e2477bf659792c4063679cbb79cf3',
    'public.finalize_contact_import(uuid)': '2ec026901c3b8848aff0cf0dd0b07f50',
    'public.retry_import_campaign_attachment(uuid)': 'cb05803ee1ae2d8020862ac3ee9bd99e',
    'public.notify_win(uuid)': '62123f11c7a15711456f6b3e4177b68c',
    'private.report_permission_flags(uuid,text)': 'ba3194aed6c50ceea46a4d951a184dfe',
    'private.report_agency_time_zone(uuid)': '4e94e389294d20c4f342948ca149d58c',
    'private.report_agent_name(text,text)': '4db1ae8c595522b916e4e456887f7b55',
    'private.report_access_v2(text,uuid)': 'ff2a9a20b88df18fbab4cd861294b591',
    'public.get_report_scope_v2(text)': '3dc3d7570db46e66723702bec940542e',
    'private.performance_scope(uuid,text)': 'b923259556a920ba02434ac5dc6ccd45',
    'public.contact_history_contact_visible(uuid,uuid,text)': '78fd5f6759a78c223fa7af7e46007463',
    'public.contact_history_event_visible(public.contact_history_events)': '074f5629448f623222e095a1ce8c3492',
    'public.convert_lead_to_client_atomic(uuid,jsonb)': '7109fdab661eac16ab6ff4f8d8343c20',
    'private.guard_client_lead_conversion()': 'f2558ce56aae6f7db84df1b17f085aa0',
    'private.policy_sale_values(jsonb)': '0269f2a0e1d9c25b82d16ab26f030b3e',
    'public.create_client_with_sale(uuid,uuid,jsonb,boolean)': '0fd439105c6d171366f47220c63805f3',
    'public.convert_lead_to_client_with_sales(uuid,uuid,jsonb,uuid)': '3d974a5c893753d5f10cacd9605c565f',
    'private.has_primary_policy(jsonb)': 'c6caf367f66585beb864cce139b3d43f',
    'private.ensure_policy_identity()': '40832187ea4904e8e52e1e4c124caa0e',
    'private.check_policy_sale_complete()': '01cced1acf2c82b861568c31694058f7',
    'private.guard_policy_win()': '0ecf0cd192f4d0b68d0dadd6861f1415',
    'private.insert_policy_sale(uuid,jsonb,text,uuid)': '3f600b757802c0fa8cc1e17fa5c25575',
    'public.record_client_policy(uuid,uuid,jsonb,boolean)': 'b9ffa1e0b2b1bc9794d70a044f577544',
    'public.update_client_with_policy_sale(uuid,jsonb)': '6313ca0c1fc374a613bfcb7e9e587d4c',
    'private.policy_commission_toggle(uuid,text,boolean,text)': 'abccf48964b101f475fac47e2ab8b6d0',
    'policy_commission_authz.access(uuid)': 'a6da4418b7010c609d5be650615ae643',
    'private.policy_sale_commission_step(text,text,uuid,text,jsonb,boolean,jsonb)': 'caf9041dee7207e00a862388c0df57fd',
    'public.update_client_with_policy_sale_handoff(uuid,uuid,jsonb,jsonb)': '1f9279701aa30d9d6daa7659fe89e33d',
}
AUTHZ_TRIGGER_DIGESTS = {
    ('clients', 'clients_policy_identity'): 'a240538599f6feeff661a86d401c005f',
    ('clients', 'clients_policy_sale_complete'): 'da38e22e29d5c03722f7a1ef99a4beec',
    ('clients', 'clients_lead_conversion_guard'): 'a240a08cc6d1cb8521c761f1f680e739',
    ('wins', 'wins_policy_identity_guard'): 'f23d5129b4f634f42e47f94622e1c36a',
    ('wins', 'wins_policy_sale_complete'): 'ea194c5725a149629919d02c78fc9274',
}
AUTHZ_POLICY_DIGESTS = {
    ('contact_history_events', 'contact_history_events_select'): ('16e3df7111f7cf0313ff219d9615bd21',
                                                                  '336d5ebc5436534e61d16e63ddfca327'),
}
FUNCTION_ACLS.update(AUTHZ_FUNCTION_ACLS)
PREIMAGE_DIGESTS.update(AUTHZ_DIGESTS)
TRIGGER_DIGESTS.update(AUTHZ_TRIGGER_DIGESTS)
POLICY_DIGESTS.update(AUTHZ_POLICY_DIGESTS)
AUTHZ_RLS_TABLES = ['campaigns', 'campaign_leads', 'import_history', 'wins', 'notifications', 'appointments', 'contact_notes',
                    'contact_activities', 'messages', 'workflow_executions', 'call_logs', 'company_settings']
PROFILE_UPDATE_COLUMNS = [
    'auto_dial_preference', 'availability_status', 'avatar_url', 'billing_type', 'carriers', 'commission_level', 'email',
    'email_notifications_enabled', 'first_name', 'is_super_admin', 'last_name', 'licensed_states',
    'local_presence_enabled', 'monthly_appointment_goal', 'monthly_call_goal', 'monthly_policies_goal',
    'monthly_premium_goal', 'monthly_talk_time_goal', 'npn', 'onboarding_complete', 'phone', 'platform_role',
    'push_notifications_enabled', 'resident_state', 'role', 'sms_notifications_enabled', 'status', 'team_id',
    'theme_preference', 'timezone', 'updated_at', 'upline_id', 'weekly_appointment_goal', 'weekly_appointments_goal',
    'win_sound_enabled']


def sql_literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def function_acl_sql(signature, grantees):
    """Reproduce the production ACL text exactly (PUBLIC kept => leave the default and append grants)."""
    roles = [g for g in grantees if g != 'PUBLIC']
    out = []
    if 'PUBLIC' not in grantees:
        out.append(f'REVOKE ALL ON FUNCTION {signature} FROM PUBLIC;')
    if roles:
        out.append(f'GRANT EXECUTE ON FUNCTION {signature} TO {", ".join(roles)};')
    return '\n'.join(out)


def schema_part():
    out = ["""-- ===== hierarchy_fixture.py: schema (verbatim production preimage; disposable local database only) =====
SET client_min_messages = warning;
CREATE EXTENSION IF NOT EXISTS ltree WITH SCHEMA public;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE SCHEMA profile_authz;
CREATE SCHEMA extensions;
CREATE SCHEMA hierarchy_test;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT USAGE ON SCHEMA profile_authz TO authenticated;
GRANT USAGE ON SCHEMA hierarchy_test TO anon, authenticated, service_role;
-- auth.uid(): production definition (pg_get_functiondef, read-only, 2026-10-23).
CREATE OR REPLACE FUNCTION auth.uid()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
-- auth.users: only the columns the hierarchy objects and set_claim touch (Supabase-managed in production).
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
                         raw_user_meta_data jsonb DEFAULT '{}'::jsonb, last_sign_in_at timestamptz,
                         updated_at timestamptz DEFAULT now());
"""]
    out.append('-- ── tables (baseline 20260806000000, verbatim) ──')
    for table in TABLES:
        out.append(block(base, f'CREATE TABLE IF NOT EXISTS "public"."{table}" (', '\n);'))
        out.append(block(base, f'ALTER TABLE ONLY "public"."{table}"\n    ADD CONSTRAINT "{table}_pkey"', ';'))
    out.extend(EXTRA_UNIQUE)
    out.append('-- ── columns added after the baseline (production shape, read-only catalog check 2026-10-23) ──')
    for table, columns in LATER_COLUMNS.items():
        out.append(f'ALTER TABLE public.{table}\n' + ',\n'.join(f'  ADD COLUMN IF NOT EXISTS {c}' for c in columns) + ';')
    for table, name in FOREIGN_KEYS:
        out.append(block(base, f'ALTER TABLE ONLY "public"."{table}"\n    ADD CONSTRAINT "{name}"', ';'))
    out.append('CREATE INDEX "idx_profiles_hierarchy_path" ON "public"."profiles" USING "gist" ("hierarchy_path");')
    out.append('CREATE INDEX "idx_profiles_organization_id" ON "public"."profiles" USING "btree" ("organization_id");')

    out.append('-- ── functions (baseline, verbatim) ──')
    for schema, name in BASELINE_FUNCTIONS:
        out.append(block(base, f'CREATE OR REPLACE FUNCTION "{schema}"."{name}"(', '\n$$;'))
    out.append('-- ── functions and triggers replaced or added after the baseline (verbatim from their migrations) ──')
    for suffix, header, end in MIGRATION_BLOCKS:
        out.append(block(migration(suffix), header, end))
    out.append("""-- ── STUBS (not production): set_claim counts its calls instead of writing auth.users; the two production-only
-- profiles side-effect functions log instead of enqueueing. Their TRIGGER definitions are production's.
CREATE TABLE hierarchy_test.set_claim_calls (n bigserial PRIMARY KEY, uid uuid, claim text, value jsonb);
CREATE TABLE hierarchy_test.side_effects (n bigserial PRIMARY KEY, source text, profile_id uuid);
CREATE FUNCTION public.set_claim(uid uuid, claim text, value jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO hierarchy_test.set_claim_calls (uid, claim, value) VALUES (uid, claim, value);
  RETURN 'OK';
END $$;
CREATE FUNCTION private.on_uv_profile_saved() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  INSERT INTO hierarchy_test.side_effects (source, profile_id) VALUES ('uv_profile_' || lower(TG_OP), coalesce(NEW.id, OLD.id));
  RETURN NULL;
END $$;
CREATE FUNCTION private.enqueue_platform_admin_user_registered() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
BEGIN
  INSERT INTO hierarchy_test.side_effects (source, profile_id) VALUES ('platform_admin_user_registered', NEW.id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.on_uv_profile_saved(), private.enqueue_platform_admin_user_registered() FROM PUBLIC;""")
    out.append('-- ── triggers (baseline, verbatim) ──')
    for name in BASELINE_TRIGGERS:
        out.append(block(base, f'CREATE OR REPLACE TRIGGER "{name}"', ';'))
    out.append('-- production-only profiles triggers: verbatim from their migrations (functions stubbed above)')
    for suffix, header in PRODUCTION_ONLY_TRIGGERS:
        out.append(block(migration(suffix), header, ';'))

    out.append('-- ── RLS and policies (baseline, verbatim), then the later policy migrations (verbatim) ──')
    for table in POLICY_TABLES:
        out.append(f'ALTER TABLE "public"."{table}" ENABLE ROW LEVEL SECURITY;')
        start = 0
        header = 'CREATE POLICY "'
        while True:
            start = base.find(header, start)
            if start < 0:
                break
            line_end = base.index('\n', start)
            if f' ON "public"."{table}" ' in base[start:line_end]:
                out.append(base[start:base.index(';\n\n', start) + 1])
            start = line_end
    for suffix in WHOLE_MIGRATIONS:
        out.append(migration(suffix))
    out.append(authz_part())

    out.append('-- ── ACLs reproducing production (read-only catalog check, 2026-10-23) ──')
    out.append("""REVOKE ALL ON TABLE public.organizations, public.teams, public.agency_group_members FROM PUBLIC;
GRANT SELECT ON TABLE public.organizations, public.teams, public.agency_group_members TO authenticated;
GRANT ALL ON TABLE public.organizations, public.teams, public.agency_group_members TO service_role;
GRANT ALL ON TABLE public.leads, public.clients, public.recruits, public.calls, public.contact_emails, public.tasks,
                   public.role_permissions, public.dispositions TO anon, authenticated, service_role;
REVOKE INSERT ON TABLE public.calls FROM anon;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;
GRANT UPDATE (""" + ', '.join(PROFILE_UPDATE_COLUMNS) + """) ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.invitations TO authenticated;
GRANT UPDATE (status) ON TABLE public.invitations TO authenticated;
GRANT ALL ON TABLE public.invitations TO service_role;
DO $maint$ BEGIN   -- PostgreSQL 17 adds MAINTAIN (production: authenticated=rm on profiles, ardDxtm on invitations)
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'GRANT MAINTAIN ON TABLE public.profiles, public.invitations TO authenticated';
  END IF;
END $maint$;
GRANT SELECT ON TABLE auth.users TO service_role;""")
    for signature, grantees in FUNCTION_ACLS.items():
        out.append(function_acl_sql(signature, grantees))

    out.append(HELPERS)
    rows = []
    for org in SHAPES['organizations']:
        rows.append(f"('organization', {sql_literal(org['key'])}, {sql_literal(org['id'])}::uuid, NULL, NULL, NULL, NULL, NULL)")
    orgs = {o['key']: o['id'] for o in SHAPES['organizations']}
    shape_sets = [('production', SHAPES['shapes']['production']['profiles'])]
    for name, shape in SHAPES['shapes']['invalid'].items():
        if isinstance(shape, dict):
            shape_sets.append((name, shape['profiles']))
    for shape_name, profiles in shape_sets:
        for p in profiles:
            upline = sql_literal(p['upline']) if p['upline'] else 'NULL'
            rows.append(f"({sql_literal(shape_name)}, {sql_literal(p['key'])}, {sql_literal(p['id'])}::uuid, "
                        f"{sql_literal(p['org'])}, {sql_literal(orgs[p['org']])}::uuid, {sql_literal(p['role'])}, "
                        f"{sql_literal(p['status'])}, {upline})")
    out.append('INSERT INTO hierarchy_test.shape (shape, key, id, org_key, org_id, role, status, upline_key) VALUES\n  '
               + ',\n  '.join(rows) + ';')
    out.append('INSERT INTO hierarchy_test.shapes_json (doc) VALUES (' + sql_literal(json.dumps(SHAPES)) + '::jsonb);')
    out.append(f"INSERT INTO hierarchy_test.synthetic_sentinel (marker) VALUES ({sql_literal(SENTINEL)});")
    out.append(preimage_assertions())
    return '\n\n'.join(out) + '\n'


def authz_part():
    """The authorization surface (AUTHZ_* lists): verbatim tables, indexes, functions and triggers."""
    def source(name):
        return base if name == 'baseline' else migration(name)
    out = ["""-- ── authorization surface: the is_ancestor_of callers and what they touch (verbatim) ──
CREATE SCHEMA policy_commission_authz;
REVOKE ALL ON SCHEMA policy_commission_authz FROM PUBLIC;
GRANT USAGE ON SCHEMA policy_commission_authz TO authenticated;
-- RLS is enabled as in production; these tables' policies are NOT reproduced (reached only through definer
-- functions or as the system caller in the suites), so a client read of them fails closed here."""]
    out.append('\n'.join(f'ALTER TABLE public.{t} ENABLE ROW LEVEL SECURITY;' for t in AUTHZ_RLS_TABLES))
    out.extend(AUTHZ_INDEXES)
    for name, header, end in AUTHZ_DDL:
        out.append(block(source(name), header, end))
    for name, header in AUTHZ_FUNCTIONS:
        out.append(function_block(source(name), header))
    for name, header, end in AUTHZ_AFTER:
        out.append(block(source(name), header, end))
    return '\n\n'.join(out)


HELPERS = """-- ── hierarchy_test: helpers for the hierarchy suites (NOT production objects) ──
CREATE TABLE hierarchy_test.synthetic_sentinel (marker text NOT NULL);
CREATE TABLE hierarchy_test.shapes_json (doc jsonb NOT NULL);
CREATE TABLE hierarchy_test.shape (shape text NOT NULL, key text NOT NULL, id uuid NOT NULL, org_key text, org_id uuid,
                                   role text, status text, upline_key text, PRIMARY KEY (shape, key));
GRANT SELECT ON hierarchy_test.shape, hierarchy_test.shapes_json TO anon, authenticated, service_role;
-- id('T') / org('A'): synthetic ids by key (production shape first, then the T8 shapes; organizations by org key).
CREATE FUNCTION hierarchy_test.id(p_key text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT s.id FROM hierarchy_test.shape s WHERE s.key = p_key AND s.shape <> 'organization'
   ORDER BY (s.shape = 'production') DESC, s.shape LIMIT 1 $$;
CREATE FUNCTION hierarchy_test.org(p_key text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT s.id FROM hierarchy_test.shape s WHERE s.shape = 'organization' AND s.key = p_key $$;
CREATE FUNCTION hierarchy_test.key(p_id uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT s.key FROM hierarchy_test.shape s WHERE s.id = p_id AND s.shape <> 'organization'
                    ORDER BY (s.shape = 'production') DESC LIMIT 1), left(p_id::text, 8)) $$;
-- label('T') = the ltree label of a key; sp(path) = a path written as keys ('R.T.A1').
CREATE FUNCTION hierarchy_test.label(p_key text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT replace(hierarchy_test.id(p_key)::text, '-', '_') $$;
CREATE FUNCTION hierarchy_test.sp(p public.ltree) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(hierarchy_test.key(replace(l, '_', '-')::uuid), '.' ORDER BY o)
    FROM unnest(string_to_array(p::text, '.')) WITH ORDINALITY u(l, o) $$;
CREATE FUNCTION hierarchy_test.path_of(VARIADIC p_keys text[]) RETURNS public.ltree LANGUAGE sql STABLE AS $$
  SELECT public.text2ltree(string_agg(hierarchy_test.label(k), '.' ORDER BY o))
    FROM unnest(p_keys) WITH ORDINALITY u(k, o) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hierarchy_test TO anon, authenticated, service_role;
-- claims(uid, role, org[, is_super_admin]): a PostgREST-shaped JWT claim set. role/org NULL => read from the
-- profile row (a FRESH token); pass explicit values to forge a STALE or mismatched token.
CREATE FUNCTION hierarchy_test.claims(p_uid uuid, p_role text DEFAULT NULL, p_org uuid DEFAULT NULL,
                                      p_super boolean DEFAULT NULL) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT json_build_object('sub', p_uid, 'role', 'authenticated',
           'is_super_admin', coalesce(p_super, (SELECT coalesce(p.is_super_admin, false) FROM public.profiles p WHERE p.id = p_uid), false),
           'app_metadata', json_build_object(
             'role', coalesce(p_role, (SELECT p.role FROM public.profiles p WHERE p.id = p_uid)),
             'organization_id', coalesce(p_org, (SELECT p.organization_id FROM public.profiles p WHERE p.id = p_uid))))::text $$;
-- act_as(...): set the session's request.jwt.claims (transaction-local) and return the claim set. act_as(NULL) =
-- system caller (no JWT). Call it BEFORE `SET LOCAL ROLE authenticated`.
CREATE FUNCTION hierarchy_test.act_as(p_uid uuid, p_role text DEFAULT NULL, p_org uuid DEFAULT NULL,
                                      p_super boolean DEFAULT NULL) RETURNS text
LANGUAGE sql VOLATILE SET search_path = pg_catalog, public AS $$
  SELECT set_config('request.jwt.claims',
                    CASE WHEN p_uid IS NULL THEN '' ELSE hierarchy_test.claims(p_uid, p_role, p_org, p_super) END, true) $$;
-- try(sql): run one statement in a subtransaction; 'ACCEPTED' or 'REJECTED <sqlstate>: <message>'.
CREATE FUNCTION hierarchy_test.try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ACCEPTED';
EXCEPTION WHEN OTHERS THEN
  RETURN 'REJECTED ' || SQLSTATE || ': ' || SQLERRM;
END $$;
-- rows(sql): run one row-returning DML/SELECT statement and return its row count (0 when RLS filters every row).
CREATE FUNCTION hierarchy_test.rows(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'WITH x AS (' || p_sql || ') SELECT count(*) FROM x' INTO n;
  RETURN n;
END $$;
-- check(ok, name): 'PASS <name>' or raise 'FAIL: <name>' (the suites run with ON_ERROR_STOP).
CREATE FUNCTION hierarchy_test.check(p_ok boolean, p_name text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: %', p_name;
  END IF;
  RETURN 'PASS ' || p_name;
END $$;
-- eq(actual, expected, name): like check, with both values in the failure message.
CREATE FUNCTION hierarchy_test.eq(p_actual anyelement, p_expected anyelement, p_name text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'FAIL: % (actual %, expected %)', p_name, p_actual, p_expected;
  END IF;
  RETURN 'PASS ' || p_name;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hierarchy_test TO anon, authenticated, service_role;
-- as_user(uid, sql[, role, org, super]): run ONE statement as the real client would — role authenticated with
-- PostgREST-shaped claims (fresh from the profile unless role/org/super are given, i.e. a stale or forged token) —
-- and return 'OK <row count>' or 'REJECTED <sqlstate>: <message>'. A rejected statement leaves no trace.
-- as_anon(sql): the same as role anon with no JWT.
CREATE FUNCTION hierarchy_test.as_user(p_uid uuid, p_sql text, p_role text DEFAULT NULL, p_org uuid DEFAULT NULL,
                                       p_super boolean DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_prev text := coalesce(current_setting('request.jwt.claims', true), '');
  v_n    bigint;
  v_out  text;
BEGIN
  PERFORM set_config('request.jwt.claims', hierarchy_test.claims(p_uid, p_role, p_org, p_super), true);
  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE p_sql;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RESET ROLE;
    v_out := 'OK ' || v_n;
  EXCEPTION WHEN OTHERS THEN
    v_out := 'REJECTED ' || SQLSTATE || ': ' || SQLERRM;
  END;
  PERFORM set_config('request.jwt.claims', v_prev, true);
  RETURN v_out;
END $$;
CREATE FUNCTION hierarchy_test.as_anon(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_prev text := coalesce(current_setting('request.jwt.claims', true), '');
  v_n    bigint;
  v_out  text;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    SET LOCAL ROLE anon;
    EXECUTE p_sql;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RESET ROLE;
    v_out := 'OK ' || v_n;
  EXCEPTION WHEN OTHERS THEN
    v_out := 'REJECTED ' || SQLSTATE || ': ' || SQLERRM;
  END;
  PERFORM set_config('request.jwt.claims', v_prev, true);
  RETURN v_out;
END $$;
-- as_system(sql): the same as the postgres superuser with no JWT (auth.uid() NULL), for system-caller cases.
CREATE FUNCTION hierarchy_test.as_system(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_prev text := coalesce(current_setting('request.jwt.claims', true), '');
  v_n    bigint;
  v_out  text;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := 'OK ' || v_n;
  EXCEPTION WHEN OTHERS THEN
    v_out := 'REJECTED ' || SQLSTATE || ': ' || SQLERRM;
  END;
  PERFORM set_config('request.jwt.claims', v_prev, true);
  RETURN v_out;
END $$;
-- Snapshots of every profile row (path, updated_at, upline, digest of every other column) for "changes nothing" checks.
CREATE TABLE hierarchy_test.snap (tag text, id uuid, path text, upd timestamptz, upline uuid, rest text);
CREATE FUNCTION hierarchy_test.take_snap(p_tag text) RETURNS bigint LANGUAGE sql AS $$
  DELETE FROM hierarchy_test.snap WHERE tag = p_tag;
  INSERT INTO hierarchy_test.snap
  SELECT p_tag, p.id, p.hierarchy_path::text, p.updated_at, p.upline_id,
         md5((to_jsonb(p) - ARRAY['hierarchy_path', 'updated_at', 'upline_id'])::text)
    FROM public.profiles p;
  SELECT count(*) FROM hierarchy_test.snap WHERE tag = p_tag $$;
-- diff_snap(tag): one row per profile that differs from the snapshot; `what` lists path/updated_at/upline/other.
CREATE FUNCTION hierarchy_test.diff_snap(p_tag text) RETURNS TABLE (key text, what text) LANGUAGE sql AS $$
  SELECT hierarchy_test.key(coalesce(p.id, s.id)),
         concat_ws(',',
           CASE WHEN p.id IS NULL THEN 'deleted' WHEN s.id IS NULL THEN 'inserted' END,
           CASE WHEN p.id IS NOT NULL AND s.id IS NOT NULL AND p.hierarchy_path::text IS DISTINCT FROM s.path THEN 'path' END,
           CASE WHEN p.id IS NOT NULL AND s.id IS NOT NULL AND p.updated_at IS DISTINCT FROM s.upd THEN 'updated_at' END,
           CASE WHEN p.id IS NOT NULL AND s.id IS NOT NULL AND p.upline_id IS DISTINCT FROM s.upline THEN 'upline' END,
           CASE WHEN p.id IS NOT NULL AND s.id IS NOT NULL
                 AND md5((to_jsonb(p) - ARRAY['hierarchy_path', 'updated_at', 'upline_id'])::text) IS DISTINCT FROM s.rest
                THEN 'other' END)
    FROM public.profiles p
    FULL JOIN (SELECT * FROM hierarchy_test.snap WHERE tag = p_tag) s ON s.id = p.id
   WHERE p.id IS NULL OR s.id IS NULL
      OR p.hierarchy_path::text IS DISTINCT FROM s.path OR p.updated_at IS DISTINCT FROM s.upd
      OR p.upline_id IS DISTINCT FROM s.upline
      OR md5((to_jsonb(p) - ARRAY['hierarchy_path', 'updated_at', 'upline_id'])::text) IS DISTINCT FROM s.rest
   ORDER BY hierarchy_test.key(coalesce(p.id, s.id)) COLLATE "C" $$;
-- probe(uid, sql[, role, org]): as_user, then report what it changed and ALWAYS roll it back:
-- '<as_user result>|changed=<key:what ...>|stale=<keys>|set_claim=<n>|side_effects=<n>'. uid NULL = system caller.
CREATE FUNCTION hierarchy_test.probe(p_uid uuid, p_sql text, p_role text DEFAULT NULL, p_org uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_result  text;
  v_summary text;
  v_claims  bigint;
  v_side    bigint;
BEGIN
  PERFORM hierarchy_test.take_snap('probe');
  SELECT count(*) INTO v_claims FROM hierarchy_test.set_claim_calls;
  SELECT count(*) INTO v_side FROM hierarchy_test.side_effects;
  BEGIN
    IF p_uid IS NULL THEN
      v_result := hierarchy_test.as_system(p_sql);
    ELSE
      v_result := hierarchy_test.as_user(p_uid, p_sql, p_role, p_org);
    END IF;
    SELECT 'changed=' || coalesce((SELECT string_agg(d.key || ':' || d.what, ' ' ORDER BY d.key COLLATE "C") FROM hierarchy_test.diff_snap('probe') d), '')
           || '|stale=' || coalesce((SELECT string_agg(s.key, ',' ORDER BY s.key COLLATE "C") FROM hierarchy_test.stale() s), '')
           || '|set_claim=' || ((SELECT count(*) FROM hierarchy_test.set_claim_calls) - v_claims)
           || '|side_effects=' || ((SELECT count(*) FROM hierarchy_test.side_effects) - v_side)
      INTO v_summary;
    RAISE EXCEPTION USING ERRCODE = 'HT001', MESSAGE = v_summary;
  EXCEPTION WHEN SQLSTATE 'HT001' THEN
    v_summary := SQLERRM;
  END;
  RETURN v_result || '|' || v_summary;
END $$;
-- canonical(): every profile's canonical path from the upline chain (roots first; cycle-safe; same format).
CREATE FUNCTION hierarchy_test.canonical() RETURNS TABLE (id uuid, path public.ltree)
LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  WITH RECURSIVE canon(id, path, visited) AS (
    SELECT p.id, public.text2ltree(replace(p.id::text, '-', '_')), ARRAY[p.id] FROM public.profiles p WHERE p.upline_id IS NULL
    UNION ALL
    SELECT c.id, k.path || public.text2ltree(replace(c.id::text, '-', '_')), k.visited || c.id
      FROM canon k JOIN public.profiles c ON c.upline_id = k.id WHERE c.id <> ALL (k.visited))
  SELECT id, path FROM canon $$;
-- stale(): profiles whose stored path differs from the canonical one; stale_fingerprint() = M3's fingerprint.
CREATE FUNCTION hierarchy_test.stale() RETURNS TABLE (id uuid, key text, stored text, canonical text)
LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT p.id, hierarchy_test.key(p.id), hierarchy_test.sp(p.hierarchy_path), hierarchy_test.sp(c.path)
    FROM public.profiles p JOIN hierarchy_test.canonical() c ON c.id = p.id
   WHERE p.hierarchy_path IS DISTINCT FROM c.path ORDER BY p.id $$;
CREATE FUNCTION hierarchy_test.stale_fingerprint() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT md5(string_agg(s.id::text, ',' ORDER BY s.id)) FROM hierarchy_test.stale() s $$;
-- consistency(): the path-based measure of M2's private.hierarchy_consistency(), usable in every state.
CREATE FUNCTION hierarchy_test.consistency()
RETURNS TABLE (profiles bigint, edges bigint, expected_pairs bigint, path_pairs bigint, missing_pairs bigint,
               extra_pairs bigint, stale_paths bigint, null_paths bigint, self_parents bigint, cross_org_edges bigint,
               unreachable bigint)
LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  WITH RECURSIVE
  anc(descendant_id, ancestor_id, visited) AS (
    SELECT p.id, p.upline_id, ARRAY[p.id] FROM public.profiles p WHERE p.upline_id IS NOT NULL AND p.upline_id <> p.id
    UNION ALL
    SELECT a.descendant_id, p.upline_id, a.visited || a.ancestor_id
      FROM anc a JOIN public.profiles p ON p.id = a.ancestor_id
     WHERE p.upline_id IS NOT NULL AND p.upline_id <> ALL (a.visited || a.ancestor_id)),
  expected AS (SELECT DISTINCT ancestor_id, descendant_id FROM anc),
  actual AS (SELECT a.id AS ancestor_id, d.id AS descendant_id FROM public.profiles a JOIN public.profiles d ON d.id <> a.id
              WHERE d.hierarchy_path <@ a.hierarchy_path)
  SELECT (SELECT count(*) FROM public.profiles),
         (SELECT count(*) FROM public.profiles WHERE upline_id IS NOT NULL),
         (SELECT count(*) FROM expected),
         (SELECT count(*) FROM actual),
         (SELECT count(*) FROM (SELECT * FROM expected EXCEPT SELECT * FROM actual) m),
         (SELECT count(*) FROM (SELECT * FROM actual EXCEPT SELECT * FROM expected) x),
         (SELECT count(*) FROM hierarchy_test.stale()),
         (SELECT count(*) FROM public.profiles WHERE hierarchy_path IS NULL),
         (SELECT count(*) FROM public.profiles WHERE upline_id = id),
         (SELECT count(*) FROM public.profiles c JOIN public.profiles u ON u.id = c.upline_id
           WHERE c.organization_id IS DISTINCT FROM u.organization_id),
         (SELECT count(*) FROM public.profiles p WHERE NOT EXISTS (SELECT 1 FROM hierarchy_test.canonical() c WHERE c.id = p.id)) $$;
-- missing_pairs(): expected (upline-walk) ancestor pairs the stored paths do not contain, as keys.
CREATE FUNCTION hierarchy_test.missing_pairs() RETURNS TABLE (ancestor text, descendant text)
LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  WITH RECURSIVE anc(descendant_id, ancestor_id, visited) AS (
    SELECT p.id, p.upline_id, ARRAY[p.id] FROM public.profiles p WHERE p.upline_id IS NOT NULL AND p.upline_id <> p.id
    UNION ALL
    SELECT a.descendant_id, p.upline_id, a.visited || a.ancestor_id
      FROM anc a JOIN public.profiles p ON p.id = a.ancestor_id
     WHERE p.upline_id IS NOT NULL AND p.upline_id <> ALL (a.visited || a.ancestor_id))
  SELECT hierarchy_test.key(a.ancestor_id), hierarchy_test.key(a.descendant_id)
    FROM (SELECT DISTINCT ancestor_id, descendant_id FROM anc) a
    JOIN public.profiles pa ON pa.id = a.ancestor_id JOIN public.profiles pd ON pd.id = a.descendant_id
   WHERE NOT (pd.hierarchy_path <@ pa.hierarchy_path) ORDER BY hierarchy_test.key(a.ancestor_id) COLLATE "C", hierarchy_test.key(a.descendant_id) COLLATE "C" $$;
-- acl(regprocedure): EXECUTE grantees, sorted in C order ('PUBLIC' first), as one comma-separated string.
CREATE FUNCTION hierarchy_test.acl(p regprocedure) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(g, ',' ORDER BY g COLLATE "C")
    FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS g
            FROM pg_proc f, aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
           WHERE f.oid = p AND a.privilege_type = 'EXECUTE') s $$;
-- fn_md5 / trg_md5 / pol_md5: digests under the pinned search_path the migrations hash with.
CREATE FUNCTION hierarchy_test.fn_md5(p regprocedure) RETURNS text LANGUAGE sql STABLE
SET search_path = "$user", public, extensions AS $$ SELECT md5(pg_get_functiondef(p)) $$;
CREATE FUNCTION hierarchy_test.trg_md5(p_table regclass, p_name text) RETURNS text LANGUAGE sql STABLE
SET search_path = "$user", public, extensions AS $$
  SELECT md5(pg_get_triggerdef(t.oid)) FROM pg_trigger t WHERE t.tgrelid = p_table AND t.tgname = p_name $$;
CREATE FUNCTION hierarchy_test.pol_md5(p_table regclass, p_name text) RETURNS text LANGUAGE sql STABLE
SET search_path = "$user", public, extensions AS $$
  SELECT md5(coalesce(pg_get_expr(polqual, polrelid), '-')) || '/' || md5(coalesce(pg_get_expr(polwithcheck, polrelid), '-'))
    FROM pg_policy WHERE polrelid = p_table AND polname = p_name $$;
REVOKE ALL ON FUNCTION hierarchy_test.consistency(), hierarchy_test.canonical(), hierarchy_test.stale(),
  hierarchy_test.stale_fingerprint(), hierarchy_test.missing_pairs(), hierarchy_test.take_snap(text),
  hierarchy_test.diff_snap(text), hierarchy_test.as_user(uuid, text, text, uuid, boolean), hierarchy_test.as_anon(text),
  hierarchy_test.as_system(text), hierarchy_test.probe(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;"""


def preimage_assertions():
    rows = []
    for fn, digest in PREIMAGE_DIGESTS.items():
        acl = ','.join(sorted(FUNCTION_ACLS[fn] + ['postgres'], key=lambda s: s.encode())) if fn in FUNCTION_ACLS else None
        rows.append(f"('{fn}', '{digest}', {sql_literal(acl) if acl else 'NULL'})")
    trig = [f"('{t}', '{n}', '{d}')" for (t, n), d in TRIGGER_DIGESTS.items()]
    pols = [f"('{t}', {sql_literal(n)}, '{q}/{c}')" for (t, n), (q, c) in POLICY_DIGESTS.items()]
    return """-- ── the fixture must reproduce the production preimage exactly, or refuse to load ──
DO $fixture$
DECLARE r record; v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      """ + ',\n      '.join(rows) + """) x(fn, digest, acl) LOOP
    v := hierarchy_test.fn_md5(r.fn::regprocedure);
    IF v IS DISTINCT FROM r.digest THEN
      RAISE EXCEPTION 'hierarchy fixture: % digest % differs from production %', r.fn, v, r.digest;
    END IF;
    IF r.acl IS NOT NULL AND hierarchy_test.acl(r.fn::regprocedure) IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'hierarchy fixture: % ACL % differs from production %', r.fn, hierarchy_test.acl(r.fn::regprocedure), r.acl;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      """ + ',\n      '.join(trig) + """) x(tbl, name, digest) LOOP
    v := hierarchy_test.trg_md5(('public.' || r.tbl)::regclass, r.name);
    IF v IS DISTINCT FROM r.digest THEN
      RAISE EXCEPTION 'hierarchy fixture: trigger %.% digest % differs from production %', r.tbl, r.name, v, r.digest;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      """ + ',\n      '.join(pols) + """) x(tbl, name, digest) LOOP
    v := hierarchy_test.pol_md5(('public.' || r.tbl)::regclass, r.name);
    IF v IS DISTINCT FROM r.digest THEN
      RAISE EXCEPTION 'hierarchy fixture: policy %.% digest % differs from production %', r.tbl, r.name, v, r.digest;
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT d.objid) FROM pg_depend d WHERE d.classid = 'pg_policy'::regclass
        AND d.refobjid = 'public.is_ancestor_of(uuid,uuid)'::regprocedure) <> 9 THEN
    RAISE EXCEPTION 'hierarchy fixture: production has 9 policies depending on is_ancestor_of';
  END IF;
  IF (SELECT array_agg(tgname::text ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal)
     IS DISTINCT FROM ARRAY['on_profile_update_trigger', 'profiles_updated_at', 'trg_00_enforce_profile_field_authorization',
                            'trg_cascade_hierarchy_update', 'trg_update_hierarchy_path',
                            'trg_zz_platform_admin_notify_user_registered', 'uv_profile_deleted', 'uv_profile_saved'] THEN
    RAISE EXCEPTION 'hierarchy fixture: profiles trigger set differs from production';
  END IF;
END $fixture$;"""


def data_part():
    prod = SHAPES['shapes']['production']
    by_key = {p['key']: p for p in prod['profiles']}
    orgs = {o['key']: o for o in SHAPES['organizations']}
    out = ["""-- ===== hierarchy_fixture.py: synthetic production-shaped data (written as the system caller through the
-- verbatim preimage triggers, in the order that reproduces production's stale paths) =====
SELECT set_config('request.jwt.claims', '', false);"""]
    out.append('INSERT INTO public.organizations (id, name, slug) VALUES\n  ' + ',\n  '.join(
        f"({sql_literal(o['id'])}, {sql_literal(o['name'])}, {sql_literal('synthetic-' + o['key'].lower())})"
        for o in SHAPES['organizations']) + ';')
    out.append('INSERT INTO auth.users (id, email) VALUES\n  ' + ',\n  '.join(
        f"({sql_literal(p['id'])}, {sql_literal(p['key'].lower() + '@synthetic.invalid')})" for p in prod['profiles']) + ';')
    inserted = set()
    for step in prod['build']:
        op = step['op']
        out.append(f"-- build: {op} {', '.join(step['keys'])}" + (f" -> {step['to']}" if 'to' in step else '')
                   + f"  ({step.get('note', '')})")
        for key in step['keys']:
            p = by_key[key]
            if op == 'insert':
                upline = step.get('initial_upline', {}).get(key, p['upline'])
                assert upline is None or upline in inserted, f'{key}: parent {upline} must be inserted first'
                upline_sql = f"{sql_literal(by_key[upline]['id'])}::uuid" if upline else 'NULL'
                out.append('INSERT INTO public.profiles (id, organization_id, upline_id, role, status, first_name, last_name, email) '
                           f"VALUES ({sql_literal(p['id'])}, {sql_literal(orgs[p['org']]['id'])}, {upline_sql}, "
                           f"{sql_literal(p['role'])}, 'Active', {sql_literal('Synthetic ' + key)}, 'Member', "
                           f"{sql_literal(key.lower() + '@synthetic.invalid')});")
                inserted.add(key)
            elif op == 'touch_upline':
                out.append(f"UPDATE public.profiles SET upline_id = upline_id WHERE id = {sql_literal(p['id'])};")
            elif op == 'move':
                out.append(f"UPDATE public.profiles SET upline_id = {sql_literal(by_key[step['to']]['id'])} "
                           f"WHERE id = {sql_literal(p['id'])};")
            elif op == 'set_status':
                out.append(f"UPDATE public.profiles SET status = {sql_literal(step['status'])} WHERE id = {sql_literal(p['id'])};")
            else:
                raise SystemExit(f'unknown build op {op}')
    for key, p in by_key.items():
        assert key in inserted, key
    out.append("""-- the stored state must be exactly the production shape (upline, role, status of every profile)
DO $shape$
BEGIN
  IF EXISTS (SELECT 1 FROM hierarchy_test.shape s LEFT JOIN public.profiles p ON p.id = s.id
              LEFT JOIN hierarchy_test.shape u ON u.shape = s.shape AND u.key = s.upline_key
              WHERE s.shape = 'production'
                AND (p.id IS NULL OR p.upline_id IS DISTINCT FROM u.id OR p.role <> s.role OR p.status <> s.status
                     OR p.organization_id <> s.org_id))
     OR (SELECT count(*) FROM public.profiles) <> (SELECT count(*) FROM hierarchy_test.shape WHERE shape = 'production') THEN
    RAISE EXCEPTION 'hierarchy fixture: stored profiles differ from the production shape';
  END IF;
END $shape$;
TRUNCATE hierarchy_test.set_claim_calls, hierarchy_test.side_effects;""")
    return '\n'.join(out) + '\n'


def main():
    part = 'all'
    if len(sys.argv) == 3 and sys.argv[1] == '--part' and sys.argv[2] in ('schema', 'data', 'all'):
        part = sys.argv[2]
    elif len(sys.argv) != 1:
        raise SystemExit('usage: hierarchy_fixture.py [--part schema|data|all]')
    if part in ('schema', 'all'):
        sys.stdout.write(schema_part())
    if part in ('data', 'all'):
        sys.stdout.write(data_part())


if __name__ == '__main__':
    main()
