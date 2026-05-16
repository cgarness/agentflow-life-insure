-- One-time operational data wipe for Family First Life - Chris Garness (AgentFlow home org).
-- Preserves: organizations, profiles/auth users, role_permissions, company_settings,
-- phone_settings, phone_numbers, dispositions, pipeline_stages, business_hours,
-- inbound_routing_settings, contact_management_settings, training library, custom_menu_links.

CREATE OR REPLACE FUNCTION public.wipe_organization_operational_data(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counts jsonb := '{}'::jsonb;
  v_n bigint;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'p_org_id is required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'organization % not found', p_org_id;
  END IF;

  DELETE FROM dialer_lead_locks WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('dialer_lead_locks', v_n);

  DELETE FROM workflow_execution_steps
  WHERE execution_id IN (SELECT id FROM workflow_executions WHERE organization_id = p_org_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('workflow_execution_steps', v_n);

  DELETE FROM workflow_executions WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('workflow_executions', v_n);

  DELETE FROM workflow_edges
  WHERE workflow_id IN (SELECT id FROM workflows WHERE organization_id = p_org_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('workflow_edges', v_n);

  DELETE FROM workflow_nodes
  WHERE workflow_id IN (SELECT id FROM workflows WHERE organization_id = p_org_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('workflow_nodes', v_n);

  DELETE FROM workflows WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('workflows', v_n);

  DELETE FROM workflow_folders WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('workflow_folders', v_n);

  DELETE FROM chat_messages
  WHERE group_id IN (SELECT id FROM chat_groups WHERE organization_id = p_org_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('chat_messages', v_n);

  DELETE FROM chat_group_members
  WHERE group_id IN (SELECT id FROM chat_groups WHERE organization_id = p_org_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('chat_group_members', v_n);

  DELETE FROM chat_groups WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('chat_groups', v_n);

  DELETE FROM agency_group_resources
  WHERE agency_group_id IN (
    SELECT id FROM agency_groups
    WHERE master_organization_id = p_org_id
       OR id IN (
         SELECT agency_group_id FROM agency_group_members WHERE organization_id = p_org_id
       )
  );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('agency_group_resources', v_n);

  DELETE FROM agency_group_members WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('agency_group_members', v_n);

  DELETE FROM agency_groups WHERE master_organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('agency_groups', v_n);

  DELETE FROM agency_resources WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('agency_resources', v_n);

  DELETE FROM agency_resource_categories WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('agency_resource_categories', v_n);

  DELETE FROM dialer_queue_state
  WHERE campaign_id IN (SELECT id FROM campaigns WHERE organization_id = p_org_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('dialer_queue_state', v_n);

  DELETE FROM calls WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('calls', v_n);

  DELETE FROM call_logs WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('call_logs', v_n);

  DELETE FROM contact_notes WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('contact_notes', v_n);

  DELETE FROM contact_activities WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('contact_activities', v_n);

  DELETE FROM contact_emails WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('contact_emails', v_n);

  DELETE FROM messages WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('messages', v_n);

  DELETE FROM appointments WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('appointments', v_n);

  DELETE FROM clients WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('clients', v_n);

  DELETE FROM recruits WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('recruits', v_n);

  DELETE FROM campaign_leads
  WHERE campaign_id IN (SELECT id FROM campaigns WHERE organization_id = p_org_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('campaign_leads', v_n);

  DELETE FROM campaigns WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('campaigns', v_n);

  DELETE FROM dialer_daily_stats
  WHERE agent_id IN (SELECT id FROM profiles WHERE organization_id = p_org_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('dialer_daily_stats', v_n);

  DELETE FROM dialer_sessions WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('dialer_sessions', v_n);

  DELETE FROM leads WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('leads', v_n);

  DELETE FROM import_history WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('import_history', v_n);

  DELETE FROM activity_logs WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('activity_logs', v_n);

  DELETE FROM notifications WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('notifications', v_n);

  DELETE FROM invitations WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('invitations', v_n);

  DELETE FROM goals WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('goals', v_n);

  DELETE FROM wins WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('wins', v_n);

  DELETE FROM agent_scorecards WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('agent_scorecards', v_n);

  DELETE FROM custom_fields WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('custom_fields', v_n);

  DELETE FROM saved_reports WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('saved_reports', v_n);

  DELETE FROM scheduled_reports WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('scheduled_reports', v_n);

  DELETE FROM report_layouts WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('report_layouts', v_n);

  DELETE FROM training_progress WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('training_progress', v_n);

  DELETE FROM lead_source_costs WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('lead_source_costs', v_n);

  DELETE FROM lead_sources WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('lead_sources', v_n);

  DELETE FROM dnc_list WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('dnc_list', v_n);

  DELETE FROM email_oauth_states WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('email_oauth_states', v_n);

  DELETE FROM email_sync_cursors WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('email_sync_cursors', v_n);

  DELETE FROM user_email_connections WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('user_email_connections', v_n);

  DELETE FROM phone_number_reputation_checks WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('phone_number_reputation_checks', v_n);

  DELETE FROM call_scripts WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('call_scripts', v_n);

  DELETE FROM message_templates WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('message_templates', v_n);

  DELETE FROM carriers WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('carriers', v_n);

  UPDATE profiles SET team_id = NULL WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('profiles_team_cleared', v_n);

  DELETE FROM teams WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('teams', v_n);

  DELETE FROM provisioning_errors WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('provisioning_errors', v_n);

  DELETE FROM calendar_integrations
  WHERE user_id IN (SELECT id FROM profiles WHERE organization_id = p_org_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('calendar_integrations', v_n);

  DELETE FROM user_preferences
  WHERE user_id IN (SELECT id FROM profiles WHERE organization_id = p_org_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('user_preferences', v_n);

  RETURN v_counts;
END;
$$;

REVOKE ALL ON FUNCTION public.wipe_organization_operational_data(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wipe_organization_operational_data(uuid) TO service_role;

-- Execute wipe for Chris Garness home org (requested 2026-05-16).
DO $$
DECLARE
  v_org_id uuid := 'a0000000-0000-0000-0000-000000000001';
  v_result jsonb;
BEGIN
  v_result := public.wipe_organization_operational_data(v_org_id);
  RAISE NOTICE 'wipe_organization_operational_data(%): %', v_org_id, v_result;
END;
$$;
