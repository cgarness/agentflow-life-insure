import type { ActivityItem } from '@/lib/contact-history/types';
import { useBranding } from '@/contexts/BrandingContext';
export function ContactActivityItem({item}:{item:ActivityItem}) {
 const {formatDateTime}=useBranding();
 const time=item.timestamp&&Number.isFinite(Date.parse(item.timestamp))?formatDateTime(new Date(item.timestamp)):'Date not recorded';
 return <div className="border-l-2 border-primary/30 pl-3 py-1.5 hover:bg-muted/50 rounded-r-md transition-colors">
  <p className="text-xs text-foreground leading-snug break-words">{item.title}</p>
  {item.details.map((detail,i)=><p key={i} className="text-[11px] text-muted-foreground mt-1 break-words">{detail}</p>)}
  <p className="text-[10px] text-muted-foreground mt-1">{time} • {item.actor}</p>
 </div>;
}
