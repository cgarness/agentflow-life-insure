-- READ ONLY: five historical commission candidates in the Chris home organization.
-- Does not calculate/suggest a product as "actually sold", insert estimates, update clients or mark receipts.
-- Run from a trusted read-only SQL session; NEVER run an UPDATE/INSERT to "fix" a missing input.
-- Historical grid caveat: current selected grid might postdate sales; rate/product must be confirmed first.

WITH candidates AS (
  SELECT w.id AS win_id, w.policy_id, w.sold_date, w.agent_id,
         concat_ws(' ',p.first_name,p.last_name) AS credited_agent,
         p.commission_level,
         c.id AS client_id, c.carrier, w.policy_type,
         w.premium_snapshot,
         CASE WHEN w.premium_snapshot AND w.premium_amount > 0
              THEN w.premium_amount ELSE c.premium END AS monthly_premium,
         CASE WHEN w.premium_snapshot AND w.premium_amount > 0
              THEN 'sale_snapshot' ELSE 'policy_record' END AS premium_source,
         c.effective_date,
         CASE w.policy_type WHEN 'Final Expense' THEN 'whole_life'
                            WHEN 'Whole Life' THEN 'whole_life'
                            WHEN 'Term' THEN 'term' WHEN 'IUL' THEN 'iul' END AS grid_category
  FROM public.wins w
  JOIN private.policy_identities pi ON pi.organization_id=w.organization_id
     AND pi.policy_id=w.policy_id AND pi.client_id=w.contact_id AND pi.source='primary'
  JOIN public.clients c ON c.id=pi.client_id AND c.organization_id=w.organization_id
  JOIN public.profiles p ON p.id=w.agent_id AND p.organization_id=w.organization_id
  WHERE w.organization_id='a0000000-0000-0000-0000-000000000001'::uuid
    AND lower(btrim(c.carrier)) IN ('americo','mutual of omaha')
    AND w.sold_date < DATE '2026-10-20'
    AND NOT EXISTS (
      SELECT 1 FROM public.policy_commission_estimates e
      WHERE e.organization_id=w.organization_id AND e.policy_id=w.policy_id
        AND e.status IN ('active','on_hold')
    )
),
review AS (
  SELECT c.*,
    (SELECT jsonb_agg(jsonb_build_object(
       'product_name',pr.product_name,
       'product_id',pr.id,
       'variant_id',v.id,
       'age_optional', v.min_age IS NULL AND v.max_age IS NULL
         AND NOT EXISTS(SELECT 1 FROM public.comp_product_variants vv
                        WHERE vv.product_id=pr.id AND (vv.min_age IS NOT NULL OR vv.max_age IS NOT NULL)),
       'rate_percent',r.rate_percent,
       'selected_grid_effective_date',gr.effective_date,
       'selected_grid_revision',gr.revision
     ) ORDER BY pr.product_name)
       FROM public.organization_comp_settings settings
       JOIN public.comp_grids gr ON gr.id=settings.calculator_grid_id AND gr.is_active
       JOIN public.comp_products pr ON pr.grid_id=gr.id AND pr.is_active
       JOIN public.comp_product_variants v ON v.product_id=pr.id
       JOIN public.comp_rates r ON r.variant_id=v.id AND r.grid_id=gr.id
       WHERE settings.organization_id='a0000000-0000-0000-0000-000000000001'::uuid
         AND (gr.organization_id=settings.organization_id OR gr.organization_id IS NULL
              AND EXISTS(SELECT 1 FROM public.organization_comp_grids enabled
                WHERE enabled.organization_id=settings.organization_id AND enabled.grid_id=gr.id))
         AND lower(btrim(pr.carrier))=lower(btrim(c.carrier))
         AND pr.category=c.grid_category
         AND CASE WHEN c.commission_level ~ '^\\s*[0-9]{1,9}%?\\s*$'
                  THEN substring(c.commission_level FROM '[0-9]+')::integer
                  ELSE NULL END=r.contract_level
    ) AS current_grid_candidates
  FROM candidates c
)
SELECT right(policy_id::text,8) AS policy_suffix, sold_date,
       credited_agent, carrier, policy_type, monthly_premium,premium_source,effective_date,
       coalesce(current_grid_candidates,'[]'::jsonb) AS eligible_current_grid_products,
       (SELECT COUNT(*) FROM review) AS candidate_count,
       CASE WHEN (SELECT COUNT(*) FROM review)=5 AND monthly_premium>0
            THEN 'REVIEW EXACT PRODUCT AND HISTORICAL RATE BEFORE WRITING'
            ELSE 'STOP: MISSING OR CHANGED CANDIDATE DATA' END AS status
FROM review ORDER BY lower(btrim(carrier)),sold_date,policy_suffix;
