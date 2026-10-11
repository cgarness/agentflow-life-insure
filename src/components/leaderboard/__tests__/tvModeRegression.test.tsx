import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStats } from "../leaderboardTypes";
const h=vi.hoisted(() => ({ reads:vi.fn() }));
vi.mock("@/contexts/AuthContext",()=>({useAuth:()=>({profile:{organization_id:"org",role:"Agent"}})}));
vi.mock("@/contexts/BrandingContext",()=>({useBranding:()=>({branding:{timezone:"UTC",companyName:"Test Agency"},formatDate:String,formatTime:String})}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{from:()=>{
 h.reads(); const q={select:()=>q,eq:()=>q,maybeSingle:()=>Promise.resolve({data:null,error:null})};return q;
}}}));
import TVMode from "../TVMode";
const agents=():AgentStats[]=>Array.from({length:12},(_,i)=>({id:`agent-${i}`,first_name:`Agent${i}`,last_name:"Test",rank:i+1,
 callsMade:i*10,policiesSold:12-i,appointmentsSet:i,talkTime:i*30,conversionRate:i,premiumSold:(12-i)*120,recentWins7d:0}));
const view=(a:AgentStats[],period:"Today"|"This Week"="Today")=><TVMode agents={a} wins={[]} period={period} onPeriodChange={vi.fn()} onExit={vi.fn()}/>;
beforeEach(()=>{localStorage.clear();h.reads.mockClear();vi.useFakeTimers();});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe("TV metric isolation",()=>{
 it("closes settings with Escape without also exiting TV mode",async()=>{
  const onExit=vi.fn();
  render(<TVMode agents={agents()} wins={[]} period="Today" onPeriodChange={vi.fn()} onExit={onExit}/>);
  await act(async()=>{});
  fireEvent.click(screen.getByRole("button",{name:"TV display options"}));
  fireEvent.keyDown(screen.getByLabelText("Viewing metric"),{key:"Escape"});
  expect(onExit).not.toHaveBeenCalled();
  expect(screen.getByRole("button",{name:"TV display options"}).getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByTestId("tv-podium")).toBeTruthy();
  fireEvent.keyDown(document,{key:"Escape"});
  expect(onExit).toHaveBeenCalledOnce();
 });
 it("switches podium cards as one metric selection without mutating the parent ranks or fetching standings",async()=>{
  localStorage.setItem("leaderboardTvAutoRotate","0");
  const rows=agents();const original=structuredClone(rows);render(view(rows));await act(async()=>{});
  const podium=screen.getByTestId("tv-podium");const readCount=h.reads.mock.calls.length;
  fireEvent.click(screen.getByRole("button",{name:"TV display options"}));
  fireEvent.change(screen.getByLabelText("Viewing metric"),{target:{value:"1"}});
  expect(screen.getByTestId("tv-podium")).not.toBe(podium);
  const cards=screen.getByTestId("tv-podium").querySelectorAll("[data-agent-id]");
  expect(Array.from(cards).map(e=>e.getAttribute("data-agent-id"))).toEqual(["agent-10","agent-11","agent-9"]);
  expect(rows).toEqual(original);expect(h.reads).toHaveBeenCalledTimes(readCount);
 });
 it("rotates after 30 seconds and resets podium identity when the period changes",async()=>{
  const rows=agents();const page=render(view(rows));await act(async()=>{});
  const old=screen.getByTestId("tv-podium");
  await act(async()=>{vi.advanceTimersByTime(30_000);});
  expect(screen.getByTestId("tv-podium")).not.toBe(old);
  const current=screen.getByTestId("tv-podium");page.rerender(view(rows,"This Week"));
  expect(screen.getByTestId("tv-podium")).not.toBe(current);
  expect(within(screen.getByTestId("tv-podium")).queryAllByText("Calls Made").length).toBe(3);
 });
 it.each([1,2,3,12])("renders %i agents without inventing or duplicating podium agents",async n=>{
  render(view(agents().slice(0,n)));await act(async()=>{});
  expect(screen.getByTestId("tv-podium").querySelectorAll("[data-agent-id]")).toHaveLength(Math.min(3,n));
 });
});
describe("TV simple labels over unchanged metric ids",()=>{
 it("shows simple names while the stored index keeps selecting the same metric",async()=>{
  localStorage.setItem("leaderboardTvAutoRotate","0");
  localStorage.setItem("leaderboardTvMetricIndex","5"); // index 5 is the "Premium Sold" id
  render(view(agents()));await act(async()=>{});
  fireEvent.click(screen.getByRole("button",{name:"TV display options"}));
  const select=screen.getByLabelText("Viewing metric") as HTMLSelectElement;
  expect(Array.from(select.options).map(o=>[o.textContent,o.value])).toEqual([
   ["Policies Sold","0"],["Calls Made","1"],["Appointments","2"],["Talk Time","3"],["Policies / 100 Calls","4"],["Annual Premium","5"]]);
  expect(select.value).toBe("5");
  expect(within(screen.getByTestId("tv-podium")).getAllByText("Annual Premium")).toHaveLength(3);
  expect(screen.getByText(/Ranking: Annual Premium/)).toBeTruthy();
  fireEvent.change(select,{target:{value:"2"}});
  expect(localStorage.getItem("leaderboardTvMetricIndex")).toBe("2");
  expect(within(screen.getByTestId("tv-podium")).getAllByText("Appointments")).toHaveLength(3);
  expect(screen.queryByText(/Premium Sold|Appointments Set/)).toBeNull();
 });
});
describe("D14 on TV: a wholly unknown premium is never shown as a $0 sale",()=>{
 const agentRow=(i:number,over:Partial<AgentStats>):AgentStats=>({id:`d14-${i}`,first_name:`Name${String.fromCharCode(65+i)}`,last_name:"Test",rank:i+1,
  callsMade:10,policiesSold:1,appointmentsSet:0,talkTime:0,conversionRate:0,premiumSold:0,unknownPremiums:0,recentWins7d:0,...over});
 const premiumView=async(rows:AgentStats[])=>{
  localStorage.setItem("leaderboardTvAutoRotate","0");localStorage.setItem("leaderboardTvMetricIndex","5"); // the "Premium Sold" id
  render(view(rows));await act(async()=>{});
 };
 const totalsPremium=()=>within(screen.getByText("Active-Agent Totals").closest("div.rounded-2xl") as HTMLElement).getByText("Annual Premium").parentElement as HTMLElement;
 const podiumCard=(id:string)=>screen.getByTestId("tv-podium").querySelector(`[data-agent-id="${id}"]`) as HTMLElement;
 it("podium: all-unknown reads —, a known amount and a no-policy $0.00 stay; the roster total keeps its subtotal",async()=>{
  await premiumView([agentRow(0,{policiesSold:2,premiumSold:2400}),agentRow(1,{policiesSold:2,unknownPremiums:2}),agentRow(2,{policiesSold:0})]);
  expect(podiumCard("d14-0")).toHaveTextContent("$2,400.00");
  expect(podiumCard("d14-1")).toHaveTextContent("—");
  expect(podiumCard("d14-1")).not.toHaveTextContent("$0.00");
  expect(podiumCard("d14-2")).toHaveTextContent("$0.00");
  expect(totalsPremium()).toHaveTextContent("$2,400.00");
 });
 it("totals: a roster whose every premium is unknown reads —, never $0.00",async()=>{
  await premiumView([agentRow(0,{policiesSold:2,unknownPremiums:2}),agentRow(1,{policiesSold:1,unknownPremiums:1})]);
  expect(totalsPremium()).toHaveTextContent("—");
  expect(totalsPremium()).not.toHaveTextContent("$0.00");
 });
 it("ranking table and ranks 11+: all-unknown rows read — (with the table's marker); ranks are unchanged",async()=>{
  const rows=Array.from({length:12},(_,i)=>i<9?agentRow(i,{policiesSold:1,premiumSold:(9-i)*100}):agentRow(i,{policiesSold:2,unknownPremiums:2}));
  await premiumView(rows);
  const tableRow=within(screen.getByTestId("tv-rankings")).getByText("NameJ T.").parentElement!.parentElement as HTMLElement;
  expect(tableRow).toHaveTextContent("10");
  expect(tableRow).toHaveTextContent("—*");
  expect(within(screen.getByTestId("tv-rankings")).getByText("NameI T.").parentElement!.parentElement).toHaveTextContent("$100.00");
  const deep=screen.getByText("Ranks 11+").closest("div")!.parentElement as HTMLElement;
  for(const name of ["NameK T.","NameL T."]){
   const item=within(deep).getByText(name).closest("li") as HTMLElement;
   expect(item).toHaveTextContent("—");expect(item).not.toHaveTextContent("$0.00");
  }
 });
});
