import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { automationApi } from "@/lib/automation-api";
import { getAutomationChannelOptions } from "@/lib/automation-channels";

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
    getNextPageParam: last => last.length === 50 ? last[last.length - 1].name : undefined,
  });
  const values = new Set(query.data?.pages.flatMap(page => page.map(s => s.name)));
  if (selected) values.add(selected);
  return {...query, items: [...values].sort((a,b) => a.localeCompare(b))};
}

export function useChannelOptions(scope: string, channel: "email" | "sms" | undefined, senderId: string, templateId: string) {
  const query = useInfiniteQuery({
    queryKey: ["automation-channel-page",scope,channel], enabled: !!channel, initialPageParam:0,
    queryFn: ({pageParam}) => getAutomationChannelOptions({type:channel,offset:pageParam}),
    getNextPageParam: (last,all) => last.moreTemplates || (channel === "email" && last.moreSenders) ? all.length * 50 : undefined,
  });
  const selectedSender = useQuery({
    queryKey: ["automation-sender",scope,senderId], enabled: channel === "email" && !!senderId,
    queryFn: () => getAutomationChannelOptions({senderId}),
  });
  const selectedTemplate = useQuery({
    queryKey: ["automation-template",scope,templateId], enabled: !!channel && !!templateId,
    queryFn: () => getAutomationChannelOptions({templateId}),
  });
  const senders = unique([...(selectedSender.data?.senders ?? []),...(query.data?.pages.flatMap(p => p.senders) ?? [])]);
  const templates = unique([...(selectedTemplate.data?.templates ?? []),...(query.data?.pages.flatMap(p => p.templates) ?? [])]);
  return {...query, senders, templates: templates.filter(t => t.type === channel)};
}
