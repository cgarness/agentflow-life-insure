-- Simulate a disposition committed by the old client before its separate booking failed.
INSERT INTO calls(id,organization_id,agent_id,contact_id,contact_type,contact_phone,direction,status,dialer_admission_required)
 VALUES(test_uuid(30990),test_uuid(1),test_uuid(11),test_uuid(201),'lead','5551234567','outbound','completed',false);
SELECT test_actor(11);
SET ROLE authenticated;
SELECT advance_campaign_lead(null,test_uuid(30990),test_uuid(505),'2030-10-15T12:00:00Z','Old callback',false,test_uuid(30991),'Old notes');
RESET ROLE;
