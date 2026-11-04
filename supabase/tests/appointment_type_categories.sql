-- PKG-D appointment type categories (D4 §3.2, §7). Synthetic organizations only (reporting_fixture.py appointments
-- mode), after 20261104120040 and before the category baseline. The six seeded orgs' 36 locked defaults predate …40,
-- so they are still unclassified.
SELECT test_assert((SELECT count(*) = 36 AND bool_and(business_category = 'unclassified') FROM appointment_types), '36 pre-…40 defaults stay unclassified');
SELECT test_assert(NOT has_function_privilege(r, f, 'EXECUTE'), r || ' cannot execute ' || f)
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r,
       unnest(ARRAY['private.guard_appointment_type_classification()', 'private.audit_appointment_type_category()',
                    'private.appointment_type_state_at(uuid,timestamptz)', 'private.appointment_type_seed_category(text)']) f;
SELECT test_assert(NOT has_table_privilege(r, 'private.appointment_type_category_events', 'SELECT'), r || ' cannot read the type history')
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r;
SELECT test_assert(NOT EXISTS ((SELECT policyname, qual, with_check FROM test_policy_snapshot
                                  EXCEPT SELECT policyname, qual, with_check FROM pg_policies WHERE tablename IN ('appointments', 'appointment_types'))
                                 UNION ALL
                                 (SELECT policyname, qual, with_check FROM pg_policies WHERE tablename IN ('appointments', 'appointment_types')
                                  EXCEPT SELECT policyname, qual, with_check FROM test_policy_snapshot)),
                   'appointment RLS policies unchanged');
SELECT test_reject($q$UPDATE appointment_types SET business_category = 'bogus' WHERE name = 'Other' AND organization_id = test_uuid(1)$q$, '23514');

-- As an Admin through RLS: locked defaults are managed by AgentFlow.
SELECT test_actor(19, 1, 'Admin'); SET ROLE authenticated;
SELECT test_reject($q$UPDATE appointment_types SET name = 'Sales Meeting' WHERE name = 'Sales Call' AND organization_id = test_uuid(1)$q$, '42501');
SELECT test_reject($q$UPDATE appointment_types SET is_active = false WHERE name = 'Sales Call' AND organization_id = test_uuid(1)$q$, '42501');
SELECT test_reject($q$UPDATE appointment_types SET business_category = 'other' WHERE name = 'Sales Call' AND organization_id = test_uuid(1)$q$, '42501');
SELECT test_reject($q$INSERT INTO appointment_types(organization_id, name, color, is_locked) VALUES (test_uuid(1), 'Locked Custom', '#111111', true)$q$, '42501');
SELECT test_reject($q$INSERT INTO appointment_types(organization_id, name, color, is_default) VALUES (test_uuid(1), 'Default Custom', '#111111', true)$q$, '42501');
-- A colour change on a locked row is still allowed (not an audited field).
UPDATE appointment_types SET color = '#2563EB' WHERE name = 'Sales Call' AND organization_id = test_uuid(1);
INSERT INTO appointment_types(id, organization_id, name, color, business_category) VALUES (test_uuid(42001), test_uuid(1), 'Discovery', '#123456', 'sales');
INSERT INTO appointment_types(id, organization_id, name, color) VALUES (test_uuid(42002), test_uuid(1), 'Policy Delivery', '#654321');
UPDATE appointment_types SET business_category = 'service' WHERE id = test_uuid(42002);
UPDATE appointment_types SET name = 'Delivery Visit' WHERE id = test_uuid(42002);
UPDATE appointment_types SET is_active = false WHERE id = test_uuid(42002);
UPDATE appointment_types SET color = '#654322' WHERE id = test_uuid(42002);
RESET ROLE;

SELECT test_assert((SELECT classified_by = test_uuid(19) AND classified_at IS NOT NULL FROM appointment_types WHERE id = test_uuid(42001)),
                   'a custom classification is stamped');
SELECT test_assert((SELECT string_agg(concat_ws('|', coalesce(name_before, '-'), name_after, coalesce(is_active_before::text, '-'), is_active_after,
                                                 coalesce(category_before, '-'), category_after, source, changed_by = test_uuid(19)), ' ; ' ORDER BY id)
                      FROM private.appointment_type_category_events WHERE type_id = test_uuid(42002))
                   = '-|Policy Delivery|-|t|-|unclassified|settings|t ; Policy Delivery|Policy Delivery|true|t|unclassified|service|settings|t ; '
                     'Policy Delivery|Delivery Visit|true|t|service|service|settings|t ; Delivery Visit|Delivery Visit|true|f|service|service|settings|t',
                   'insert, classification, rename and deactivation each write one event; a colour change writes none');
SELECT test_assert((SELECT count(*) = 0 FROM private.appointment_type_category_events e JOIN appointment_types t ON t.id = e.type_id
                     WHERE t.name = 'Sales Call' AND t.organization_id = test_uuid(1)), 'a locked colour change writes no event');
-- The type history answers "what was this type called, and how was it classified, at that instant".
SELECT test_assert((SELECT name || '|' || category FROM private.appointment_type_state_at(test_uuid(42002),
                      (SELECT changed_at FROM private.appointment_type_category_events WHERE type_id = test_uuid(42002) ORDER BY id LIMIT 1)))
                   = 'Policy Delivery|unclassified', 'state at insert');
SELECT test_assert((SELECT name || '|' || is_active || '|' || category FROM private.appointment_type_state_at(test_uuid(42002), clock_timestamp()))
                   = 'Delivery Visit|false|service', 'state now');
SELECT test_assert((SELECT count(*) = 0 FROM private.appointment_type_state_at(test_uuid(42002), '2000-01-01')), 'no state before the type existed');
SELECT test_assert((SELECT name || '|' || category FROM private.appointment_type_state_at(
                      (SELECT id FROM appointment_types WHERE name = 'Follow Up' AND organization_id = test_uuid(1)), '2000-01-01'))
                   = 'Follow Up|unclassified', 'a pre-…40 type without events reads its current row');

-- A new organization's seed (DEFINER, as in production) maps the locked defaults and records system_seed events.
SAVEPOINT seed;
INSERT INTO organizations(id, name) VALUES (test_uuid(8), 'Synthetic 8');
SELECT seed_default_appointment_types(test_uuid(8));
SELECT test_assert((SELECT string_agg(name || '=' || business_category, ',' ORDER BY name) FROM appointment_types WHERE organization_id = test_uuid(8))
                   = 'Follow Up=follow_up,Other=other,Policy Anniversary=review,Policy Review=review,Recruit Interview=recruiting,Sales Call=sales',
                   'new-org seed categories');
SELECT test_assert((SELECT count(*) = 6 AND bool_and(source = 'system_seed') FROM private.appointment_type_category_events WHERE organization_id = test_uuid(8)),
                   'six system_seed events');
ROLLBACK TO SAVEPOINT seed;

SELECT test_reject($q$UPDATE private.appointment_type_category_events SET source = 'settings'$q$, '23514');
SELECT test_reject($q$DELETE FROM private.appointment_type_category_events$q$, '23514');
SELECT test_reject($q$TRUNCATE private.appointment_type_category_events$q$, '23514');
-- The ops source GUC accepts only the two ops values.
SELECT test_reject($q$SELECT set_config('agentflow.appointment_category_source', 'settings', true); UPDATE appointment_types SET business_category = 'other' WHERE id = test_uuid(42001)$q$, '22023');

-- Remove the custom types again so the approved baseline count (36 locked, 0 custom) holds.
ALTER TABLE appointment_types DISABLE TRIGGER appointment_types_category_audit;
DELETE FROM appointment_types WHERE id IN (test_uuid(42001), test_uuid(42002));
ALTER TABLE appointment_types ENABLE TRIGGER appointment_types_category_audit;
