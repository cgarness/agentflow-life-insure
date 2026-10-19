import { useState } from 'react';
import { BadgeCheck, Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

const primary = 'bg-slate-900 text-white hover:bg-slate-800 border border-slate-700 shadow-sm dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white';

export function PublicProfileActions({ url, verified = false }: { url: string | null; verified?: boolean }) {
  const [notice, setNotice] = useState('');
  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setNotice('Link copied'); }
    catch { setNotice('Unable to copy link'); }
  }
  return <div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Underwriter Verified">
      {url ? <Button className={primary} asChild>
        <a href={url} target="_blank" rel="noopener noreferrer"><BadgeCheck className={`mr-2 h-4 w-4 ${verified ? "text-emerald-400 dark:text-emerald-600" : ""}`}/>Underwriter Verified<ExternalLink className="ml-2 h-3.5 w-3.5 opacity-60"/></a>
      </Button> : <Button className={primary} disabled title="Publish your page in Settings > My Profile"><ExternalLink className="mr-2 h-4 w-4"/>Underwriter Verified</Button>}
      <Button variant="outline" disabled={!url} onClick={copy}><Copy className="mr-2 h-4 w-4"/>Copy link</Button>
    </div>
    {verified && <p className="mt-2 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400" title="Profile details confirmed by the agent"><BadgeCheck className="h-3.5 w-3.5"/>Verified</p>}
    {notice && <p role="status" className="mt-2 text-xs text-muted-foreground">{notice}</p>}
  </div>;
}
