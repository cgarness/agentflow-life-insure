import type { PropsWithChildren } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { useCampaignOptions, useSavedMessage, useSavedMessages, useSenderOptions } from "../useAutomationOptions";

const calls = vi.hoisted(() => ({campaigns:vi.fn(),channels:vi.fn(),saved:vi.fn()}));
vi.mock("@/lib/automation-api", () => ({automationApi:{campaigns:calls.campaigns,savedMessages:calls.saved}}));
vi.mock("@/lib/automation-channels", () => ({getAutomationChannelOptions:calls.channels}));
function wrapper({children}: PropsWithChildren) {
  return <QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{children}</QueryClientProvider>;
}
const message = (id: string) => ({id,name:"Message " + id,type:"sms",subject:null,content:"Hi",scope:"agency",sms_purpose:null});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

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

it("resolves a saved sender independently of the first page and pages the remaining senders", async () => {
  const sender = {id:"chosen",from_email:"from@example.invalid",reply_to:"reply@example.invalid"};
  const later = {id:"later",from_email:"later@example.invalid",reply_to:"later@example.invalid"};
  calls.channels.mockImplementation(async ({senderId,offset}) => senderId
    ? {senders:[sender],moreSenders:false}
    : {senders:offset ? [later] : [],moreSenders:!offset});
  const h = renderHook(() => useSenderOptions("tenant","chosen",true),{wrapper});
  await waitFor(() => expect(h.result.current.items).toEqual([sender]));
  expect(h.result.current.missing).toBe(false);
  await act(async () => { await h.result.current.fetchNextPage(); });
  await waitFor(() => expect(h.result.current.items).toEqual([sender,later]));
  expect(calls.channels).toHaveBeenCalledWith({type:"email",offset:50});
  expect(calls.channels).toHaveBeenCalledWith({senderId:"chosen"});
});

it("reports a saved sender that the agency no longer offers", async () => {
  calls.channels.mockResolvedValue({senders:[],moreSenders:false});
  const h = renderHook(() => useSenderOptions("tenant","gone",true),{wrapper});
  await waitFor(() => expect(h.result.current.missing).toBe(true));
});

it("pages saved messages for one channel and search by the number already loaded", async () => {
  calls.saved.mockResolvedValueOnce({items:[message("a"),message("b")],more:true})
    .mockResolvedValueOnce({items:[message("c")],more:false});
  const h = renderHook(() => useSavedMessages("tenant","sms","wel",true),{wrapper});
  await waitFor(() => expect(h.result.current.hasNextPage).toBe(true));
  expect(calls.saved).toHaveBeenCalledWith("sms","wel",0);
  await act(async () => { await h.result.current.fetchNextPage(); });
  await waitFor(() => expect(h.result.current.items.map(item => item.id)).toEqual(["a","b","c"]));
  expect(calls.saved).toHaveBeenLastCalledWith("sms","wel",2);
  expect(h.result.current.hasNextPage).toBe(false);
});

it("finds the saved message a step started from on a later page, and reports one that is gone", async () => {
  calls.saved.mockImplementation(async (_type,_search,offset) => offset
    ? {items:[message("wanted")],more:false}
    : {items:[message("first")],more:true});
  const found = renderHook(() => useSavedMessage("tenant","sms","wanted"),{wrapper});
  await waitFor(() => expect(found.result.current.data?.name).toBe("Message wanted"));
  expect(calls.saved).toHaveBeenLastCalledWith("sms","",1);
  const gone = renderHook(() => useSavedMessage("tenant","sms","deleted"),{wrapper});
  await waitFor(() => expect(gone.result.current.data).toBeNull());
  const idle = renderHook(() => useSavedMessage("tenant","sms",""),{wrapper});
  expect(idle.result.current.fetchStatus).toBe("idle");
});
