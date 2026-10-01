import { CommissionSchedule, Result } from '../types';
import { commissionProducts } from '../data';
import { validSchedule } from '../validation';
import { commissionLeaders } from '../engine';
import { el, add, note, button, primary } from './dom';
import { input } from './fields';
export function commissionPanel(s:CommissionSchedule,results:Result[],today:string,apply:()=>void,guard?:(s:CommissionSchedule)=>void,invalidate:()=>void=()=>{}):HTMLElement {
  const details=el('details','rounded-2xl border border-slate-200 bg-white p-5 sm:p-6');details.id='commission-panel';
  add(details,el('summary','min-h-[44px] cursor-pointer py-2 text-base font-bold text-slate-900','Your commission reference (optional)'));
  const body=el('div','mt-4 space-y-5');
  const message=el('p','text-sm leading-6 text-slate-600');message.setAttribute('aria-live','polite');
  const changed=()=>{invalidate();message.textContent='Changes are not applied. Review this reference and select Apply.';};
  add(body,note('Use your actual applicable schedule','This compares first-year rates on the same commissionable-premium basis, not earnings dollars, advances or guaranteed compensation. Private session-only entries are not carrier-verified.'));
  const meta=el('div','grid grid-cols-1 gap-4 sm:grid-cols-2');
  add(meta,input('schedule-reference','Schedule name / version',s.reference,v=>{s.reference=v;changed();},{maxLength:120,placeholder:'Current product schedule'}),
    input('schedule-contract','Agent contract / level',s.contract,v=>{s.contract=v;changed();},{maxLength:120,placeholder:'Your applicable contract level'}),
    input('schedule-from','Effective from',s.effectiveFrom,v=>{s.effectiveFrom=v;changed();},{type:'date'}),
    input('schedule-to','Valid through',s.effectiveTo,v=>{s.effectiveTo=v;changed();},{type:'date'}));add(body,meta);
  const rateGrid=el('div','grid grid-cols-1 gap-4 sm:grid-cols-2');
  for(const [key,title] of commissionProducts)add(rateGrid,input(`rate-${key}`,`${title} · rate %`,s.rates[key]??'',v=>{s.rates[key]=v;changed();},{type:'number',min:'0',max:'300',step:'0.01',placeholder:'Not supplied'}));
  add(body,rateGrid);
  const label=el('label','flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600');
  const ack=el('input','mt-1 h-4 w-4 shrink-0 accent-blue-600');ack.type='checkbox';ack.checked=s.acknowledged;ack.id='schedule-ack';
  ack.addEventListener('change',()=>{s.acknowledged=ack.checked;changed();});
  add(label,ack,el('span','','I checked the age, state, product and contract adjustments. These rates use the same first-year commissionable-premium basis. They are not advance percentages.'));

  add(body,label,button('Apply session reference',primary,()=>{
    try{if(!validSchedule(s,today))throw new Error('Complete the schedule name, contract, valid date range and acknowledgement. Rates must be from 0–300%.');guard?.(s);
      message.textContent=commissionLeaders(results,s,today).length?'Reference applied. Only comparable candidates receive a badge.':'Reference applied. No badge yet: at least two comparable candidate tiers and all their applicable rates are required.';
      apply();
    }catch(error){message.textContent=error instanceof Error?error.message:'The reference could not be validated.';}
  }),message);
  add(details,body);return details;
}
