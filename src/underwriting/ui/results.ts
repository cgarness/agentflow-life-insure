import { CaseInput, Result, CommissionSchedule } from '../types';
import { orderResults, caseSummary, commissionLeaders } from '../engine';
import { sources } from '../sources';
import { el, add, pill, note } from './dom';
import { icon } from './icons';
export function resultsView(c:CaseInput,results:Result[],schedule:CommissionSchedule,today:string):HTMLElement {
  const root=el('div','space-y-5'),top=el('div','space-y-3');
  add(top,el('p','text-sm font-medium text-slate-500',caseSummary(c)),note('Underwriting guidance, not approval odds','Results separate documented restrictions, tier ceilings and facts still needing review. These are not quotes or final underwriting decisions.'));
  add(root,top);const leaders=commissionLeaders(results,schedule,today);
  for(const r of orderResults(results,schedule,today))root.append(resultCard(r,leaders.includes(r.carrier)));
  return root;
}
function resultCard(r:Result,isLeader:boolean):HTMLElement {
  const card=el('article','overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm');card.dataset.carrier=r.carrier;
  const head=el('div','space-y-4 p-5 sm:p-6'),row=el('div','flex flex-wrap items-start justify-between gap-3');
  const title=el('div','flex items-center gap-3'),monogram=el('div','flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-base font-bold text-white',r.carrier==='americo'?'A':r.carrier==='mutual'?'M':'T');
  add(title,monogram,add(el('div'),el('h3','text-lg font-bold text-slate-900',r.name),el('p','text-sm text-slate-500',r.product)));
  const labels={candidate:'Guideline candidate',possible:'Potential option',review:'Needs review',outside:'Outside checked criteria',hold:'Source on hold'};
  add(row,title,pill(labels[r.status],r.status==='candidate'?'green':r.status==='outside'?'red':r.status==='hold'?'slate':'amber'));
  add(head,row,el('p','text-base font-semibold text-slate-800',r.tier));
  if(r.tierKind==='ceiling')add(head,el('p','text-sm leading-6 text-slate-600','A tier ceiling is the best class this rule permits. It does not confirm that class will be offered.'));
  if(isLeader)add(head,pill('Highest supplied rate · comparable candidates','blue'));
  const facts=el('div','space-y-3');for(const reason of r.reasons){
    const p=el('div','flex items-start gap-2.5 text-sm leading-6 text-slate-700');
    add(p,icon(r.status==='outside'?'clipboard':'check','mt-0.5 h-5 w-5 shrink-0 text-slate-400'),el('span','',reason.text));facts.append(p);
  }add(head,facts);
  if(r.gaps.length){
    const gaps=el('div','rounded-xl bg-amber-50/80 p-4');add(gaps,el('p','text-xs font-bold uppercase tracking-wider text-amber-900','What still needs checking'));
    const list=el('ul','mt-2 list-disc space-y-2 pl-4 text-sm leading-6 text-amber-950');
    for(const text of r.gaps)list.append(el('li','',text));add(gaps,list);add(head,gaps);
  }
  const meta=el('div','grid grid-cols-1 gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-4 text-xs sm:grid-cols-2 sm:px-6');
  add(meta,add(el('div'),el('p','font-semibold text-slate-500','Benefit structure'),el('p','mt-1 text-sm font-medium text-slate-800',
    r.benefit==='immediate'?(r.status==='candidate'?'Immediate benefit candidate':'Immediate structure · eligibility unconfirmed'):r.benefit==='graded'?'Graded consideration · limitations apply':'Not yet established')),
    add(el('div'),el('p','font-semibold text-slate-500','Commission comparison'),el('p','mt-1 text-sm font-medium text-slate-800',
      isLeader?'Highest agent-supplied rate in peer group':'Unavailable until suitable tiers and comparable rates are established')));
  const details=el('details','border-t border-slate-100 px-5 py-3 sm:px-6');
  add(details,el('summary','min-h-[36px] cursor-pointer py-2 text-sm font-semibold text-blue-700','Evidence & limitations'));
  const content=el('div','space-y-3 pb-3');const sourceIds=[...new Set(r.reasons.map(e=>e.source))];
  for(const id of sourceIds){const s=sources[id as keyof typeof sources];if(!s)continue;
    add(content,el('p','text-xs font-semibold leading-5 text-slate-700',`${s.title} · ${s.version}`),el('p','text-xs leading-5 text-slate-500',s.status));}
  for(const reason of r.reasons)add(content,el('p','text-xs leading-5 text-slate-500',`${reason.rule} · printed guide p${reason.page}`));
  for(const warning of r.warnings)add(content,el('p','text-xs leading-5 text-slate-500',warning));
  add(details,content);add(card,head,meta,details);return card;
}
