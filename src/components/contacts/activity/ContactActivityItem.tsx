import { useId, useState } from 'react';
import type { ActivityItem } from '@/lib/contact-history/types';
import { useBranding } from '@/contexts/BrandingContext';
import { DetailsToggleButton } from '../conversation-history/CommunicationDetails';

export function ContactActivityItem({ item }: { item: ActivityItem }) {
  const { formatDateTime } = useBranding();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const panelId = useId();
  const time = item.timestamp && Number.isFinite(Date.parse(item.timestamp)) ? formatDateTime(new Date(item.timestamp)) : 'Date not recorded';

  return (
    <div className="border-l-2 border-primary/30 pl-2.5 py-1 rounded-r-md">
      <p className="text-xs text-foreground leading-snug break-words [overflow-wrap:anywhere]">{item.title}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5 break-words">{time} • {item.actor}</p>
      {item.details.length > 0 ? (
        <DetailsToggleButton open={detailsOpen} onClick={() => setDetailsOpen((open) => !open)} panelId={panelId} label="Activity details" />
      ) : null}
      {detailsOpen ? (
        <div id={panelId} className="mt-1 space-y-1">
          {item.details.map((detail, i) => <p key={i} className="text-[11px] text-muted-foreground break-words [overflow-wrap:anywhere]">{detail}</p>)}
        </div>
      ) : null}
    </div>
  );
}
