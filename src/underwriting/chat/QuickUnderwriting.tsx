import { useEffect, useRef } from 'react';
import { ArrowUpRight, Plus, ShieldCheck, Zap } from 'lucide-react';
import { BasicsPanel } from './BasicsPanel';
import { ChatComposer } from './ChatComposer';
import { CapturedFacts } from './CapturedFacts';
import { CarrierCards } from './CarrierCards';
import { assumptionNotice } from './assumptions';
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
    <header className="border-b border-border/70 bg-background/90">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        <a href="/" aria-label="AgentFlow home" className="block shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><img src="/agentflow-logo-full-on-dark.png" width="166" height="13" alt="AgentFlow" className="h-auto w-36 sm:w-44" /></a>
        <div className="flex items-center gap-1 sm:gap-3"><a href="/" className="hidden items-center gap-1 text-xs text-muted-foreground hover:text-foreground sm:flex">AgentFlow <ArrowUpRight size={13} /></a>
          <button type="button" onClick={app.reset} className="flex min-h-10 items-center gap-1.5 rounded-xl border border-border px-3 text-xs text-muted-foreground transition hover:bg-card hover:text-foreground"><Plus size={14} />New case</button>
        </div>
      </div>
    </header>
    <main className="mx-auto max-w-3xl px-4 pt-7 sm:px-6 sm:pt-10">
      <div className={`transition-all ${app.turns.length ? 'mb-5' : 'mb-7 text-center'}`}>
        {!app.turns.length && <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-primary"><Zap size={12} />Final expense & whole life</div>}
        <h1 className={`font-semibold tracking-tight ${app.turns.length ? 'text-xl' : 'text-3xl sm:text-4xl'}`}>Quick underwriting<span className="text-primary">.</span></h1>
        {!app.turns.length && <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">The basics. A few health notes.<br className="sm:hidden" /> A clearer place to start.</p>}
      </div>
      <BasicsPanel value={app.basics} onChange={app.setBasics} errors={app.fieldErrors} expanded={app.editingBasics} onToggle={() => app.setEditingBasics(v => !v)} canCollapse={app.ready && app.turns.length > 0} />
      {!app.turns.length && <div className="mt-6 flex items-center justify-center gap-2 text-[11px] text-muted-foreground"><ShieldCheck size={13} /><span>Americo · Transamerica · Mutual of Omaha</span></div>}
      {app.turns.length > 0 && <div className="mt-6 space-y-5">
        {app.turns.length > 2 && <details className="px-1 text-xs text-muted-foreground"><summary className="cursor-pointer">Earlier notes ({Math.floor((app.turns.length - 2) / 2)})</summary><div className="mt-3 space-y-3">{app.turns.slice(0, -2).filter(t => t.role === 'user').map(t => <p key={t.id} className="whitespace-pre-wrap break-words rounded-xl bg-card p-3">{t.text}</p>)}</div></details>}
        <div className="flex justify-end"><p className="max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-border bg-secondary/50 px-4 py-3 text-sm leading-6">{app.turns[app.turns.length - 2]?.text}</p></div>
        <div ref={update} aria-live="polite" className="flex items-center gap-2.5"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary"><Zap size={14} /></span><p className="text-sm leading-6 text-muted-foreground">{app.turns[app.turns.length - 1]?.text}</p></div>
        <CapturedFacts notes={app.notes} remove={app.remove} accept={app.acceptMedication} reject={app.rejectMedication} editWording={app.editWording} acceptCondition={app.acceptCondition} />
        {app.ready ? <CarrierCards cards={app.cards} /> : <p className="text-sm text-amber-300">Complete the edited basics to refresh carrier results.</p>}
      </div>}
      <p data-assumption-notice className="mt-4 text-center text-[11px] leading-5 text-muted-foreground">{assumptionNotice}</p>
      {app.editingWording && <div className="mt-3 flex items-center justify-between gap-2 text-xs text-amber-200"><span>Editing an unrecognized detail</span><button type="button" onClick={app.cancelWording} className="min-h-10 rounded px-3 hover:bg-card">Cancel edit</button></div>}
      <ChatComposer value={app.draft} onChange={app.setDraft} onSend={app.send} error={app.error} active={app.turns.length > 0} />
      <details className="pb-7 text-center text-[10px] leading-5 text-muted-foreground"><summary className="cursor-pointer">About this quick screen</summary><p className="mx-auto mt-2 max-w-lg">On-device phrase matching—not a connected language model. Review the captured details. Unknown language stays flagged; medication suggestions require confirmation. Unlisted screening items are assumptions, not confirmed application answers. Nothing is saved to the CRM. This preview does not quote prices or replace a carrier application.</p></details>
    </main>
  </div>;
}
