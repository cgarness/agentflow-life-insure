import { CheckCircle2, CircleHelp, XCircle } from 'lucide-react';
import type { QuickCard } from './types';
const themes = {
  green: { box: 'border-emerald-400/25 bg-emerald-400/[0.07]', ink: 'text-emerald-300', icon: CheckCircle2 },
  yellow: { box: 'border-amber-400/25 bg-amber-400/[0.05]', ink: 'text-amber-300', icon: CircleHelp },
  red: { box: 'border-rose-400/25 bg-rose-400/[0.06]', ink: 'text-rose-300', icon: XCircle },
};
export function CarrierCards({ cards }: { cards: QuickCard[] }) {
  if (!cards.length) return null;
  return <section aria-label="Carrier results" className="space-y-2">
    {cards.map(c => {
      const t = themes[c.color], Icon = t.icon;
      return <article key={c.carrier} data-carrier={c.carrier} data-fit={c.color} className={`rounded-xl border px-3.5 py-3 sm:px-4 ${t.box}`}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold">{c.name}</h2>
          <span className={`flex items-center gap-1.5 text-xs font-medium ${t.ink}`}><Icon size={14} aria-hidden="true" />{c.label}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{c.product}</span>
          {c.color === 'green' && c.benefit !== 'unconfirmed' && <span className={c.benefit === 'graded' ? 'text-amber-200' : ''}>{c.benefit === 'graded' ? '· Graded benefit' : '· Immediate benefit'}</span>}
        </div>
      </article>;
    })}
  </section>;
}
