import { useEffect, useState } from 'react';
import { getContactLocalTime, getContactTimezone, isGoodTimeToCall } from '@/utils/contactLocalTime';

interface ContactLocalTimeProps {
  state: string;
  size?: 'sm' | 'md';
}

export function ContactLocalTime({ state, size = 'sm' }: ContactLocalTimeProps) {
  const [time, setTime] = useState(() => getContactLocalTime(state));
  const [tz, setTz] = useState(() => getContactTimezone(state));
  const status = isGoodTimeToCall(state);

  useEffect(() => {
    setTime(getContactLocalTime(state));
    setTz(getContactTimezone(state));
    const interval = setInterval(() => {
      setTime(getContactLocalTime(state));
    }, 30000);
    return () => clearInterval(interval);
  }, [state]);

  if (!time) return null;

  const dotColor =
    status === 'good' ? 'bg-success' :
    status === 'early' ? 'bg-warning' :
    status === 'late' ? 'bg-destructive' :
    'bg-muted-foreground';

  const textSize = size === 'md' ? 'text-sm' : 'text-xs';

  return (
    <span className={`inline-flex items-center gap-1 ${textSize} text-muted-foreground font-mono`}>
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor} flex-shrink-0`} />
      {time} {tz}
    </span>
  );
}
