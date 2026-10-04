import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import TVMode from "../../../src/components/leaderboard/TVMode";
import LeaderboardRankingsTable from "../../../src/components/leaderboard/LeaderboardRankingsTable";
import {performanceCaption} from "../../../src/lib/leaderboardExport";
import type {PerformanceSnapshot} from "../../../src/lib/performanceQueries";
import type {AgentStats,Period} from "../../../src/components/leaderboard/leaderboardTypes";
import "../../../src/index.css";
const rows:AgentStats[]=Array.from({length:14},(_,i)=>({id:`fixture-${i}`,first_name:["Avery","Blake","Casey","Drew","Emerson","Finley","Gray","Harper","Indigo","Jordan","Kai","Logan","Morgan","Noah"][i],last_name:"Test",
 avatar_url:`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="hsl(${i*26} 55% 38%)"/><circle cx="48" cy="36" r="15" fill="white"/><path d="M17 90a31 31 0 0 1 62 0" fill="white"/></svg>`)}`,
 rank:i+1,callsMade:(i+1)*143,policiesSold:14-i,appointmentsSet:(i+1)*2,premiumSold:(14-i)*1857.12,talkTime:(i+1)*1325,conversionRate:((14-i)/((i+1)*143))*100,recentWins7d:0}));
function Fixture(){
 const [agents,setAgents]=useState(rows);const [period,setPeriod]=useState<Period>("This Week");const [show,setShow]=useState(true);
 const shown=agents.map((row,i)=>i===0?{...row,callsMade:0,talkTime:0,premiumSold:701.40,conversionRate:null,unknownPremiums:1,unknownDurationCalls:0}:i===1?{...row,talkTime:81}:row);
 const snapshot:PerformanceSnapshot={rows:shown,period:period==='Today'?'today':period==='This Week'?'week':'month',time_zone:'America/Los_Angeles',start_at:period==='Today'?'2026-10-03T07:00:00Z':period==='This Month'?'2026-10-01T07:00:00Z':'2026-09-28T07:00:00Z',end_at:'2026-10-04T04:56:52.764028Z',organization_id:'00000000-0000-0000-0000-000000000001',group_id:null,roster:'active',excluded:{calls_made:2,appointments_set:1,policies_sold:0}};
 Object.assign(window,{fixtureSetCount:(n:number)=>setAgents(rows.slice(0,n)),fixtureLiveUpdate:()=>setAgents(a=>a.map((row,i)=>({...row,policiesSold:i===5?99:row.policiesSold}))),fixtureRanks:()=>rows.map(a=>a.rank),fixtureEnter:()=>setShow(true)});
 if(new URLSearchParams(location.search).get('view')==='normal')return <main className="p-4"><p>{performanceCaption(snapshot)}</p><LeaderboardRankingsTable restAgents={shown} view="org" rankAnimations={new Map()} rankMovements={new Map()} rankMotions={new Map()} rankDeltas={new Map()} onExportCsv={()=>{}}/></main>;
 return show?<TVMode agents={shown} performanceSnapshot={snapshot} wins={[]} period={period} onPeriodChange={setPeriod} onExit={()=>setShow(false)} winsStatus={{kind:"ok",lastUpdatedAt:1}}/>:<button onClick={()=>setShow(true)}>Enter TV mode</button>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
