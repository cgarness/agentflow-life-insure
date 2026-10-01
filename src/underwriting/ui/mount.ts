import { CaseInput, CommissionSchedule, Result, ValidationIssue, freshCase, freshSchedule } from '../types';
import { validateCase, currentLocalDate } from '../validation';
import { evaluate } from '../engine';
import { el, add, button, pill, primary, secondary } from './dom';
import { icon } from './icons';
import { basics } from './basics';
import { health } from './health';
import { questions } from './questions';
import { resultsView } from './results';
import { commissionPanel } from './commission';
export interface MountOptions { validateCase?:(c:CaseInput)=>void; validateSchedule?:(s:CommissionSchedule)=>void }
export function mountUnderwriting(host:HTMLElement,options:MountOptions={}):()=>void {
  let c=freshCase(),schedule=freshSchedule(),appliedSchedule=freshSchedule(),step=0,results:Result[]=[],errors:ValidationIssue[]=[],closed=false;
  const today=currentLocalDate;
  const dirty=()=>{results=[];appliedSchedule=freshSchedule();schedule.acknowledged=false;};
  const clinicalDirty=()=>{dirty();c.answers.moReviewed='';c.answers.moPart1='';c.answers.moPart2='';c.answers.amState='';c.answers.moState='';c.answers.taReviewed='';c.answers.taEligibility='';schedule.acknowledged=false;};
  const repaint=()=>render(true);
  const jump=(n:number)=>{step=n;errors=[];render(false);};
  const reset=()=>{c=freshCase();schedule=freshSchedule();appliedSchedule=freshSchedule();results=[];errors=[];step=0;render(false);};
  const labels=['Client basics','Health & meds','Follow-ups','Carrier review'];
  function next():void {
    errors=validateCase(c,step);
    if(errors.length){render(true);focusError();return;}
    if(step===2){
      errors=validateCase(c);if(errors.length){step=errors[0]!.step;render(false);focusError();return;}
      try{options.validateCase?.(c);results=evaluate(c);}catch(error){
        errors=[{field:'evaluation',message:error instanceof Error?error.message:'Unable to validate this case.',step:2}];render(true);return;}
    }
    jump(step+1);
  }
  function focusError():void {const control=document.getElementById(errors[0]?.field??'');control?.focus();control?.scrollIntoView({block:'center',behavior:'smooth'});}
  function render(preserve:boolean):void {
    if(closed)return;
    const y=window.scrollY;const active=document.activeElement as HTMLInputElement|null;
    const focusId=active?.id;const radioName=active?.type==='radio'?active.name:'';const radioValue=active?.value;
    const openSummaries=preserve?[...host.querySelectorAll('details[open]')].map(d=>d.querySelector('summary')?.textContent):[];
    host.replaceChildren();
    const page=el('div','min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-blue-100');
    const header=el('header','border-b border-slate-200/80 bg-white');const nav=el('div','mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-4 sm:px-8');
    const brand=el('a','flex min-h-[44px] items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200');
    brand.href='/';brand.setAttribute('aria-label','FFL Agent home');
    add(brand,el('span','flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-lg font-black text-white','F'),
      add(el('span','text-lg font-extrabold tracking-tight'),'FFL',el('span','ml-1 font-medium text-slate-500','AGENT')));
    add(nav,brand,pill('Underwriting','blue'));add(header,nav);add(page,header);
    const main=el('main','mx-auto max-w-3xl [overflow-wrap:anywhere] px-4 pb-12 pt-8 sm:px-6 sm:pt-12');
    const hero=el('div','mb-8 space-y-4');
    add(hero,el('p','text-xs font-bold uppercase tracking-[0.18em] text-blue-700','Final expense / whole life'),
      el('h1','text-3xl font-extrabold leading-tight tracking-tight text-slate-950 sm:text-4xl','A clearer path to the right carrier.'),
      el('p','max-w-xl text-base leading-7 text-slate-500','Enter the case once. See the carrier rules that fit, the questions that matter, and what still needs review.'));
    const privacy=el('div','flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-xs font-medium text-slate-500');
    add(privacy,add(el('span','inline-flex items-center gap-1.5'),icon('lock','h-4 w-4'),'Case stays in this browser'),
      add(el('span','inline-flex items-center gap-1.5'),icon('shield','h-4 w-4'),'Source-based field guidance'));
    add(hero,privacy);add(main,hero);
    const progress=el('nav','mb-5 grid grid-cols-4 gap-1 sm:gap-3');progress.setAttribute('aria-label','Underwriting steps');
    labels.forEach((name,i)=>{
      const b=button('',`flex min-h-[64px] flex-col items-start gap-2 rounded-lg px-2 py-2 text-left ${i===step?'text-blue-700':i<step?'text-slate-700':'text-slate-400'}`,()=>{if(i<step)jump(i);});
      b.disabled=i>step;if(i===step)b.setAttribute('aria-current','step');
      add(b,el('span',`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${i===step?'bg-blue-600 text-white':i<step?'bg-blue-100 text-blue-700':'bg-slate-200 text-slate-500'}`,i<step?'✓':String(i+1)),el('span','text-[11px] font-semibold leading-4 sm:text-xs',name));progress.append(b);
    });add(main,progress);
    const card=el('div','overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm');
    const cardHead=el('div','flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-5 sm:px-7');
    const titles=['Start with the essentials','Build the health picture','Ask only what matters','Your carrier review'];
    const h=el('h2','text-lg font-bold tracking-tight sm:text-xl',titles[step]);h.tabIndex=-1;h.id='step-heading';
    add(cardHead,h,el('span','whitespace-nowrap text-xs font-semibold text-slate-400',`${step+1} of 4`));add(card,cardHead);
    const content=el('div','p-5 sm:p-7');
    if(errors.length){const error=el('div','mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800',errors.map(e=>e.message).join(' '));error.setAttribute('role','alert');content.append(error);}
    if(step===0)content.append(basics(c,clinicalDirty,repaint,errors));
    if(step===1)content.append(health(c,clinicalDirty,repaint,errors));
    if(step===2)content.append(questions(c,dirty,repaint));
    if(step===3)content.append(resultsView(c,results,appliedSchedule,today()));
    add(card,content);
    const actions=el('div','sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white/95 px-5 py-4 backdrop-blur sm:px-7');
    if(step>0)add(actions,button('← Back',secondary,()=>jump(step-1)));
    else add(actions,el('p','text-xs text-slate-400','No account required'));
    if(step<3)add(actions,add(button(step===2?'Review carriers':'Continue',`${primary} flex-1 sm:flex-none`,next),icon('arrow','h-4 w-4')));
    else add(actions,button('Start a new case',primary,reset));
    add(card,actions);add(main,card);
    if(step===3)add(main,el('div','mt-5'),commissionPanel(schedule,results,today(),()=>{
      appliedSchedule=JSON.parse(JSON.stringify(schedule)) as CommissionSchedule;
      // Do not re-render the editor while typing; update only the result body after Apply.
      const existing=content.firstElementChild;if(existing)existing.replaceWith(resultsView(c,results,appliedSchedule,today()));
    },options.validateSchedule,()=>{appliedSchedule=freshSchedule();const existing=content.firstElementChild;if(existing)existing.replaceWith(resultsView(c,results,appliedSchedule,today()));}));
    const footer=el('footer','mt-7 space-y-4');
    add(footer,add(el('div','flex flex-wrap items-center justify-between gap-3'),pill('Review build · not a carrier decision','slate'),
      button('Clear case & session reference','min-h-[44px] text-xs font-semibold text-slate-500 underline underline-offset-4',reset)),
      el('p','text-xs leading-6 text-slate-500','Americo · 11/25 baseline. Living Promise · 04/26 partial criteria. Transamerica · 08/26 verified source, partial rules. No premium quotes or commission dollars. Cases are not saved or transmitted.'),
      el('p','text-xs leading-6 text-slate-400','For agent field review. Final eligibility, benefits and compensation are determined by the carrier. Public release requires verified sources, applicable state forms and permission to use producer-only material.'));
    add(main,footer);add(page,main);host.append(page);
    if(preserve){for(const d of host.querySelectorAll('details'))if(openSummaries.includes(d.querySelector('summary')?.textContent))d.open=true;
      if(focusId)document.getElementById(focusId)?.focus({preventScroll:true});
      else if(radioName){const radios=host.querySelectorAll<HTMLInputElement>('input[type=radio]');[...radios].find(r=>r.name===radioName&&r.value===radioValue)?.focus({preventScroll:true});}
      window.scrollTo(0,y);
    }else{window.scrollTo(0,0);if(step>0)h.focus({preventScroll:true});}
  }
  const onFocus=()=>{if(step===3)render(true);};
  window.addEventListener('focus',onFocus);
  render(false);
  return ()=>{window.removeEventListener('focus',onFocus);closed=true;c=freshCase();schedule=freshSchedule();appliedSchedule=freshSchedule();results=[];host.replaceChildren();};
}
