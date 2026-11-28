import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { automationApi, type SavedMessage } from "@/lib/automation-api";
import { getAutomationChannelOptions } from "@/lib/automation-channels";

export type MessageChannel = "sms" | "email";
const PAGE = 50;
// A step remembers only the saved message's ID, so finding it again means reading the list.
const LOOKUP_PAGES = 6;

function unique<T extends {id: string}>(rows: T[]) {
  return [...new Map(rows.map(row => [row.id,row])).values()];
}

export function useCampaignOptions(scope: string, selected: string, enabled: boolean) {
  const query = useInfiniteQuery({
    queryKey: ["automation-campaigns",scope,selected], enabled, initialPageParam:"",
    queryFn: ({pageParam}) => automationApi.campaigns(pageParam,selected),
    getNextPageParam: last => last.next_cursor ?? undefined,
  });
  const items = unique(query.data?.pages.flatMap(page => [...page.items,...(page.selected ? [page.selected] : [])]) ?? []);
  return {...query, items: items.sort((a,b) => a.name.localeCompare(b.name))};
}

export function useSourceOptions(scope: string, selected: string, enabled: boolean) {
  const query = useInfiniteQuery({
    queryKey: ["automation-sources",scope], enabled, initialPageParam:"",
    queryFn: ({pageParam}) => automationApi.sources(pageParam),
    getNextPageParam: last => last.length === PAGE ? last[last.length - 1].name : undefined,
  });
  const values = new Set(query.data?.pages.flatMap(page => page.map(s => s.name)));
  if (selected) values.add(selected);
  return {...query, items: [...values].sort((a,b) => a.localeCompare(b))};
}

/** Shares its cache entry with the step summaries, which read the same list for names. */
export function useDispositionOptions(scope: string, enabled: boolean) {
  return useQuery({
    queryKey: ["automation-dispositions",scope], enabled, staleTime: 60_000, retry: false,
    queryFn: () => automationApi.dispositions(),
  });
}

/** Verified email senders. The saved sender is resolved on its own so it shows before its page loads. */
export function useSenderOptions(scope: string, selected: string, enabled: boolean) {
  const query = useInfiniteQuery({
    queryKey: ["automation-senders",scope], enabled, initialPageParam:0,
    queryFn: ({pageParam}) => getAutomationChannelOptions({type:"email",offset:pageParam}),
    getNextPageParam: (last,all) => last.moreSenders ? all.length * PAGE : undefined,
  });
  const saved = useQuery({
    queryKey: ["automation-sender",scope,selected], enabled: enabled && !!selected,
    queryFn: () => getAutomationChannelOptions({senderId:selected}),
  });
  const items = unique([...(saved.data?.senders ?? []),...(query.data?.pages.flatMap(page => page.senders) ?? [])]);
  // True only once both lookups answered without the saved sender.
  const missing = !!selected && saved.isSuccess && query.isSuccess && !items.some(sender => sender.id === selected);
  return {...query, items, missing};
}

export function useSavedMessages(scope: string, channel: MessageChannel, search: string, enabled: boolean) {
  const query = useInfiniteQuery({
    queryKey: ["automation-saved-messages",scope,channel,search], enabled, initialPageParam:0,
    queryFn: ({pageParam}) => automationApi.savedMessages(channel,search,pageParam),
    getNextPageParam: (last,all) => last.more ? all.reduce((count,page) => count + page.items.length,0) : undefined,
    placeholderData: keepPreviousData,
  });
  return {...query, items: unique(query.data?.pages.flatMap(page => page.items) ?? [])};
}

export function savedMessageKey(scope: string, channel: MessageChannel, id: string) {
  return ["automation-saved-message",scope,channel,id];
}

/** The saved message a step started from, or null when it is not in the list the author can read. */
export function useSavedMessage(scope: string, channel: MessageChannel, id: string) {
  return useQuery<SavedMessage | null>({
    queryKey: savedMessageKey(scope,channel,id), enabled: !!id, staleTime: 60_000,
    queryFn: async () => {
      let offset = 0;
      for (let page = 0; page < LOOKUP_PAGES; page++) {
        const result = await automationApi.savedMessages(channel,"",offset);
        const found = result.items.find(item => item.id === id);
        if (found || !result.more || !result.items.length) return found ?? null;
        offset += result.items.length;
      }
      return null;
    },
  });
}
