import { useEffect, useRef } from 'react';
import { Plus } from 'lucide-react';
import { BasicsPanel } from './BasicsPanel';
import { ChatComposer } from './ChatComposer';
import { CapturedFacts } from './CapturedFacts';
import { CarrierCards } from './CarrierCards';
import { useQuickUnderwriting } from './useQuickUnderwriting';

export default function QuickUnderwriting() {
  const app = useQuickUnderwriting();
  const update = useRef<HTMLDivElement>(null);
  const previousTurns = useRef(0);
  useEffect(() => {
    if (app.turns.length > previousTurns.current) update.current?.scrollIntoView?.({ block: 'nearest' });
    previousTurns.current = app.turns.length;
  }, [app.turns.length]);
  return <div className="dark min-h-dvh bg-background text-foreground [color-scheme:dark]">
    <header className="border-b border-border/70">
      <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-3 px-4 sm:px-6">
        <a href="/" aria-label="AgentFlow home" className="block shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <img src="/agentflow-logo-full-on-dark.png" width="166" height="13" alt="AgentFlow" className="h-auto w-36 sm:w-44" />
        </a>
        <button type="button" onClick={app.reset} className="flex min-h-10 items-center gap-1.5 rounded-xl border border-border px-3 text-xs text-muted-foreground transition hover:bg-card hover:text-foreground">
          <Plus size={14} aria-hidden="true" />New case
        </button>
      </div>
    </header>
    <main className="mx-auto max-w-3xl px-4 pt-5 sm:px-6 sm:pt-6">
      <h1 className="sr-only">Quick underwriting.</h1>
      <BasicsPanel value={app.basics} onChange={app.setBasics} errors={app.fieldErrors} expanded={app.editingBasics} onToggle={() => app.setEditingBasics(v => !v)} canCollapse={app.ready && app.turns.length > 0} />
      {app.turns.length > 0 && <div className="mt-4 space-y-3">
        {app.turns.length > 2 && <details className="px-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Earlier notes</summary>
          <div className="mt-2 space-y-2">{app.turns.slice(0, -2).filter(t => t.role === 'user').map(t => <p key={t.id} className="whitespace-pre-wrap break-words rounded-xl bg-card p-3">{t.text}</p>)}</div>
        </details>}
        <div className="flex justify-end"><p className="max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-border bg-secondary/50 px-4 py-2.5 text-sm leading-6">{app.turns[app.turns.length - 2]?.text}</p></div>
        <CapturedFacts notes={app.notes} remove={app.remove} accept={app.acceptMedication} reject={app.rejectMedication} editWording={app.editWording} acceptCondition={app.acceptCondition} />
        <div ref={update} aria-live="polite">
          {app.ready ? <CarrierCards cards={app.cards} /> : <p className="text-sm text-amber-300">Complete the basics to update results.</p>}
        </div>
      </div>}
      {app.editingWording && <div className="mt-3 flex items-center justify-between gap-2 text-xs text-amber-200"><span>Edit wording</span><button type="button" onClick={app.cancelWording} className="min-h-10 rounded px-3 hover:bg-card">Cancel edit</button></div>}
      <ChatComposer value={app.draft} onChange={app.setDraft} onSend={app.send} error={app.error} active={app.turns.length > 0} />
    </main>
  </div>;
}
