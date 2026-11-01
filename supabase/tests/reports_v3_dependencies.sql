-- =====================================================================================================
-- Reports v3 synthetic dependency schema (plan D1 §9). Disposable synthetic databases only, through
-- scripts/run_reports_v3_tests.sh. It adds the October objects that v3 reads and the v2 harness lacks,
-- with the production names, types, defaults and constraints of
-- 20261005161611_policy_identity_sale_integrity.sql and 20261017043757_performance_wins_sold_date_index.sql.
-- (wins.policy_id, wins.premium_snapshot and clients.primary_policy_id come from
-- reports_integrity_dependencies.sql.) The read-only PKG-A preflight re-checks the live column inventory.
--
-- Functions are NOT written here: scripts/reports_v3_fixture.py extracts private.performance_monthly and
-- private.performance_sale_monthly verbatim from 20261005161623_performance_reporting_contract.sql.
-- =====================================================================================================
ALTER TABLE public.wins ADD COLUMN recorded_at timestamptz;
ALTER TABLE public.wins ALTER COLUMN recorded_at SET DEFAULT clock_timestamp();
ALTER TABLE public.wins ADD COLUMN event_time_source text NOT NULL DEFAULT 'event';
ALTER TABLE public.wins ADD CONSTRAINT wins_event_time_source_check
  CHECK (event_time_source IN ('event', 'sold_date_proxy', 'client_creation_proxy'));
CREATE UNIQUE INDEX wins_policy_identity ON public.wins (organization_id, policy_id) WHERE policy_id IS NOT NULL;

CREATE TABLE private.policy_identities (
  policy_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('primary', 'additional')),
  legacy boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, policy_id)
);
CREATE INDEX policy_identities_client ON private.policy_identities (organization_id, client_id);
ALTER TABLE private.policy_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.policy_identities FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.wins ADD CONSTRAINT wins_policy_registry_fk
  FOREIGN KEY (organization_id, policy_id) REFERENCES private.policy_identities (organization_id, policy_id);

CREATE INDEX performance_wins_org_sold_date ON public.wins (organization_id, sold_date);

-- -----------------------------------------------------------------------------------------------------
-- Calls and journeys (…12; plan D3 §3.1). Production names and types from 20260915035141 (answered_by_agent_id),
-- 20260823222805 (calls.outcome 'forwarded_answered'), 20260915053646 (voicemail_id),
-- 20261003043122 (dialer_admission_required, dialer_outbound_admissions, dialer_conversion_lineage),
-- 20261003192907 (contact_history_events), 20261021200000 (clients.lead_conversion),
-- 20261022062539 (google_sheets_receipts) and the baseline (recruits, import_history).
-- public.phone_last10(text) is extracted verbatim from 20260823222528 by scripts/reports_v3_fixture.py.
-- -----------------------------------------------------------------------------------------------------
ALTER TABLE public.calls ADD COLUMN answered_by_agent_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL;
ALTER TABLE public.calls ADD COLUMN outcome text;
ALTER TABLE public.calls ADD COLUMN voicemail_id uuid;
ALTER TABLE public.calls ADD COLUMN dialer_admission_required boolean NOT NULL DEFAULT false;
CREATE INDEX idx_calls_org_outbound_contact_phone_last10
  ON public.calls (organization_id, public.phone_last10(contact_phone)) WHERE direction = 'outbound';
ALTER TABLE public.clients ADD COLUMN lead_conversion jsonb;

CREATE TABLE private.dialer_outbound_admissions (
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  call_id uuid NOT NULL,
  parent_sid text NOT NULL,
  destination text NOT NULL,
  admitted boolean NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, call_id),
  UNIQUE (parent_sid)
);
ALTER TABLE private.dialer_outbound_admissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.dialer_outbound_admissions FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE private.dialer_conversion_lineage (
  organization_id uuid NOT NULL,
  campaign_lead_id uuid NOT NULL,
  original_lead_id uuid NOT NULL,
  PRIMARY KEY (organization_id, campaign_lead_id)
);
ALTER TABLE private.dialer_conversion_lineage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.dialer_conversion_lineage FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.contact_history_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  contact_id uuid NOT NULL, contact_type text NOT NULL CHECK (contact_type IN ('lead', 'client', 'recruit')),
  source_table text NOT NULL, source_id uuid NOT NULL, action text NOT NULL,
  actor_id uuid, actor_kind text NOT NULL CHECK (actor_kind IN ('agent', 'system')),
  assignee_before uuid, assignee_after uuid, access_ids uuid[] NOT NULL DEFAULT '{}',
  before_values jsonb NOT NULL DEFAULT '{}', after_values jsonb NOT NULL DEFAULT '{}',
  changed_fields text[] NOT NULL DEFAULT '{}', recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  capture_version integer NOT NULL DEFAULT 1
);
ALTER TABLE public.contact_history_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_history_events FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX contact_history_events_page
  ON public.contact_history_events (organization_id, contact_id, contact_type, recorded_at DESC, id DESC);

CREATE TABLE public.recruits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL DEFAULT '',
  organization_id uuid
);

CREATE TABLE public.import_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  imported_lead_ids jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  organization_id uuid,
  import_completion_status text,
  undo_status text CHECK (undo_status IS NULL OR undo_status = 'undone'),
  undone_at timestamptz,
  undone_by uuid
);

CREATE TABLE private.google_sheets_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  spreadsheet_id text NOT NULL,
  sheet_id bigint NOT NULL,
  receipt_key text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('imported', 'imported_flagged', 'skipped_duplicate')),
  lead_id uuid,
  source_id uuid,
  fingerprint text NOT NULL,
  row_number integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, spreadsheet_id, sheet_id, receipt_key)
);
REVOKE ALL ON private.google_sheets_receipts FROM PUBLIC, anon, authenticated, service_role;
-- Current numbers of a person (exclusion evidence only, plan §2.11): baseline clients.phone and campaign_leads.phone.
ALTER TABLE public.clients ADD COLUMN phone text NOT NULL DEFAULT '';
ALTER TABLE public.campaign_leads ADD COLUMN phone text DEFAULT '';
