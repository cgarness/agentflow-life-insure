import { ArrowUp, LockKeyhole } from 'lucide-react';
import { useRef } from 'react';
interface Props { value: string; onChange: (s: string) => void; onSend: () => void; error: string; active: boolean }
export function ChatComposer({ value, onChange, onSend, error, active }: Props) {
  const composing = useRef(false);
  return <div className="sticky bottom-0 z-20 -mx-1 bg-background/95 px-1 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur-xl">
    <form aria-label="Health notes" onSubmit={e => { e.preventDefault(); onSend(); }} className="rounded-2xl border border-border bg-card shadow-xl shadow-black/10 focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/10">
      <label className="sr-only" htmlFor="quick-note">Health and medication notes</label>
      <textarea id="quick-note" value={value} onChange={e => onChange(e.target.value)} maxLength={3000} rows={active ? 2 : 3}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !composing.current && !e.nativeEvent.isComposing) { e.preventDefault(); onSend(); } }}
        placeholder={active ? 'Add a detail, answer a question, or correct something…' : 'Type 2 diabetes, COPD, had cancer 7 years ago…'}
        aria-describedby="quick-note-help" aria-invalid={!!error} autoComplete="off" autoCorrect="off" spellCheck={false}
        className="block w-full resize-none rounded-2xl bg-transparent px-4 pb-1 pt-4 text-base leading-7 text-foreground outline-none placeholder:text-muted-foreground/70 sm:px-5" />
      <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-1 sm:px-5">
        <p id="quick-note-help" className="text-xs leading-5 text-muted-foreground">{active ? 'Details update as you go.' : 'Health conditions + medications. Spelling help included.'}</p>
        <button type="submit" aria-label="Send health note" disabled={!value.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-35"><ArrowUp size={19} strokeWidth={2.5} /></button>
      </div>
    </form>
    {error && <p role="alert" className="mt-2 text-sm text-amber-300">{error}</p>}
    <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground"><LockKeyhole size={11} />Private session · Health details only · Not an approval</p>
  </div>;
}
