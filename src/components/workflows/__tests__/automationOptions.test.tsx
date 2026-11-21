import type { PropsWithChildren } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { useCampaignOptions, useChannelOptions } from "../useAutomationOptions";

const calls = vi.hoisted(() => ({campaigns:vi.fn(),channels:vi.fn()}));
vi.mock("@/lib/automation-api", () => ({automationApi:{campaigns:calls.campaigns}}));
vi.mock("@/lib/automation-channels", () => ({getAutomationChannelOptions:calls.channels}));
function wrapper({children}: PropsWithChildren) {
  return <QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{children}</QueryClientProvider>;
}
afterEach(cleanup);
it("retains a saved campaign across empty authorized windows and follows the server cursor", async () => {
  const selected = {id:"chosen",name:"Saved campaign"};
  calls.campaigns.mockResolvedValueOnce({items:[],next_cursor:"cursor",selected})
    .mockResolvedValueOnce({items:[{id:"visible",name:"Alpha"},selected],next_cursor:null,selected});
  const h = renderHook(() => useCampaignOptions("tenant","chosen",true),{wrapper});
  await waitFor(() => expect(h.result.current.hasNextPage).toBe(true));
  expect(h.result.current.items).toEqual([selected]);
  await act(async () => { await h.result.current.fetchNextPage(); });
  await waitFor(() => expect(h.result.current.hasNextPage).toBe(false));
  expect(calls.campaigns).toHaveBeenCalledWith("cursor","chosen");
  expect(h.result.current.items.map(c => c.name)).toEqual(["Alpha","Saved campaign"]);
});
it("resolves a saved sender independently of the initial page and pages remaining email templates", async () => {
  const sender = {id:"chosen",from_email:"from@example.invalid",reply_to:"reply@example.invalid"};
  const template = {id:"later",name:"Later",type:"email",subject:"Hello",content:"Body"};
  calls.channels.mockImplementation(async ({senderId,offset}) => senderId
    ? {senders:[sender],templates:[],moreTemplates:false,moreSenders:false}
    : {senders:[],templates:offset ? [template] : [],moreTemplates:!offset,moreSenders:false});
  const h = renderHook(() => useChannelOptions("tenant","email","chosen",""),{wrapper});
  await waitFor(() => expect(h.result.current.senders).toEqual([sender]));
  await act(async () => { await h.result.current.fetchNextPage(); });
  await waitFor(() => expect(h.result.current.templates).toEqual([template]));
  expect(calls.channels).toHaveBeenCalledWith({type:"email",offset:50});
});
