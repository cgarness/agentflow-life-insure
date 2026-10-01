import { CaseInput, Question } from '../types';
import { conditions } from '../data';
import { el, add, note } from './dom';
import { answer, input } from './fields';
export const safetyQuestions:Question[]=[
  {id:'oxygen12',title:'Supplemental oxygen for breathing within the past 12 months?',help:'Do not equate a CPAP device by itself with supplemental oxygen. Confirm what was actually used.',source:'AM2511 p10'},
  {id:'adl12',title:'Specified daily-living assistance or bed-bound status within 12 months?',help:'Assistance with bathing, toileting or dressing because of debilitating disease, or being bed-bound.',source:'AM2511 p10'},
  {id:'hospice12',title:'Hospice care within the past 12 months?',source:'AM2511 p10'},
  {id:'mobility12',title:'Dependent on a wheelchair or motorized mobility device within 12 months?',help:'Ask about dependence; do not assume occasional or temporary use means dependence.',source:'AM2511 p10'},
  {id:'pending',title:'Unresolved medical testing, diagnosis, procedure or hospitalization?',help:'Recommended tests, surgery or hospitalization not completed (excluding those related to HIV/AIDS), awaiting a diagnosis/results, or currently hospitalized. Use Unknown if the guide’s wording does not clearly fit.',source:'AM2511 p10'}
];
export function dynamicQuestions(c:CaseInput):Question[] {
  const modules=new Set(c.conditions.map(id=>conditions.find(x=>x.id===id)?.module));const out:Question[]=[];
  if(modules.has('respiratory'))out.push({id:'respQuestion',title:'Americo respiratory question answered Yes?',help:'Confirm against the actual current application wording. Do not infer the answer only from a medication.',source:'AM2511 p9'});
  if(modules.has('heart'))out.push({id:'heartQuestion',title:'Americo heart disease question answered Yes?',help:'The guide’s interaction rule is tied to the application answer, not a generic cardiac label.',source:'AM2511 p9'});
  if(modules.has('stroke'))out.push({id:'strokeQuestion',title:'Americo stroke / TIA question answered Yes?',source:'AM2511 p9'});
  if(modules.has('diabetes'))out.push({id:'diabetesComplication',title:'Any complication associated with diabetes?',help:'Complications need carrier review. The published “Select 2 Nicotine” wording does not explain all nonsmoker cases.',source:'AM2511 p10'});
  return out;
}
export function questions(c:CaseInput,change:()=>void,rerender:()=>void):HTMLElement {
  const root=el('div','space-y-5');
  add(root,note('Answer what is known','Unknown or unanswered facts remain visible in results. No clinical diagnosis is inferred, and no carrier’s exclusions are transferred to another carrier.'));
  for(const q of [...safetyQuestions,...dynamicQuestions(c)])add(root,answer(q.id,q.title,c.answers[q.id]??'',v=>{c.answers[q.id]=v;c.answers.moReviewed='';c.answers.moPart1='';c.answers.moPart2='';change();rerender();},q.help));
  const details=el('details','rounded-xl border border-slate-200 p-4');
  add(details,el('summary','min-h-[44px] cursor-pointer text-sm font-semibold leading-6 text-slate-800','Carrier / state verification — optional, improves the review'));
  const inside=el('div','mt-4 space-y-4');
  for(const [id,title,help] of [
    ['amState','Americo availability checked for this state?','Check the current product and application, including any variations.'],
    ['moState','Living Promise availability checked for this state?','Use the actual applicable state of application and residency requirements.'],
    ['moReviewed','Current Living Promise state application reviewed?','Only confirm after reviewing the actual form and complete medical answers.'],
    ['moPart1','Any Yes answers in Living Promise Part One?','A Yes may make the applicant ineligible; this summary alone is not a definitive decline.'],
    ['moPart2','Any Yes answers in Living Promise Part Two?','A Yes limits consideration to Graded, subject to the other requirements.']
  ])add(inside,answer(id!,title!,c.answers[id!]??'',v=>{c.answers[id!]=v;change();rerender();},help));
  add(inside,input('moForm','Living Promise form / version / application state',c.details.moForm??'',v=>{c.details.moForm=v;change();},{placeholder:'Form number, revision and state — no client information',maxLength:250}));
  add(details,inside);add(root,details);return root;
}
