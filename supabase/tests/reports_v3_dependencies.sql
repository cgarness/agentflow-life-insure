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
