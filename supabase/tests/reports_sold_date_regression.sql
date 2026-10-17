-- Reports Sold Date regression (no Reports source, attribution or security change). Separate synthetic agency
-- (prefix f5200000), so the integrity organizations and their payloads are untouched.
-- Teo-shaped STORED policies entered Oct 16 PDT, sold Oct 15 x3 (primary + additional on one client, plus a
-- second client), Oct 14 x2 and Oct 8 x1, plus one undated policy. Reports counts stored policies by Sold Date
-- and credits the CURRENT assignee; the performance readers keep the original seller.
CREATE FUNCTION rt.sv(p_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('f5200000-0000-0000-0000-'||lpad(p_n::text,12,'0'))::uuid $$;
CREATE FUNCTION rt.ss(p_start date,p_end date) RETURNS jsonb LANGUAGE sql AS $$
 SELECT rt.call(rt.sv(2),rt.sv(1),format('SELECT public.get_report_call_summary_v2(%L,%L,NULL::uuid,''agency'')',p_start,p_end)) $$;
CREATE FUNCTION rt.sa(p jsonb,p_n integer) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce((SELECT e->>'policies_sold' FROM jsonb_array_elements(p->'by_agent') e WHERE (e->>'agent_id')::uuid=rt.sv(p_n)),'0') $$;
INSERT INTO organizations(id,name) VALUES(rt.sv(1),'Synthetic Sold Date agency');
INSERT INTO company_settings(organization_id,timezone) VALUES(rt.sv(1),'America/Los_Angeles');
INSERT INTO profiles(id,organization_id,first_name,last_name,role,status,upline_id) VALUES
(rt.sv(2),rt.sv(1),'Sold','Admin','Admin','Active',NULL),
(rt.sv(3),rt.sv(1),'Sold','Seller','Agent','Active',rt.sv(2)),
(rt.sv(4),rt.sv(1),'Sold','Owner','Agent','Active',rt.sv(2));
INSERT INTO clients(id,organization_id,assigned_agent_id,carrier,premium,sold_date,primary_policy_id,custom_fields,created_at) VALUES
(rt.sv(10),rt.sv(1),rt.sv(3),'Synthetic carrier',58.45,'2026-10-15',rt.sv(110),
 '{"additional_policies":[{"policyId":"f5200000-0000-0000-0000-000000000111","soldDate":"2026-10-15","premiumAmount":"41.64"},{"policyId":"f5200000-0000-0000-0000-000000000112","soldDate":"2026-10-14","premiumAmount":"30"}]}',
 '2026-10-16T19:48:00Z'),
(rt.sv(11),rt.sv(1),rt.sv(3),'Synthetic carrier',50,'2026-10-15',rt.sv(120),'{}','2026-10-16T19:50:00Z'),
(rt.sv(12),rt.sv(1),rt.sv(3),'Synthetic carrier',25,'2026-10-14',rt.sv(130),'{}','2026-10-16T19:56:00Z'),
(rt.sv(13),rt.sv(1),rt.sv(3),'Synthetic carrier',100,'2026-10-08',rt.sv(140),'{}','2026-10-16T20:03:00Z'),
(rt.sv(14),rt.sv(1),rt.sv(3),'Synthetic carrier',70,NULL,rt.sv(150),'{}','2026-10-16T20:05:00Z');
DO $$ DECLARE r jsonb; BEGIN
 r:=rt.ss('2026-10-16','2026-10-16');
 PERFORM rt.eq('entry day has no stored policies',r->'totals'->>'policies_sold','0');
 PERFORM rt.eq('Sold Date basis',r->'policy_basis'->>'sale_date','policy_sold_date');
 PERFORM rt.eq('current-assignment attribution',r->'policy_basis'->>'agent_attribution','current_assignment');
 PERFORM rt.eq('undated policy disclosed, never dated by entry time',(r->'policy_quality'->>'undated_policies')::int>=1,true);
 PERFORM rt.eq('Oct 15 three policies',rt.ss('2026-10-15','2026-10-15')->'totals'->>'policies_sold','3');
 PERFORM rt.eq('Oct 14 two policies',rt.ss('2026-10-14','2026-10-14')->'totals'->>'policies_sold','2');
 PERFORM rt.eq('Oct 8 one policy',rt.ss('2026-10-08','2026-10-08')->'totals'->>'policies_sold','1');
 PERFORM rt.eq('week of Oct 12',rt.ss('2026-10-12','2026-10-16')->'totals'->>'policies_sold','5');
 PERFORM rt.eq('October to date',rt.ss('2026-10-01','2026-10-16')->'totals'->>'policies_sold','6');
 PERFORM rt.eq('seller is the current assignee before reassignment',rt.sa(rt.ss('2026-10-15','2026-10-15'),3),'3');
 -- Reassignment moves Reports credit to the current owner (performance keeps the original seller).
 UPDATE clients SET assigned_agent_id=rt.sv(4) WHERE id=rt.sv(11);
 r:=rt.ss('2026-10-15','2026-10-15');
 PERFORM rt.eq('total unchanged by reassignment',r->'totals'->>'policies_sold','3');
 PERFORM rt.eq('previous owner keeps the other two',rt.sa(r,3),'2');
 PERFORM rt.eq('current owner receives the reassigned policy',rt.sa(r,4),'1');
END $$;
