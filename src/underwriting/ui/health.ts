import { CaseInput, Medication, ValidationIssue } from '../types';
import { conditions, mutualRxExclude, mutualRxStarred, mutualRxIndication } from '../data';
import { el, add, button, secondary, note } from './dom';
import { input, select, inputClass } from './fields';
export function health(c:CaseInput,change:()=>void,rerender:()=>void,errors:ValidationIssue[]):HTMLElement {
  const root=el('div','space-y-7');
  add(root,select('conditionsStatus','Diagnosed health conditions',c.conditionsStatus,[['','Choose history status'],['none','No known diagnosed conditions'],['listed','Add diagnosed conditions'],['unknown','History is not fully known']],v=>{
    c.conditionsStatus=v as CaseInput['conditionsStatus'];c.conditions=[];c.otherCondition='';c.answers={...c.answers,respQuestion:'',heartQuestion:'',strokeQuestion:'',diabetesComplication:''};change();rerender();},'A blank answer is never treated as No.',errors));
  if(c.conditionsStatus==='listed'){
    const search=el('input',inputClass);search.placeholder='Search diagnoses…';search.type='search';search.setAttribute('aria-label','Search diagnoses');
    const list=el('div','grid max-h-80 grid-cols-1 gap-2 overflow-y-auto rounded-xl border border-slate-100 p-2 sm:grid-cols-2');
    const paint=()=>{list.replaceChildren();for(const d of conditions.filter(d=>d.label.toLowerCase().includes(search.value.toLowerCase()))){
      const chosen=c.conditions.includes(d.id);
      const b=button(d.label,`min-h-[44px] rounded-lg border px-3 py-2.5 text-left text-sm transition ${chosen?'border-blue-400 bg-blue-50 font-semibold text-blue-800':'border-slate-200 text-slate-700 hover:bg-slate-50'}`,()=>{
        c.conditions=chosen?c.conditions.filter(x=>x!==d.id):[...c.conditions,d.id];
        const selectedModules=new Set(c.conditions.map(id=>conditions.find(x=>x.id===id)?.module));
        for(const [module,key] of [['respiratory','respQuestion'],['heart','heartQuestion'],['stroke','strokeQuestion'],['diabetes','diabetesComplication']] as const)
          if(!selectedModules.has(module))c.answers[key]='';
        change();paint();other.hidden=!c.conditions.includes('other');
      });b.setAttribute('aria-pressed',String(chosen));list.append(b);
    }if(!list.children.length)add(list,el('p','p-2 text-sm text-slate-500','No exact category? Clear the search and choose Another diagnosis.'));};
    const other=input('otherCondition','Other diagnosis',c.otherCondition,v=>{c.otherCondition=v;change();},{placeholder:'Diagnosis only — no client name',maxLength:250,errors});
    other.hidden=!c.conditions.includes('other');search.addEventListener('input',paint);paint();add(root,search,list,other);
  }
  add(root,select('medicationsStatus','Prescription medications',c.medicationsStatus,[['','Choose medication status'],['none','No prescription medications'],['listed','Add medications'],['unknown','Medication list is not fully known']],v=>{
    c.medicationsStatus=v as CaseInput['medicationsStatus'];c.medications=[];if(v==='listed')c.medications.push(newMedication());change();rerender();},'The name alone does not establish a diagnosis or eligibility.',errors));
  if(c.medicationsStatus==='listed'){
    const datalist=el('datalist');datalist.id='medication-names';
    for(const name of [...new Set([...mutualRxExclude,...mutualRxStarred,...mutualRxIndication])].sort()){const o=el('option');o.value=name;datalist.append(o);}root.append(datalist);
    for(const m of c.medications){
      const card=el('div','space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4');
      const name=input(`med-${m.id}`,'Medication name',m.name,v=>{m.name=v;change();},{placeholder:'Brand or exact generic name',maxLength:100,errors});
      name.querySelector('input')?.setAttribute('list','medication-names');
      add(card,name,input(`ind-${m.id}`,'Prescribed for',m.indication,v=>{m.indication=v;change();},{placeholder:'Condition, or type Unknown',maxLength:180,errors}),
        select(`status-${m.id}`,'Treatment status',m.status,[['current','Currently taken'],['stopped','Discontinued'],['unknown','Unknown']],v=>{m.status=v as Medication['status'];change();}),
        button('Remove medication','min-h-[44px] text-sm font-medium text-slate-500 hover:text-rose-700',()=>{c.medications=c.medications.filter(x=>x.id!==m.id);change();rerender();}));add(root,card);
    }
    if(c.medications.length<25)add(root,button('+ Add another medication',secondary,()=>{c.medications.push(newMedication());change();rerender();}));
    add(root,note('Exact matches only','An unrecognized spelling or drug returns Needs review. Autocomplete is a source vocabulary, not a complete medication database.'));
  }return root;
}
let counter=0;
function newMedication():Medication {return {id:`rx${++counter}`,name:'',indication:'',status:'unknown'};}
