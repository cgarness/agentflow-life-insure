import { Check, CircleHelp, X } from 'lucide-react';
import type { NotesState } from './types';
interface Props { notes: NotesState; remove: (id: string) => void; accept: (id: string, name: string) => void; reject: (id: string) => void; clearUnresolved: (text: string) => void }
export function CapturedFacts({ notes, remove, accept, reject, clearUnresolved }: Props) {
  const facts = [...new Map(notes.facts.map(f => [f.label, f])).values()];
  return <div className="space-y-3">
    {notes.suggestions.map(s => <div key={s.id} className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4">
      <p className="flex items-center gap-2 text-sm text-amber-200"><CircleHelp size={16} /><span>“{s.entered}” — did you mean:</span></p>
      <div className="mt-3 flex flex-wrap gap-2">{s.candidates.map(name => <button type="button" key={name} onClick={() => accept(s.id, name)} className="flex min-h-10 items-center gap-1.5 rounded-xl border border-amber-300/25 px-3 text-sm text-amber-100 transition hover:bg-amber-300/10"><Check size={13} />{name}</button>)}
        <button type="button" onClick={() => reject(s.id)} className="min-h-10 rounded-xl px-3 text-xs text-muted-foreground hover:text-foreground">None of these</button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Confirm the actual medication. No diagnosis is inferred.</p>
    </div>)}
    {(facts.length > 0 || notes.unresolved.length > 0) && <details className="group rounded-2xl border border-border bg-card/30 p-3.5" open={notes.suggestions.length > 0 || notes.unresolved.length > 0 || facts.some(f => f.value === 'unknown')}>
      <summary className="cursor-pointer text-xs text-muted-foreground">Picked up {facts.length} detail{facts.length === 1 ? '' : 's'} <span className="ml-1 text-primary">Review / edit</span></summary>
      <div className="mt-3 flex flex-wrap gap-2">{facts.map(f => <span key={f.id} title={f.evidence} className={`inline-flex max-w-full items-center gap-1 rounded-lg border px-2 py-1 text-xs ${f.value === 'unknown' ? 'border-amber-400/20 text-amber-200' : 'border-border text-muted-foreground'}`}>
        <span className="min-w-0 break-words">{f.label}</span><button type="button" aria-label={`Remove ${f.label}`} onClick={() => remove(f.id)} className="shrink-0 rounded p-1 hover:bg-white/10"><X size={12} /></button>
      </span>)}</div>
      {notes.unresolved.map(text => <div key={text} className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-amber-400/5 px-2 py-2 text-xs text-amber-200">
        <span className="min-w-0 break-words">Not fully recognized: “{text}”</span><button type="button" aria-label={`Remove unmatched detail ${text}`} title="Remove this unmatched detail from the case" onClick={() => clearUnresolved(text)} className="shrink-0 rounded p-1 hover:bg-white/10"><X size={13} /></button>
      </div>)}
      {notes.unresolved.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Rephrase it in the chat. Remove a detail only if it does not apply.</p>}
    </details>}
  </div>;
}
