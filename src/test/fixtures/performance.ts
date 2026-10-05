/** Protocol fixtures for request-scheduling tests. Numeric/security parsing is tested separately. */
export function performanceEnvelope(rows: any[], args: Record<string, unknown>, org: string, at: Date) {
  const period = args.p_period;
  const start = new Date(at);
  start.setHours(0,0,0,0);
  if(period === 'month') start.setDate(1);
  if(period === 'week') start.setDate(start.getDate()-(start.getDay()+6)%7);
  return { period, time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone, start_at:start.toISOString(), end_at:at.toISOString(), organization_id:org,
    group_id:args.p_group_id ?? null, roster:'active', excluded:{calls_made:0,appointments_set:0,policies_sold:0},
    rows:rows.map(r=>({organization_id:org,organization_name:'Test Agency',agent_status:'Active',unknown_premiums:0,
      annualized_premium:0,recent_wins_7d:0,estimated_duration_calls:0,unknown_duration_calls:0,conflicting_duration_calls:0, ...r, first_name:r.first_name ?? r.agent_first_name ?? '', last_name:r.last_name ?? r.agent_last_name ?? ''})) };
}
export function performanceFeed(rows: any[]) {
 return rows.map(r=>({ contact_id:null,contact_name:"",campaign_name:"",policy_type:"",premium_amount:null,premium_snapshot:false,celebrated:false,premiumSold:null,premium_known:false,...r }));
}

export function summaryFixture(args: any, current: Record<string,number> = {}, previous: Record<string,number> = {}) {
 const now=new Date(), start=new Date(now), zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 start.setHours(0,0,0,0);
 if(args.p_period==='month'||args.p_period==='year')start.setDate(1);
 if(args.p_period==='year')start.setMonth(0);
 if(args.p_period==='week')start.setDate(start.getDate()-(start.getDay()+6)%7);
 const defaults={calls:0,policies:0,bookings:0,annual_premium:0,monthly_premium:0,unknown_premiums:0,talk_seconds:0,workload:0,leads:0,estimated_duration_calls:0,unknown_duration_calls:0,conflicting_duration_calls:0};
 return { organization_id:'11111111-1111-4111-8111-111111111111',agent_ids:args.p_agent_id?[args.p_agent_id]:null,scope:'personal',period:args.p_period,
  time_zone:zone,start_at:start.toISOString(),end_at:now.toISOString(),previous_start:new Date(start.getTime()-86400000).toISOString(),previous_end:start.toISOString(),workload_end:new Date(now.getTime()+86400000).toISOString(),
  current:{...defaults,...current},previous:{...defaults,...previous} };
}
