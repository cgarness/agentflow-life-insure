import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import QuickUnderwriting from './chat/QuickUnderwriting';

/** Standalone AgentFlow utility: same branding, no CRM providers or persistence. */
export default function UnderwritingPage() {
  const [generation, setGeneration] = useState(0);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const title = document.title;
    const wasDark = document.documentElement.classList.contains('dark');
    document.documentElement.classList.add('dark');
    document.title = 'Quick Underwriting | AgentFlow';
    const hide = () => { flushSync(() => { setVisible(false); setGeneration(v => v + 1); }); };
    const show = () => { setVisible(true); };
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    return () => {
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
      document.title = title;
      if (!wasDark) document.documentElement.classList.remove('dark');
    };
  }, []);
  return visible ? <QuickUnderwriting key={generation} /> : <div className="dark min-h-dvh bg-background" />;
}
