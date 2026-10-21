import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStats } from "../leaderboardTypes";
const h=vi.hoisted(() => ({ reads:vi.fn(), role:"Agent" }));
vi.mock("@/contexts/AuthContext",()=>({useAuth:()=>({profile:{organization_id:"org",role:h.role}})}));
vi.mock("@/contexts/BrandingContext",()=>({useBranding:()=>({branding:{timezone:"UTC",companyName:"Test Agency"},formatDate:String,formatTime:String})}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{from:()=>{
 h.reads(); const q={select:()=>q,eq:()=>q,maybeSingle:()=>Promise.resolve({data:null,error:null})};return q;
}}}));
import TVMode from "../TVMode";
// AP rises with the index, so AP order (agent-11 first) is the reverse of the incoming rank field and of Policies.
const agents=():AgentStats[]=>Array.from({length:12},(_,i)=>({id:`agent-${i}`,first_name:`Agent${i}`,last_name:"Test",rank:i+1,
 callsMade:i*10,policiesSold:12-i,appointmentsSet:i,talkTime:i*30,conversionRate:i,premiumSold:i*120,recentWins7d:0}));
const view=(a:AgentStats[],period:"Today"|"This Week"="Today")=><TVMode agents={a} wins={[]} period={period} onPeriodChange={vi.fn()} onExit={vi.fn()}/>;
const podiumIds=()=>Array.from(screen.getByTestId("tv-podium").querySelectorAll("[data-agent-id]")).map(e=>e.getAttribute("data-agent-id"));
beforeEach(()=>{localStorage.clear();h.reads.mockClear();h.role="Agent";vi.useFakeTimers();});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe("TV ranks by AP only",()=>{
 it("an Admin's options hold only the ticker editor (no metric selector, no auto-rotate), and Escape closes them without exiting",async()=>{
  h.role="Admin";
  const onExit=vi.fn();
  render(<TVMode agents={agents()} wins={[]} period="Today" onPeriodChange={vi.fn()} onExit={onExit}/>);
  await act(async()=>{});
  fireEvent.click(screen.getByRole("button",{name:"TV display options"}));
  const editor=screen.getByLabelText("Scrolling ticker (org-wide)");
  expect(screen.queryByLabelText("Viewing metric")).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByRole("switch")).toBeNull();
  expect(screen.queryByText(/Auto-rotate|Cycles metrics/)).toBeNull();
  fireEvent.keyDown(editor,{key:"Escape"});
  expect(onExit).not.toHaveBeenCalled();
  expect(screen.getByRole("button",{name:"TV display options"}).getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByTestId("tv-podium")).toBeTruthy();
  fireEvent.keyDown(document,{key:"Escape"});
  expect(onExit).toHaveBeenCalledOnce();
 });
 it("an Agent has nothing to configure: no options button; the clock, title and exit stay",async()=>{
  render(view(agents()));await act(async()=>{});
  expect(screen.queryByRole("button",{name:"TV display options"})).toBeNull();
  expect(screen.getByRole("button",{name:"Exit TV mode"})).toBeTruthy();
  expect(screen.getByRole("heading",{name:"Test Agency"})).toBeTruthy();
  expect(screen.getByText(/\d{1,2}:\d{2}:\d{2} [AP]M/)).toBeTruthy();
 });
 it("ranks podium, ranks 4–10 and 11+ by AP without mutating the parent rows or fetching standings",async()=>{
  const rows=agents();const original=structuredClone(rows);render(view(rows));await act(async()=>{});
  expect(podiumIds()).toEqual(["agent-10","agent-11","agent-9"]); // slots 2 / 1 / 3
  const table=within(screen.getByTestId("tv-rankings"));
  expect(table.getAllByText(/^Agent\d+ T\.$/).map(e=>e.textContent)).toEqual(["Agent8 T.","Agent7 T.","Agent6 T.","Agent5 T.","Agent4 T.","Agent3 T.","Agent2 T."]);
  const deep=within(screen.getByText("Ranks 11+").closest("div")!.parentElement as HTMLElement);
  expect(deep.getAllByText(/^Agent\d+ T\.$/).map(e=>e.textContent)).toEqual(["Agent1 T.","Agent0 T."]);
  expect(rows).toEqual(original);
  expect(h.reads).toHaveBeenCalledTimes(2); // the TV name and banner reads only — never standings
 });
 it("never rotates: the podium keeps its identity and AP order past 30, 60 and 90 seconds",async()=>{
  render(view(agents()));await act(async()=>{});
  const podium=screen.getByTestId("tv-podium");
  for(const _ of [1,2,3]) await act(async()=>{vi.advanceTimersByTime(30_000);});
  expect(screen.getByTestId("tv-podium")).toBe(podium);
  expect(podiumIds()).toEqual(["agent-10","agent-11","agent-9"]);
  expect(screen.getByText("Live Ranking · Annual Premium")).toBeTruthy();
 });
 it("ignores and removes the obsolete metric and auto-rotate preferences",async()=>{
  localStorage.setItem("leaderboardTvMetricIndex","1");localStorage.setItem("leaderboardTvAutoRotate","1");
  render(view(agents()));await act(async()=>{});
  expect(podiumIds()).toEqual(["agent-10","agent-11","agent-9"]);
  expect(localStorage.getItem("leaderboardTvMetricIndex")).toBeNull();
  expect(localStorage.getItem("leaderboardTvAutoRotate")).toBeNull();
 });
 it("resets podium identity when the period changes",async()=>{
  const rows=agents();const page=render(view(rows));await act(async()=>{});
  const current=screen.getByTestId("tv-podium");page.rerender(view(rows,"This Week"));
  expect(screen.getByTestId("tv-podium")).not.toBe(current);
 });
 it("podium and tables show Annual Premium, Policies and Calls; totals show Annual Premium and Policies — no Appointments, Talk Time or Policies / 100 Calls",async()=>{
  render(view(agents()));await act(async()=>{});
  const header=screen.getByText("Rank").parentElement as HTMLElement;
  expect(Array.from(header.children).map(e=>e.textContent)).toEqual(["Rank","Agent","Annual Premium","Policies","Calls"]);
  expect(screen.getByText("Ranks 11+").parentElement).toHaveTextContent("Annual Premium");
  const totals=screen.getByText("Active-Agent Totals").closest("div.rounded-2xl") as HTMLElement;
  expect(Array.from(totals.querySelectorAll("p")).map(e=>e.textContent)).toEqual(["Annual Premium","Policies"]);
  expect(within(totals).getByText("Annual Premium").parentElement).toHaveTextContent("$7,920.00");
  expect(within(totals).getByText("Policies").parentElement).toHaveTextContent("78");
  expect(totals.textContent).not.toMatch(/calls/i);
  const gold=screen.getByTestId("tv-podium").querySelector('[data-agent-id="agent-11"]') as HTMLElement;
  expect(gold.textContent).toMatch(/\$1,320\.00Annual Premium.*1 Policies.*110 Calls/);
  expect(document.body.textContent).not.toMatch(/appointment|appts|talk|per 100|\/ 100/i);
  expect(document.body.textContent).not.toMatch(/\bAP\b|Annualized/);
 });
 it.each([1,2,3,12])("renders %i agents without inventing or duplicating podium agents",async n=>{
  render(view(agents().slice(0,n)));await act(async()=>{});
  expect(screen.getByTestId("tv-podium").querySelectorAll("[data-agent-id]")).toHaveLength(Math.min(3,n));
 });
});
describe("D14 on TV: a wholly unknown premium is never shown as a $0 sale",()=>{
 // callsMade 37 never collides with a rank number; equal AP, Policies and Calls order by name (compareAgentsByAp).
 const agentRow=(i:number,over:Partial<AgentStats>):AgentStats=>({id:`d14-${i}`,first_name:`Name${String.fromCharCode(65+i)}`,last_name:"Test",rank:i+1,
  callsMade:37,policiesSold:1,appointmentsSet:0,talkTime:0,conversionRate:0,premiumSold:0,unknownPremiums:0,recentWins7d:0,...over});
 const premiumView=async(rows:AgentStats[])=>{
  render(view(rows));await act(async()=>{});
 };
 const totalsPremium=()=>within(screen.getByText("Active-Agent Totals").closest("div.rounded-2xl") as HTMLElement).getByText("Annual Premium").parentElement as HTMLElement;
 const podiumCard=(id:string)=>screen.getByTestId("tv-podium").querySelector(`[data-agent-id="${id}"]`) as HTMLElement;
 const tableRow=(name:string)=>within(screen.getByTestId("tv-rankings")).getByText(name).parentElement!.parentElement as HTMLElement;
 const deepItem=(name:string)=>within(screen.getByText("Ranks 11+").closest("div")!.parentElement as HTMLElement).getByText(name).closest("li") as HTMLElement;
 it("podium: all-unknown reads —; a known amount and a genuine known $0 keep their values; the roster total keeps its subtotal",async()=>{
  await premiumView([agentRow(0,{policiesSold:2,premiumSold:2400}),agentRow(1,{policiesSold:2,unknownPremiums:2}),agentRow(2,{policiesSold:1}),agentRow(3,{policiesSold:0})]);
  expect(podiumCard("d14-0")).toHaveTextContent("$2,400.00");
  expect(podiumCard("d14-1")).toHaveTextContent("—");
  expect(podiumCard("d14-1")).not.toHaveTextContent("$0.00");
  expect(podiumCard("d14-2")).toHaveTextContent("$0.00"); // policies sold, every premium known, total $0
  expect(podiumCard("d14-2")).not.toHaveTextContent("—");
  expect(tableRow("NameD T.").firstElementChild).toHaveTextContent(/^4/);
  expect(tableRow("NameD T.")).toHaveTextContent("$0.00"); // no policies
  expect(totalsPremium()).toHaveTextContent("$2,400.00");
 });
 it("totals: a roster whose every premium is unknown reads —; a roster of genuine known $0 reads $0.00",async()=>{
  await premiumView([agentRow(0,{policiesSold:2,unknownPremiums:2}),agentRow(1,{policiesSold:1,unknownPremiums:1})]);
  expect(totalsPremium()).toHaveTextContent("—");
  expect(totalsPremium()).not.toHaveTextContent("$0.00");
  cleanup();localStorage.clear();
  await premiumView([agentRow(0,{policiesSold:2}),agentRow(1,{policiesSold:1})]);
  expect(totalsPremium()).toHaveTextContent("$0.00");
  expect(totalsPremium()).not.toHaveTextContent("—");
 });
 it("ranking table and ranks 11+: all-unknown rows read — (the table keeps its marker); genuine $0 rows read $0.00; ranks follow the unchanged order",async()=>{
  // Every $0 row has one policy, so the name tie-break keeps ranks 9–12 in name order.
  const rows=Array.from({length:12},(_,i)=>i<8?agentRow(i,{premiumSold:(8-i)*100}):i===9||i===10?agentRow(i,{policiesSold:1,unknownPremiums:1}):agentRow(i,{}));
  await premiumView(rows);
  expect(tableRow("NameI T.").firstElementChild).toHaveTextContent(/^9/);
  expect(tableRow("NameI T.")).toHaveTextContent("$0.00");
  expect(tableRow("NameI T.")).not.toHaveTextContent("—");
  expect(tableRow("NameJ T.").firstElementChild).toHaveTextContent(/^10/);
  expect(tableRow("NameJ T.")).toHaveTextContent("—*");
  expect(tableRow("NameH T.")).toHaveTextContent("$100.00");
  expect(deepItem("NameK T.").querySelector("span")).toHaveTextContent(/^11$/);
  expect(deepItem("NameK T.")).toHaveTextContent("—");
  expect(deepItem("NameK T.")).not.toHaveTextContent("$0.00");
  expect(deepItem("NameL T.").querySelector("span")).toHaveTextContent(/^12$/);
  expect(deepItem("NameL T.")).toHaveTextContent("$0.00");
  expect(deepItem("NameL T.")).not.toHaveTextContent("—");
 });
});
