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

  const textSize = size === 'md' ? 'text-sm font-medium' : 'text-xs';

  return (
    <span className={`inline-flex items-center gap-1 ${textSize} font-mono`} style={{ color: '#14B8A6' }}>
      {time} {tz}
    </span>
  );
}
