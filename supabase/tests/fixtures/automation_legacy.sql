BEGIN;
CREATE FUNCTION pg_temp.i(n int) RETURNS uuid LANGUAGE sql AS $$SELECT ('bce00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
INSERT INTO public.organizations(id,name) VALUES(pg_temp.i(1),'Isolated upgrade');
INSERT INTO public.workflow_folders(id,organization_id,name) VALUES(pg_temp.i(11),pg_temp.i(1),'Older folder');
INSERT INTO public.workflows(id,organization_id,name,trigger_type,status,folder_id,trigger_config) VALUES
(pg_temp.i(12),pg_temp.i(1),'Advanced legacy graph','stage_change','paused',pg_temp.i(11),'{"custom_configuration":"keep"}');
INSERT INTO public.workflow_nodes(id,organization_id,workflow_id,type,action_type,config) VALUES
(pg_temp.i(13),pg_temp.i(1),pg_temp.i(12),'trigger',null,'{"future":"unknown"}'),
(pg_temp.i(14),pg_temp.i(1),pg_temp.i(12),'action','webhook','{"url":"https://example.invalid","test_value":"legacy-webhook"}');
INSERT INTO public.workflow_edges(id,organization_id,workflow_id,source_node_id,target_node_id) VALUES
(pg_temp.i(15),pg_temp.i(1),pg_temp.i(12),pg_temp.i(13),pg_temp.i(14));
INSERT INTO public.workflow_executions(id,workflow_id,organization_id,contact_id,current_node_id,status) VALUES
(pg_temp.i(16),pg_temp.i(12),pg_temp.i(1),pg_temp.i(18),pg_temp.i(14),'completed');
INSERT INTO public.workflow_execution_steps(id,execution_id,organization_id,node_id,status,output_data) VALUES
(pg_temp.i(17),pg_temp.i(16),pg_temp.i(1),pg_temp.i(14),'completed','{"legacy_receipt":"fixture"}');
COMMIT;
