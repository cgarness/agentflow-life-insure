-- Serialize every pre-existing workflow column, node, edge, folder and execution payload.
CREATE FUNCTION pg_temp.legacy_rows() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'workflows',(SELECT jsonb_agg(to_jsonb(w)-ARRAY['automation_graph','automation_draft_name','automation_revision','automation_version_id'] ORDER BY id) FROM public.workflows w),
    'nodes',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.workflow_nodes n),
    'edges',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.workflow_edges e),
    'folders',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM public.workflow_folders f),
    'runs',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.workflow_executions r),
    'steps',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.workflow_execution_steps s))
$$;
