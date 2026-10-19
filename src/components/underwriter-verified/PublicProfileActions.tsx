import { useState } from 'react';
import { BadgeCheck, Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

const primary = 'h-11 rounded-lg border border-emerald-300 bg-emerald-100 px-4 text-emerald-900 shadow-sm hover:bg-emerald-200 hover:text-emerald-950 focus-visible:ring-emerald-500 dark:border-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-100 dark:hover:bg-emerald-900/80 dark:hover:text-emerald-50';
const secondary = 'h-11 rounded-lg border-emerald-300 bg-transparent px-4 text-emerald-800 hover:bg-emerald-50 hover:text-emerald-900 focus-visible:ring-emerald-500 dark:border-emerald-700 dark:text-emerald-200 dark:hover:bg-emerald-950/50 dark:hover:text-emerald-100';

export function PublicProfileActions({ url, verified = false }: { url: string | null; verified?: boolean }) {
  const [notice, setNotice] = useState('');
  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setNotice('Link copied'); }
    catch { setNotice('Unable to copy link'); }
  }
  return <div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Underwriter Verified">
      {url ? <Button variant="outline" className={primary} asChild>
        <a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4"/>View UV Page</a>
      </Button> : <Button variant="outline" className={primary} disabled title="Publish your page in Settings > My Profile"><ExternalLink className="h-4 w-4"/>View UV Page</Button>}
      <Button variant="outline" className={secondary} disabled={!url} onClick={copy}><Copy className="h-4 w-4"/>Copy Link</Button>
    </div>
    {verified && <p className="mt-2 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400" title="Profile details confirmed by the agent"><BadgeCheck className="h-3.5 w-3.5"/>Verified</p>}
    {notice && <p role="status" className="mt-2 text-xs text-muted-foreground">{notice}</p>}
  </div>;
}
