import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import TVMode from "../../../src/components/leaderboard/TVMode";
import LeaderboardRankingsTable from "../../../src/components/leaderboard/LeaderboardRankingsTable";
import RecentWinsPanel from "../../../src/components/leaderboard/RecentWinsPanel";
import {performanceCaption} from "../../../src/lib/leaderboardExport";
import type {PerformanceSnapshot} from "../../../src/lib/performanceQueries";
import {rankAgents,type AgentStats,type Period,type Win} from "../../../src/components/leaderboard/leaderboardTypes";
import "../../../src/index.css";
const rows:AgentStats[]=Array.from({length:14},(_,i)=>({id:`fixture-${i}`,first_name:["Avery","Blake","Casey","Drew","Emerson","Finley","Gray","Harper","Indigo","Jordan","Kai","Logan","Morgan","Noah"][i],last_name:"Test",
 avatar_url:`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="hsl(${i*26} 55% 38%)"/><circle cx="48" cy="36" r="15" fill="white"/><path d="M17 90a31 31 0 0 1 62 0" fill="white"/></svg>`)}`,
 rank:i+1,callsMade:(i+1)*143,policiesSold:14-i,appointmentsSet:(i+1)*2,premiumSold:(14-i)*1857.12,talkTime:(i+1)*1325,conversionRate:((14-i)/((i+1)*143))*100,recentWins7d:0}));
// Recent Wins, latest entered first: a late entry for an earlier Sold Date, one entered on its Sold Date, one without a Sold Date.
const win=(n:number,sold_date:string|null,entered_at:string,policy_type:string,premiumSold:number|null):Win=>({id:`fixture-win-${n}`,agent_id:`fixture-${n}`,agent_name:`${rows[n].first_name} T.`,
 contact_name:"Fixture Client",campaign_name:"",policy_type,premiumSold,premium_known:premiumSold!=null,celebrated:true,created_at:entered_at,entered_at,sold_date});
const wins:Win[]=[win(0,"2026-10-15","2026-10-16T19:48:00Z","Final Expense",1200),win(1,"2026-10-16","2026-10-16T19:40:00Z","Term Life",499.68),win(2,null,"2026-10-16T19:30:00Z","Whole Life",null)];
// ?routine=1: an everyday snapshot (no unknown premium, no estimated/conflicting durations, nothing outside the roster), so TV draws no caption line.
const routine=new URLSearchParams(location.search).get('routine')==='1';
function Fixture(){
 const [agents,setAgents]=useState(rows);const [period,setPeriod]=useState<Period>("This Week");const [show,setShow]=useState(true);
 // AP ties decided against name order: Harper (7) ties Gray (6) on AP with one more Policy; Jordan (9) ties Indigo (8)
 // on AP and Policies with more Calls. Outside ?routine=1, Noah's (13) only premium is unknown ("—", never $0).
 const shown=agents.map((row,i)=>i===0?{...row,callsMade:0,talkTime:0,premiumSold:701.40,conversionRate:null,unknownPremiums:routine?0:1,unknownDurationCalls:0}
  :i===1?{...row,talkTime:81}
  :i===7?{...row,premiumSold:rows[6].premiumSold,policiesSold:rows[6].policiesSold+1}
  :i===9?{...row,premiumSold:rows[8].premiumSold,policiesSold:rows[8].policiesSold}
  :i===13&&!routine?{...row,premiumSold:0,unknownPremiums:row.policiesSold}:row);
 const snapshot:PerformanceSnapshot={rows:shown,period:period==='Today'?'today':period==='This Week'?'week':'month',time_zone:'America/Los_Angeles',start_at:period==='Today'?'2026-10-03T07:00:00Z':period==='This Month'?'2026-10-01T07:00:00Z':'2026-09-28T07:00:00Z',end_at:'2026-10-04T04:56:52.764028Z',organization_id:'00000000-0000-0000-0000-000000000001',group_id:null,roster:'active',
  policy_date_basis:'sold_date',sold_date_from:period==='Today'?'2026-10-03':period==='This Month'?'2026-10-01':'2026-09-28',sold_date_through:'2026-10-03',undated_policies:0,excluded:routine?{calls_made:0,appointments_set:0,policies_sold:0}:{calls_made:2,appointments_set:1,policies_sold:0}};
 const update=(i:number,change:Partial<AgentStats>)=>setAgents(a=>a.map((row,j)=>j===i?{...row,...change}:row));
 Object.assign(window,{fixtureRows:()=>shown.map(row=>({...row})),fixtureSetCount:(n:number)=>setAgents(rows.slice(0,n)),
  // A new value that keeps every rank (Finley's AP is unique), a Policies tie-break reorder (Gray overtakes Harper), and an AP reorder (Kai to #1).
  fixtureLiveUpdate:()=>update(5,{policiesSold:99}),fixtureTieBreakUpdate:()=>update(6,{policiesSold:10}),fixtureApUpdate:()=>update(10,{premiumSold:30000}),
  fixtureRanks:()=>rows.map(a=>a.rank),fixtureEnter:()=>setShow(true)});
 if(new URLSearchParams(location.search).get('view')==='normal')return <main className="p-4"><p>{performanceCaption(snapshot)}</p><LeaderboardRankingsTable agents={rankAgents(shown.map(row=>({...row})))} view="org" userId="fixture-6" rankAnimations={new Map()} rankMovements={new Map()} rankMotions={new Map()} rankDeltas={new Map()} onExportCsv={()=>{}}/><RecentWinsPanel wins={wins} agents={[]} flashingWinId={null}/></main>;
 return show?<TVMode agents={shown} performanceSnapshot={snapshot} wins={wins} period={period} onPeriodChange={setPeriod} onExit={()=>setShow(false)} winsStatus={{kind:"ok",lastUpdatedAt:1}}/>:<button onClick={()=>setShow(true)}>Enter TV mode</button>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
