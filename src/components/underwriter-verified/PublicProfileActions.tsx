import { useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

const gold = 'bg-[#f3b916] text-[#141414] hover:bg-[#dfa810] border border-[#dca40d] shadow-sm font-semibold';

export function PublicProfileActions({ url }: { url: string | null }) {
  const [notice, setNotice] = useState('');
  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setNotice('Link copied'); }
    catch { setNotice('Unable to copy link'); }
  }
  return <div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Underwriter Verified">
      {url ? <Button className={gold} asChild>
        <a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4"/>Underwriter Verified</a>
      </Button> : <Button className={gold} disabled title="Publish your page in Settings > My Profile"><ExternalLink className="mr-2 h-4 w-4"/>Underwriter Verified</Button>}
      <Button className={gold} disabled={!url} onClick={copy}><Copy className="mr-2 h-4 w-4"/>Copy link</Button>
    </div>
    {notice && <p role="status" className="mt-2 text-xs text-muted-foreground">{notice}</p>}
  </div>;
}
