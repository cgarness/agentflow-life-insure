import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import TVMode from "../../../src/components/leaderboard/TVMode";
import type {AgentStats,Period} from "../../../src/components/leaderboard/leaderboardTypes";
import "../../../src/index.css";
const rows:AgentStats[]=Array.from({length:14},(_,i)=>({id:`fixture-${i}`,first_name:["Avery","Blake","Casey","Drew","Emerson","Finley","Gray","Harper","Indigo","Jordan","Kai","Logan","Morgan","Noah"][i],last_name:"Test",
 avatar_url:`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="hsl(${i*26} 55% 38%)"/><circle cx="48" cy="36" r="15" fill="white"/><path d="M17 90a31 31 0 0 1 62 0" fill="white"/></svg>`)}`,
 rank:i+1,callsMade:(i+1)*143,policiesSold:14-i,appointmentsSet:(i+1)*2,premiumSold:(14-i)*1857.12,talkTime:(i+1)*1325,conversionRate:((14-i)/((i+1)*143))*100,recentWins7d:0}));
function Fixture(){
 const [agents,setAgents]=useState(rows);const [period,setPeriod]=useState<Period>("This Week");const [show,setShow]=useState(true);
 Object.assign(window,{fixtureSetCount:(n:number)=>setAgents(rows.slice(0,n)),fixtureLiveUpdate:()=>setAgents(a=>a.map((row,i)=>({...row,policiesSold:i===5?99:row.policiesSold}))),fixtureRanks:()=>rows.map(a=>a.rank),fixtureEnter:()=>setShow(true)});
 return show?<TVMode agents={agents} wins={[]} period={period} onPeriodChange={setPeriod} onExit={()=>setShow(false)} winsStatus={{kind:"ok",lastUpdatedAt:1}}/>:<button onClick={()=>setShow(true)}>Enter TV mode</button>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
