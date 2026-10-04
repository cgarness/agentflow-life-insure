import {describe,it,expect,vi,beforeEach} from 'vitest';
const io=vi.hoisted(()=>({data:null as any,error:null as any,rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:io.rpc}}));
import {loadPerformanceSnapshot,loadPerformanceWins} from '../performanceQueries';
import {performancePeriodStart} from '../performancePeriod';
import {leaderboardCsv,csvCell,performanceCaption} from '../leaderboardExport';
import {formatTalkTime,formatPremiumSold,rankAgents} from '@/components/leaderboard/leaderboardTypes';
const org='11111111-1111-4111-8111-111111111111',agent='22222222-2222-4222-8222-222222222222';
const row={agent_id:agent,first_name:'Avery',last_name:'Test',organization_id:org,organization_name:'Agency',agent_status:'Active',calls_made:0,appointments_set:2,policies_sold:8,annualized_premium:9373.92,unknown_premiums:0,talk_time_seconds:81,recent_wins_7d:2,estimated_duration_calls:0,unknown_duration_calls:0,conflicting_duration_calls:0};
const envelope=()=>({period:'month',time_zone:'America/Los_Angeles',start_at:'2026-10-01T07:00:00Z',end_at:'2026-10-04T04:56:52.764Z',organization_id:org,group_id:null,roster:'active',rows:[{...row}],excluded:{calls_made:1,appointments_set:0,policies_sold:0}});
const load=()=>loadPerformanceSnapshot('This Month',null,org,new AbortController().signal);
beforeEach(()=>{io.data=envelope();io.error=null;io.rpc.mockReset().mockImplementation(()=>({abortSignal:async()=>({data:io.data,error:io.error})}));});
describe('performance contract',()=>{
 it('preserves cents, complete seconds and undefined zero-call ratio',async()=>{
  const {data,error}=await load();expect(error).toBeNull();expect(data!.rows[0]).toMatchObject({policiesSold:8,premiumSold:9373.92,talkTime:81,conversionRate:null});
  const csv=leaderboardCsv(data!.rows,data!,true);expect(csv).toContain('"9373.92"');expect(csv).toContain('"81","","0"');expect(csv).toContain('"stale"');expect(csv).toContain('"America/Los_Angeles"');
  expect(performanceCaption(data!)).toContain('Outside active roster: 1 calls');
 });
 it.each(['foreign-row','wrong-org','wrong-period','wrong-group','negative','bad-zone','bad-window','duplicates','impossible-coverage'])('rejects %s without showing zero',async(kind)=>{
  if(kind==='foreign-row')io.data.rows[0].organization_id=agent;
  if(kind==='wrong-org')io.data.organization_id=agent;
  if(kind==='wrong-period')io.data.period='today';
  if(kind==='wrong-group')io.data.group_id=agent;
  if(kind==='negative')io.data.rows[0].calls_made=-1;
  if(kind==='bad-zone')io.data.time_zone='Pacific';
  if(kind==='bad-window')io.data.end_at='2026-12-31T00:00:00Z';
  if(kind==='duplicates')io.data.rows.push({...row});
  if(kind==='impossible-coverage')io.data.rows[0].unknown_premiums=9;
  const r=await load();expect(r.data).toBeNull();expect(r.error).toBeTruthy();
 });
 it('preserves server denial/throttle errors',async()=>{io.error={code:'PT429',message:'busy'};expect((await load()).error).toEqual(io.error);});
 it('uses server feed premium without any client record lookup',async()=>{
  io.data=[{id:agent,agent_id:agent,agent_name:'Seller',contact_id:org,contact_name:'Client',campaign_name:null,policy_type:'Term',premium_amount:0,premium_snapshot:false,created_at:'2026-09-28T12:00:00Z',celebrated:true,premiumSold:900,premium_known:true}];
  const {data,error}=await loadPerformanceWins(null,new AbortController().signal);expect(error).toBeNull();expect(data![0]).toMatchObject({premiumSold:900,celebrated:true});expect(io.rpc).toHaveBeenCalledTimes(1);
 });
 it('sorts undefined ratios last while retaining meaningful >100 ratios',async()=>{
  const {data}=await load(),a=data!.rows[0];const ranked=rankAgents([a,{...a,id:org,callsMade:2,conversionRate:400}],'Policies per 100 Calls');expect(ranked.map(a=>a.conversionRate)).toEqual([400,null]);
 });
});
describe('agency periods',()=>{
 it.each([
  ['Today','2026-03-08T12:00:00Z','2026-03-08T08:00:00.000Z'],
  ['Today','2026-03-09T12:00:00Z','2026-03-09T07:00:00.000Z'],
  ['Today','2026-11-01T12:00:00Z','2026-11-01T07:00:00.000Z'],
  ['This Week','2026-10-05T06:59:59Z','2026-09-28T07:00:00.000Z'],
  ['This Week','2026-10-05T07:00:00Z','2026-10-05T07:00:00.000Z'],
  ['This Month','2027-01-01T07:59:59Z','2026-12-01T08:00:00.000Z'],
  ['This Month','2027-01-01T08:00:00Z','2027-01-01T08:00:00.000Z'],
 ] as const)('%s %s', (period,now,want)=>expect(performancePeriodStart(period,'America/Los_Angeles',new Date(now)).toISOString()).toBe(want));
});
describe('precise display and CSV',()=>{
 it.each([[0,'0s'],[29,'29s'],[52,'52s'],[81,'1m 21s'],[3661,'1h 1m 1s']])('formats %s seconds',(value,want)=>expect(formatTalkTime(value as number)).toBe(want));
 it('retains cents and CSV special characters/formula safety',()=>{
  expect(formatPremiumSold(9373.92)).toBe('$9,373.92');
  expect(csvCell('Smith, "Pat"\nJr')).toBe('"Smith, ""Pat""\nJr"');
  for(const formula of ['=SUM(A1)','+cmd','-cmd','@cmd',' \t=cmd'])expect(csvCell(formula)).toBe('"\''+formula+'"');
  expect(csvCell(-1)).toBe('"-1"');expect(csvCell(null)).toBe('""');
 });
});
