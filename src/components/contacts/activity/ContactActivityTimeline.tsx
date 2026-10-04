import type { ActivityItem } from '@/lib/contact-history/types';
import { ContactActivityItem } from './ContactActivityItem';
interface Props {items:ActivityItem[];loading:boolean;error:string|null;hasMore:boolean;onLoadEarlier:()=>void;onRefresh:()=>void;enrichmentUnavailable?:boolean;captureStartedAt?:string|null;captureHasGaps?:boolean}
export function ContactActivityTimeline({items,loading,error,hasMore,onLoadEarlier,onRefresh,enrichmentUnavailable,captureStartedAt,captureHasGaps}:Props) {
 const current=items.filter(x=>!x.legacy),legacy=items.filter(x=>x.legacy);
 return <div className="px-4 py-3 space-y-2">
  <div className="flex justify-between items-center"><p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recent Timeline</p>
   <button type="button" onClick={onRefresh} disabled={loading} className="text-xs text-primary disabled:opacity-50">Refresh</button></div>
  <p className="text-[10px] text-muted-foreground">{captureStartedAt ? `Detailed changes recorded since ${new Date(captureStartedAt).toLocaleDateString()}. ` : ''}Earlier changes may not have been recorded.</p>
  {captureHasGaps && <p role="status" className="text-xs text-amber-600">Some operational changes could not be recorded. History may be incomplete.</p>}
  {error&&<div role="alert" className="text-xs text-amber-600">{items.length?'History could not refresh. ':''}{error} <button type="button" onClick={onRefresh} className="underline">Retry</button></div>}
  {enrichmentUnavailable&&<p className="text-xs text-muted-foreground">Some agent or campaign names are unavailable. Refresh to retry.</p>}
  <div className="space-y-1.5">{current.map(item=><ContactActivityItem key={item.key} item={item}/>)}</div>
  {legacy.length>0&&<section className="space-y-1.5"><p className="text-[10px] font-semibold text-muted-foreground uppercase">Earlier logged activity</p>
   <p className="text-[10px] text-muted-foreground">Legacy entries may overlap events above; their source links were not recorded.</p>
   {legacy.map(item=><ContactActivityItem key={item.key} item={item}/>)}</section>}
  {loading&&<p role="status" className="text-xs text-muted-foreground">Loading history…</p>}
  {!loading&&!error&&!items.length&&<p className="text-xs text-muted-foreground">No activity recorded yet</p>}
  {hasMore&&<button type="button" disabled={loading} onClick={onLoadEarlier} className="text-xs text-primary disabled:opacity-50">Load earlier</button>}
  {!loading&&!error&&!hasMore&&items.length>0&&<p className="text-[10px] text-muted-foreground">No more recorded events available</p>}
 </div>;
}
