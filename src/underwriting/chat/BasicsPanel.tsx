import { Pencil, Check } from 'lucide-react';
import { states } from '../data';
import { basicsSummary } from './basics';
import type { Basics } from './types';

interface Props { value: Basics; onChange: (value: Basics) => void; errors: Record<string, string>; expanded: boolean; onToggle: () => void; canCollapse: boolean }
const input = 'mt-1.5 h-11 w-full min-w-0 rounded-xl border border-border bg-background/70 px-3 text-base text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20';
export function BasicsPanel({ value, onChange, errors, expanded, onToggle, canCollapse }: Props) {
  const change = (key: keyof Basics, next: string) => onChange({ ...value, [key]: next });
  if (!expanded) return <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card/60 px-4 py-3">
    <p className="text-sm leading-6 text-muted-foreground">{basicsSummary(value)}</p>
    <button type="button" onClick={onToggle} className="flex shrink-0 items-center gap-1.5 rounded-lg p-2 text-xs text-primary hover:bg-primary/10"><Pencil size={13} />Edit</button>
  </div>;
  return <section aria-label="Client basics" className="rounded-2xl border border-border bg-card/60 p-4 sm:p-5">
    <div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold">Client basics</h2>
      {canCollapse && <button type="button" onClick={onToggle} className="flex items-center gap-1 rounded-lg p-1 text-xs text-primary"><Check size={14} />Done</button>}
      {!canCollapse && <span className="text-xs text-muted-foreground">No name needed</span>}
    </div>
    <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-5">
      <label className="min-w-0 text-xs text-muted-foreground" htmlFor="quick-age">Age
        <input id="quick-age" aria-invalid={!!errors.age} value={value.age} onChange={e => change('age', e.target.value)} inputMode="numeric" maxLength={3} placeholder="65" className={input} autoComplete="off" />
        {errors.age && <span role="alert" className="mt-1 block text-rose-300">{errors.age}</span>}
      </label>
      <label className="min-w-0 text-xs text-muted-foreground" htmlFor="quick-state">State
        <select id="quick-state" aria-invalid={!!errors.state} value={value.state} onChange={e => change('state', e.target.value)} className={input}><option value="">Select</option>{states.map(s => <option key={s} value={s}>{s}</option>)}</select>
        {errors.state && <span role="alert" className="mt-1 block text-rose-300">{errors.state}</span>}
      </label>
      <label className="min-w-0 text-xs text-muted-foreground" htmlFor="quick-height">Height
        <select id="quick-height" aria-invalid={!!errors.height} value={value.height} onChange={e => change('height', e.target.value)} className={input}><option value="">Select</option>{Array.from({ length: 43 }, (_, i) => i + 48).map(h => <option key={h} value={String(h)}>{Math.floor(h / 12)}′ {h % 12}″</option>)}</select>
        {errors.height && <span role="alert" className="mt-1 block text-rose-300">{errors.height}</span>}
      </label>
      <label className="min-w-0 text-xs text-muted-foreground" htmlFor="quick-weight">Weight (lb)
        <input id="quick-weight" aria-invalid={!!errors.weight} value={value.weight} onChange={e => change('weight', e.target.value)} inputMode="decimal" maxLength={7} placeholder="170" className={input} autoComplete="off" />
        {errors.weight && <span role="alert" className="mt-1 block text-rose-300">{errors.weight}</span>}
      </label>
      <label className="col-span-2 min-w-0 text-xs text-muted-foreground sm:col-span-1" htmlFor="quick-smoking">Smoking / nicotine
        <select id="quick-smoking" aria-invalid={!!errors.smoking} value={value.smoking} onChange={e => change('smoking', e.target.value)} aria-describedby="nicotine-help" className={input}>
          <option value="">Select</option><option value="smoker">Smoker</option><option value="nonsmoker">Nonsmoker</option><option value="former">Recently quit</option><option value="other">Other nicotine</option><option value="unknown">Not sure</option>
        </select>
        {errors.smoking && <span role="alert" className="mt-1 block text-rose-300">Choose a smoking status.</span>}
      </label>
    </div>
    <p id="nicotine-help" className="mt-3 text-[11px] leading-5 text-muted-foreground">Nonsmoker = no nicotine for 24+ months. Vaping, patches or gum? Choose other nicotine.</p>
    {value.smoking === 'former' && <label className="mt-3 block max-w-xs text-xs text-muted-foreground" htmlFor="quick-quit">Months since last nicotine use
      <input id="quick-quit" value={value.quitMonths} onChange={e => change('quitMonths', e.target.value)} inputMode="numeric" maxLength={4} className={input} />
      {errors.quitMonths && <span className="text-rose-300">{errors.quitMonths}</span>}
    </label>}
  </section>;
}
