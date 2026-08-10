-- Add nullable FK from dispositions to pipeline_stages
ALTER TABLE public.dispositions
  ADD COLUMN pipeline_stage_id uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL;

-- Partial index for efficient lookups on linked dispositions
CREATE INDEX idx_dispositions_pipeline_stage_id
  ON public.dispositions(pipeline_stage_id)
  WHERE pipeline_stage_id IS NOT NULL;
