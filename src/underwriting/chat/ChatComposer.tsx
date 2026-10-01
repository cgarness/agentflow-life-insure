import { ArrowUp } from 'lucide-react';
import { useRef } from 'react';
interface Props { value: string; onChange: (s: string) => void; onSend: () => void; error: string; active: boolean }
export function ChatComposer({ value, onChange, onSend, error, active }: Props) {
  const composing = useRef(false);
  return <div className="sticky bottom-0 z-20 -mx-1 bg-background/95 px-1 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur-xl">
    <form aria-label="Health notes" onSubmit={e => { e.preventDefault(); onSend(); }} className="relative rounded-2xl border border-border bg-card shadow-xl shadow-black/10 focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/10">
      <label className="sr-only" htmlFor="quick-note">Health and medication notes</label>
      <textarea id="quick-note" value={value} onChange={e => onChange(e.target.value)} maxLength={3000} rows={active ? 2 : 3}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !composing.current && !e.nativeEvent.isComposing) { e.preventDefault(); onSend(); } }}
        placeholder={active ? 'Add or correct a detail…' : 'Enter health conditions and medications…'}
        aria-invalid={!!error} aria-describedby={error ? 'quick-note-error' : undefined} autoComplete="off" autoCorrect="off" spellCheck={false}
        className="block w-full resize-none rounded-2xl bg-transparent py-4 pl-4 pr-16 text-base leading-7 text-foreground outline-none placeholder:text-muted-foreground/70 sm:pl-5" />
      <button type="submit" aria-label="Send health note" disabled={!value.trim()} className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-35"><ArrowUp size={19} strokeWidth={2.5} /></button>
    </form>
    {error && <p id="quick-note-error" role="alert" className="mt-2 text-sm text-amber-300">{error}</p>}
  </div>;
}
