-- Best-effort backfill: link dispositions to pipeline stages with matching names
-- within the same organization (lead pipeline only)
UPDATE public.dispositions d
SET pipeline_stage_id = ps.id
FROM public.pipeline_stages ps
WHERE lower(trim(d.name)) = lower(trim(ps.name))
  AND d.organization_id = ps.organization_id
  AND ps.pipeline_type = 'lead'
  AND d.pipeline_stage_id IS NULL;
