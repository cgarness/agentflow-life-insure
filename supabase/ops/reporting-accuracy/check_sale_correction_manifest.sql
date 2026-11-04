-- B6 divergence manifest check (D2 §6.7). Read-only; returns no amounts and no names.
-- Run only inside: BEGIN TRANSACTION READ ONLY; <this statement>; ROLLBACK;
--   $1 uuid   the organization
--   $2 jsonb  the manifest's premium entry_error rows: [{"policy_id": "...", "request_id": "..."}, ...]
-- For each row: does the organization's sale for that policy_id have a ledger revision with that request_id?
-- A row without a request_id, a request_id on another sale and one in another organization all fail. pass is true
-- only when every row passes. genuine_later_change rows are not passed in: their record is the reviewed manifest.
WITH manifest AS (
  SELECT m.ord, m.r ->> 'policy_id' AS policy_id, m.r ->> 'request_id' AS request_id
    FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY m(r, ord)
), checked AS (
  SELECT m.ord, m.policy_id, m.request_id,
         m.request_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.wins w
             JOIN private.policy_sale_premium_corrections c ON c.organization_id = w.organization_id AND c.win_id = w.id
            WHERE w.organization_id = $1::uuid AND w.policy_id::text = m.policy_id AND c.request_id::text = m.request_id) AS has_revision
    FROM manifest m
)
SELECT jsonb_build_object(
         'organization_id', $1::uuid,
         'rows', coalesce(jsonb_agg(jsonb_build_object('policy_id', policy_id, 'request_id', request_id,
                                                       'has_revision', has_revision) ORDER BY ord), '[]'::jsonb),
         'pass', coalesce(bool_and(has_revision), true)) AS manifest_check
  FROM checked
