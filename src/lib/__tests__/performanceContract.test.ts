import {describe,it,expect,vi,beforeEach} from 'vitest';
const io=vi.hoisted(()=>({data:null as any,error:null as any,rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:io.rpc}}));
import {loadPerformanceSnapshot,loadPerformanceWins} from '../performanceQueries';
import {performancePeriodStart} from '../performancePeriod';
import {leaderboardCsv,csvCell,performanceCaption,outsideRosterNote} from '../leaderboardExport';
import {formatTalkTime,formatPremiumSold,rankAgents} from '@/components/leaderboard/leaderboardTypes';
const org='11111111-1111-4111-8111-111111111111',agent='22222222-2222-4222-8222-222222222222';
const row={agent_id:agent,first_name:'Avery',last_name:'Test',organization_id:org,organization_name:'Agency',agent_status:'Active',calls_made:0,appointments_set:2,policies_sold:8,annualized_premium:9373.92,unknown_premiums:0,talk_time_seconds:81,recent_wins_7d:2,estimated_duration_calls:0,unknown_duration_calls:0,conflicting_duration_calls:0};
const envelope=()=>({period:'month',time_zone:'America/Los_Angeles',start_at:'2026-10-01T07:00:00Z',end_at:'2026-10-04T04:56:52.764Z',organization_id:org,group_id:null,roster:'active',
 policy_date_basis:'sold_date',sold_date_from:'2026-10-01',sold_date_through:'2026-10-03',undated_policies:0,rows:[{...row}],excluded:{calls_made:1,appointments_set:0,policies_sold:0}});
const load=()=>loadPerformanceSnapshot('This Month',null,org,new AbortController().signal);
beforeEach(()=>{io.data=envelope();io.error=null;io.rpc.mockReset().mockImplementation(()=>({abortSignal:async()=>({data:io.data,error:io.error})}));});
// Routine methodology and legacy_unknown provenance never appear in the on-screen notes (Part B, PB-9 to PB-11).
const ROUTINE_COPY=/Active agents|As of|America\/Los_Angeles|unknown provenance|Stored call duration/;
const noExcluded=(d:any)=>{d.excluded={calls_made:0,appointments_set:0,policies_sold:0};};
const captionOf=async(edit:(d:any)=>void)=>{edit(io.data);const {data,error}=await load();expect(error).toBeNull();return performanceCaption(data!);};
describe('performance contract',()=>{
 it('preserves cents, complete seconds and undefined zero-call ratio',async()=>{
  const {data,error}=await load();expect(error).toBeNull();expect(data!.rows[0]).toMatchObject({policiesSold:8,premiumSold:9373.92,talkTime:81,conversionRate:null});
  const csv=leaderboardCsv(data!.rows,data!,true);expect(csv).toContain('"9373.92"');expect(csv).toContain('"81","","0"');expect(csv).toContain('"stale"');expect(csv).toContain('"America/Los_Angeles"');
  expect(performanceCaption(data!)).toContain('Outside active roster: 1 calls');
 });
 it('captions the annual premium in simple wording while the CSV headers keep their contract',async()=>{
  io.data.rows[0].unknown_premiums=3;
  const {data}=await load();const caption=performanceCaption(data!);
  expect(caption).toBe('Annual premium (3 policies with unknown premium) · Outside active roster: 1 calls, 0 appointments, 0 policies');
  expect(caption).toContain('Outside active roster: 1 calls, 0 appointments, 0 policies');
  expect(caption).not.toMatch(/annualized|bookings/i);
  expect(caption).not.toMatch(ROUTINE_COPY);
  const csv=leaderboardCsv(data!.rows,data!);
  expect(csv).toContain('"Policies Sold","Annualized Premium USD","Unknown Premium Policies","Appointments Set"');
 });
 it('exports the agency Sold Date window and the undated count with every row',async()=>{
  io.data.undated_policies=2;
  const {data}=await load();const [headers,first]=leaderboardCsv(data!.rows,data!).split('\r\n');
  expect(headers.endsWith('"Snapshot Status","Sold Date From","Sold Date Through","Policies Without Sold Date (All Time)"')).toBe(true);
  expect(first.endsWith('"current","2026-10-01","2026-10-03","2"')).toBe(true);
 });
 it.each(['missing-basis','entry-basis','utc-through','utc-from','undated-negative'])('rejects a %s Sold Date payload without showing sales',async(kind)=>{
  // An older backend (entry-time counts) or a window not on the agency calendar is never shown as Sold Date sales.
  if(kind==='missing-basis')delete io.data.policy_date_basis;
  if(kind==='entry-basis')io.data.policy_date_basis='created_at';
  if(kind==='utc-through')io.data.sold_date_through='2026-10-04';
  if(kind==='utc-from')io.data.sold_date_from='2026-09-30';
  if(kind==='undated-negative')io.data.undated_policies=-1;
  const r=await load();expect(r.data).toBeNull();expect(r.error).toBeTruthy();
 });
 it('names the Sold Date window error for a non-agency calendar window',async()=>{
  io.data.sold_date_through='2026-10-04';
  expect((await load()).error?.message).toBe('Standings returned an invalid Sold Date window. Retry.');
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
  io.data=[{id:agent,agent_id:agent,agent_name:'Seller',contact_id:org,contact_name:'Client',campaign_name:null,policy_type:'Term',premium_amount:0,premium_snapshot:false,created_at:'2026-09-28T12:00:00Z',celebrated:true,premiumSold:900,premium_known:true,
   sold_date:'2026-09-25',entered_at:'2026-09-28T12:00:00Z'}];
  const {data,error}=await loadPerformanceWins(null,new AbortController().signal);expect(error).toBeNull();expect(data![0]).toMatchObject({premiumSold:900,celebrated:true});expect(io.rpc).toHaveBeenCalledTimes(1);
  expect(data![0]).toMatchObject({sold_date:'2026-09-25',entered_at:'2026-09-28T12:00:00Z',created_at:'2026-09-28T12:00:00Z'});
 });
 it('keeps an unknown Sold Date as null and rejects a feed without the Sold Date fields',async()=>{
  const win={id:agent,agent_id:agent,agent_name:'Seller',contact_id:null,contact_name:'Client',campaign_name:null,policy_type:'Term',premium_amount:75,premium_snapshot:true,created_at:'2026-10-16T19:48:00+00:00',celebrated:false,premiumSold:900,premium_known:true};
  io.data=[{...win,sold_date:null,entered_at:'2026-10-16T19:48:00+00:00'}];
  expect((await loadPerformanceWins(null,new AbortController().signal)).data![0].sold_date).toBeNull();
  for(const bad of [{...win},{...win,sold_date:'10/15/2026',entered_at:'2026-10-16T19:48:00+00:00'},{...win,sold_date:'2026-10-15'}]){
   io.data=[bad];const r=await loadPerformanceWins(null,new AbortController().signal);expect(r.data).toBeNull();expect(r.error).toBeTruthy();
  }
 });
 it('sorts undefined ratios last while retaining meaningful >100 ratios',async()=>{
  const {data}=await load(),a=data!.rows[0];const ranked=rankAgents([a,{...a,id:org,callsMade:2,conversionRate:400}],'Policies per 100 Calls');expect(ranked.map(a=>a.conversionRate)).toEqual([400,null]);
 });
});
describe('on-screen performance notes (material only)',()=>{
 it('a routine snapshot has no caption at all',async()=>{
  expect(await captionOf(noExcluded)).toBe('');
 });
 it('the legacy_unknown duration default alone never produces a note',async()=>{
  expect(await captionOf(d=>{noExcluded(d);Object.assign(d.rows[0],{calls_made:5,unknown_duration_calls:5});})).toBe('');
 });
 it.each([
  ['estimated only, singular',{estimated_duration_calls:1},'Talk time includes 1 estimated call duration'],
  ['estimated only, plural',{estimated_duration_calls:2},'Talk time includes 2 estimated call durations'],
  ['conflicting only, singular',{conflicting_duration_calls:1},'Talk time includes 1 conflicting call duration'],
  ['conflicting only, plural',{conflicting_duration_calls:3},'Talk time includes 3 conflicting call durations'],
  ['both',{estimated_duration_calls:1,conflicting_duration_calls:1},'Talk time includes 1 estimated and 1 conflicting call durations'],
  ['both, with legacy unknown alongside',{estimated_duration_calls:2,unknown_duration_calls:3,conflicting_duration_calls:1},'Talk time includes 2 estimated and 1 conflicting call durations'],
 ] as const)('talk time note: %s',async(_label,counts,want)=>{
  const caption=await captionOf(d=>{noExcluded(d);Object.assign(d.rows[0],{calls_made:10},counts);});
  expect(caption).toBe(want);
  expect(caption).not.toMatch(ROUTINE_COPY);
 });
 it('sums estimated and conflicting durations across rows',async()=>{
  const caption=await captionOf(d=>{noExcluded(d);Object.assign(d.rows[0],{calls_made:4,estimated_duration_calls:1});
   d.rows.push({...row,agent_id:'33333333-3333-4333-8333-333333333333',calls_made:4,conflicting_duration_calls:2});});
  expect(caption).toBe('Talk time includes 1 estimated and 2 conflicting call durations');
 });
 it('joins every material note in order: premium, talk time, outside roster',async()=>{
  const caption=await captionOf(d=>Object.assign(d.rows[0],{calls_made:6,unknown_premiums:3,estimated_duration_calls:1,unknown_duration_calls:4}));
  expect(caption).toBe('Annual premium (3 policies with unknown premium) · Talk time includes 1 estimated call duration · Outside active roster: 1 calls, 0 appointments, 0 policies');
  expect(caption).not.toMatch(ROUTINE_COPY);
 });
 it.each([
  [{calls_made:0,appointments_set:0,policies_sold:0},''],
  [{calls_made:1,appointments_set:0,policies_sold:0},'Outside active roster: 1 calls, 0 appointments, 0 policies'],
  [{calls_made:0,appointments_set:3,policies_sold:0},'Outside active roster: 0 calls, 3 appointments, 0 policies'],
  [{calls_made:0,appointments_set:0,policies_sold:2},'Outside active roster: 0 calls, 0 appointments, 2 policies'],
  [{calls_made:4,appointments_set:5,policies_sold:6},'Outside active roster: 4 calls, 5 appointments, 6 policies'],
 ])('outsideRosterNote(%o)',async(excluded,want)=>{
  io.data.excluded=excluded;const {data}=await load();expect(outsideRosterNote(data!)).toBe(want);
 });
 it('outsideRosterNote ignores the premium and talk time notes',async()=>{
  noExcluded(io.data);Object.assign(io.data.rows[0],{calls_made:6,unknown_premiums:3,estimated_duration_calls:1,conflicting_duration_calls:1});
  const {data}=await load();
  expect(outsideRosterNote(data!)).toBe('');
  expect(performanceCaption(data!)).toBe('Annual premium (3 policies with unknown premium) · Talk time includes 1 estimated and 1 conflicting call durations');
 });
});
describe('undated Sold Date disclosure',()=>{
 it.each([[0,''],[1,'1 policy without a Sold Date not counted'],[3,'3 policies without a Sold Date not counted']] as const)('undated_policies=%s',async(n,want)=>{
  expect(await captionOf(d=>{noExcluded(d);d.undated_policies=n;})).toBe(want);
 });
 it('appends the undated note after every other material note',async()=>{
  const caption=await captionOf(d=>{d.undated_policies=2;d.rows[0].unknown_premiums=3;});
  expect(caption).toBe('Annual premium (3 policies with unknown premium) · Outside active roster: 1 calls, 0 appointments, 0 policies · 2 policies without a Sold Date not counted');
  expect(caption).not.toMatch(ROUTINE_COPY);
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
