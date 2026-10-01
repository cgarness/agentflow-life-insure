import { CheckCircle2, CircleHelp, XCircle, ChevronDown } from 'lucide-react';
import { sources } from '../sources';
import type { QuickCard } from './types';
const themes = {
  green: { box: 'border-emerald-400/20 bg-emerald-400/[0.06]', ink: 'text-emerald-300', icon: CheckCircle2 },
  yellow: { box: 'border-amber-400/20 bg-amber-400/[0.04]', ink: 'text-amber-300', icon: CircleHelp },
  red: { box: 'border-rose-400/20 bg-rose-400/[0.05]', ink: 'text-rose-300', icon: XCircle },
};
export function CarrierCards({ cards }: { cards: QuickCard[] }) {
  if (!cards.length) return null;
  return <section aria-label="Carrier results" className="space-y-2.5">
    <div className="flex flex-wrap items-center justify-between gap-2 pb-1"><h2 className="text-sm font-semibold">Carrier snapshot</h2><span className="text-[11px] text-muted-foreground">Based on the details shared</span></div>
    {cards.map(c => {
      const t = themes[c.color], Icon = t.icon;
      return <article key={c.carrier} data-carrier={c.carrier} data-fit={c.color} className={`rounded-2xl border p-4 sm:px-5 ${t.box}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><h3 className="text-sm font-semibold sm:text-base">{c.name}</h3><p className="mt-0.5 text-xs text-muted-foreground">{c.product}{c.tier !== 'Tier to confirm' && c.color !== 'red' ? ` · ${c.tier}` : ''}</p></div>
          <span className={`flex shrink-0 items-center gap-1.5 pt-0.5 text-[11px] font-medium sm:text-xs ${t.ink}`}><Icon size={14} />{c.label}</span>
        </div>
        <p className="mt-2.5 text-xs leading-5 text-muted-foreground">{c.reason}</p>
        {c.benefit !== 'unconfirmed' && c.color !== 'red' && <span className={`mt-2 inline-flex rounded-md px-2 py-1 text-[10px] ${c.benefit === 'graded' ? 'bg-amber-400/10 text-amber-200' : 'bg-white/5 text-muted-foreground'}`}>{c.benefit === 'graded' ? 'Graded benefit — waiting-period limits apply' : 'Immediate benefit — preliminary indication'}</span>}
        <details className="mt-2.5 border-t border-white/5 pt-2">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] text-muted-foreground">Why? <ChevronDown size={12} /></summary>
          <div className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
            {c.evidence.map((e, i) => <p key={`${e.rule}-${i}`}>{e.text}<span className="ml-1 text-muted-foreground/70">{sources[e.source as keyof typeof sources]?.version ?? e.source}, p. {e.page}.</span></p>)}
            {c.gaps.length > 0 && <div className="rounded-lg bg-black/10 p-3"><p className="mb-1 font-medium text-foreground/80">Optional details / carrier checks</p>{c.gaps.slice(0, 5).map((g, i) => <p key={i}>{g}</p>)}{c.gaps.length > 5 && <p>Additional carrier application checks apply.</p>}</div>}
            <p>Field screening only. The carrier decides eligibility, benefit and final class. Green is not an approval; yellow is not a numerical probability.</p>
          </div>
        </details>
      </article>;
    })}
    <p className="px-1 pt-1 text-[11px] leading-5 text-muted-foreground">Commission order is pending your verified schedules. No payout ranking is assumed.</p>
  </section>;
}
