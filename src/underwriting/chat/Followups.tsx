import type { Followup } from './types';
export function Followups({ questions, onAnswer }: { questions: Followup[]; onAnswer: (q: Followup, value: string) => void }) {
  if (!questions.length) return null;
  return <section aria-label="Quick follow-up questions" className="space-y-4 rounded-2xl border border-primary/15 bg-primary/[0.04] p-4 sm:p-5">
    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">{questions.length === 1 ? 'One quick detail' : 'Two quick details'}</p>
    {questions.map(q => <div key={q.id} data-question={q.id}>
      <p className="text-sm font-medium leading-6">{q.text}</p>
      {q.hint && <p className="mt-1 text-xs leading-5 text-muted-foreground">{q.hint}</p>}
      <div className="mt-2 flex flex-wrap gap-2">{q.options.map(o => <button key={o.value} type="button" onClick={() => onAnswer(q, o.value)} className="min-h-10 rounded-xl border border-border bg-background/50 px-3 text-xs text-foreground transition hover:border-primary/40 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{o.label}</button>)}</div>
    </div>)}
  </section>;
}
