import { useEffect, useRef } from 'react';
import { mountUnderwriting } from './ui/mount';
import { validateWithZod, scheduleSchema } from './schema';

/** Public lifecycle host. Case data never enters the CRM or browser storage. */
export default function UnderwritingPage() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Underwriting | FFL Agent';
    if (!host.current) return;
    const element = host.current;
    const options = {
      validateCase: validateWithZod,
      validateSchedule: (schedule: Parameters<typeof scheduleSchema.parse>[0]) => { scheduleSchema.parse(schedule); },
    };
    let dispose: (() => void) | undefined = mountUnderwriting(element, options);
    const clear = () => { dispose?.(); dispose = undefined; };
    const restore = () => { if (!dispose) dispose = mountUnderwriting(element, options); };
    window.addEventListener('pagehide', clear);
    window.addEventListener('pageshow', restore);
    return () => {
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('pageshow', restore);
      clear();
      document.title = previousTitle;
    };
  }, []);
  return <div ref={host} />;
}
