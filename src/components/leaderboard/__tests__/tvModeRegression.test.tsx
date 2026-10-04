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
