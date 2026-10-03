import type { ConversationFilter, ConversationItem } from '@/components/contacts/conversation-history/conversationTypes';
export type HistoryContactType = 'lead' | 'client' | 'recruit';
export type HistoryCursor = { [key: string]: import("@/integrations/supabase/types").Json };
export interface HistoryScope { organizationId: string; viewerId: string; contactId: string; contactType: HistoryContactType }
export interface HistoryRow { event_key: string; event_time: string | null; kind: 'call' | 'sms' | 'email' | 'legacy' | 'operation' | 'snapshot'; payload: Record<string, unknown> }
export interface HistoryPage<T> { items: T[]; hasMore: boolean; nextCursor: HistoryCursor | null; enrichmentUnavailable?: boolean; captureStartedAt?: string | null; captureHasGaps?: boolean }
export interface HistoryNames { profiles: Map<string, string>; campaigns: Map<string, string>; dispositions?: Map<string, string> }
export interface ActivityItem { key: string; timestamp: string | null; title: string; actor: string; details: string[]; legacy: boolean }
export interface HistoryResult { conversation: HistoryPage<ConversationItem>; activity: HistoryPage<ActivityItem> }
export interface HistoryRequest { scope: HistoryScope; filter: ConversationFilter; cursor?: HistoryCursor | null; signal: AbortSignal }
