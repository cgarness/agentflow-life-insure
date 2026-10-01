import { Check, CircleHelp, X } from 'lucide-react';
import { suggestCondition } from './recognition';
import type { NotesState } from './types';
interface Props { notes: NotesState; remove: (id: string) => void; accept: (id: string, name: string) => void; reject: (id: string) => void; editWording: (text: string) => void; acceptCondition: (original: string, entered: string, replacement: string) => void }
export function CapturedFacts({ notes, remove, accept, reject, editWording, acceptCondition }: Props) {
  const facts = [...new Map(notes.facts.map(f => [f.label, f])).values()];
  return <div className="space-y-3">
    {notes.suggestions.map(s => <div key={s.id} className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
      <p className="flex items-center gap-2 text-sm text-amber-200"><CircleHelp size={16} /><span>“{s.entered}” — did you mean:</span></p>
      <div className="mt-3 flex flex-wrap gap-2">{s.candidates.map(name => <button type="button" key={name} aria-label={name} onClick={() => accept(s.id, name)} className="flex min-h-10 items-center gap-1.5 rounded-xl border border-amber-300/25 px-3 text-sm text-amber-100 transition hover:bg-amber-300/10"><Check size={13} aria-hidden="true" />{name}</button>)}
        <button type="button" onClick={() => reject(s.id)} className="min-h-10 rounded-xl px-3 text-xs text-muted-foreground hover:text-foreground">None of these</button>
      </div>
    </div>)}
    {(facts.length > 0 || notes.unresolved.length > 0) && <details className="group text-xs text-muted-foreground" open={notes.suggestions.length > 0 || notes.unresolved.length > 0 || facts.some(f => f.value === 'unknown')}>
      <summary className="cursor-pointer text-xs text-muted-foreground">Edit details</summary>
      <div className="mt-3 flex flex-wrap gap-2">{facts.map(f => <span key={f.id} className={`inline-flex max-w-full items-center gap-1 rounded-lg border px-2 py-1 text-xs ${f.value === 'unknown' ? 'border-amber-400/20 text-amber-200' : 'border-border text-muted-foreground'}`}>
        <span className="min-w-0 break-words">{f.label}</span><button type="button" aria-label={`Remove ${f.label}`} onClick={() => remove(f.id)} className="shrink-0 rounded p-1 hover:bg-white/10"><X size={12} /></button>
      </span>)}</div>
      {notes.unresolved.map(text => <div key={text} className="mt-2 rounded-lg bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
        <div className="flex items-start justify-between gap-2"><span className="min-w-0 break-words">Unrecognized: “{text}”</span><button type="button" aria-label={`Edit wording: ${text}`} onClick={() => editWording(text)} className="min-h-10 shrink-0 rounded px-2 hover:bg-white/10">Edit wording</button></div>
        {suggestCondition(text).map(s => <button type="button" key={`${s.entered}:${s.replacement}`} onClick={() => acceptCondition(text, s.entered, s.replacement)} className="mr-2 mt-2 min-h-10 rounded-lg border border-amber-300/20 px-3 text-xs hover:bg-amber-300/10">Did you mean {s.label}?</button>)}
      </div>)}

    </details>}
  </div>;
}
