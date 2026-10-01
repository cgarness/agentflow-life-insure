import { CaseInput, ValidationIssue, CommissionSchedule } from './types';
import { states, conditions, commissionProducts } from './data';
const finite = (s:string):boolean => s.length<=16 && s.trim()!=='' && /^\d+(\.\d+)?$/.test(s) && Number.isFinite(Number(s));
export function validateCase(c:CaseInput, step?:number):ValidationIssue[] {
  const errors:ValidationIssue[]=[];
  const err=(field:string,message:string,s:number)=>errors.push({field,message,step:s});
  if(!finite(c.age)||!Number.isInteger(+c.age)||+c.age<18||+c.age>100) err('age','Enter a whole-number age from 18 to 100.',0);
  if(!states.includes(c.state)) err('state','Select the applicant’s state.',0);
  if(!finite(c.height)||!Number.isInteger(+c.height)||+c.height<48||+c.height>90) err('height','Select a measured height.',0);
  if(!finite(c.weight)||+c.weight<40||+c.weight>1000) err('weight','Enter weight from 40 to 1,000 lb.',0);
  if(!finite(c.face)||!Number.isInteger(+c.face)||+c.face<1000||+c.face>100000) err('face','Enter whole-dollar coverage from $1,000 to $100,000.',0);
  if(!['never','current','former','unknown'].includes(c.nicotine)) err('nicotine','Choose nicotine status, including Unknown when needed.',0);
  if(c.nicotine==='former'&&(!finite(c.nicotineMonths)||!Number.isInteger(+c.nicotineMonths)||+c.nicotineMonths<0||+c.nicotineMonths>1200))
    err('nicotineMonths','Enter completed months since the last nicotine use.',0);
  if(!['none','listed','unknown'].includes(c.conditionsStatus)) err('conditionsStatus','Confirm diagnoses, no known diagnoses, or Unknown.',1);
  if(c.conditionsStatus==='listed'&&!c.conditions.length) err('conditionsStatus','Choose at least one diagnosis.',1);
  if(c.conditionsStatus!=='listed'&&c.conditions.length) err('conditionsStatus','Diagnoses conflict with the selected history status.',1);
  if(c.conditions.some(id=>!conditions.some(d=>d.id===id))) err('conditionsStatus','An unsupported diagnosis identifier was supplied.',1);
  if(c.conditions.includes('other')&&!c.otherCondition.trim()) err('otherCondition','Describe the other diagnosis without identifying the client.',1);
  if(c.otherCondition.length>250) err('otherCondition','Keep the diagnosis description under 250 characters.',1);
  if(!['none','listed','unknown'].includes(c.medicationsStatus)) err('medicationsStatus','Confirm medications, no medications, or Unknown.',1);
  if(c.medicationsStatus==='listed'&&!c.medications.length) err('medicationsStatus','Add at least one medication.',1);
  if(c.medicationsStatus!=='listed'&&c.medications.length) err('medicationsStatus','Medication rows conflict with the selected medication status.',1);
  if(c.medications.length>25) err('medicationsStatus','Limit to 25 medications; additional drugs need carrier review.',1);
  c.medications.forEach(m=>{
    if(!m.name.trim()||m.name.length>100) err(`med-${m.id}`,'Enter a medication name of 1–100 characters.',1);
    if(m.indication.length>180) err(`ind-${m.id}`,'Keep the indication under 180 characters.',1);
    if(!['current','stopped','unknown'].includes(m.status)) err(`status-${m.id}`,'Choose a medication status.',1);
  });
  for(const [key,value] of Object.entries(c.answers)) if(!['','yes','no','unknown'].includes(value)) err(key,'Invalid answer.',2);
  for(const [key,value] of Object.entries(c.details)) if(value.length>250) err(key,'Use at most 250 characters.',2);
  return step===undefined?errors:errors.filter(e=>e.step===step);
}
export function nicotineClass(c:CaseInput,months:number):'yes'|'no'|'unknown' {
  if(c.nicotine==='never')return 'no';
  if(c.nicotine==='current')return 'yes';
  if(c.nicotine==='former'&&finite(c.nicotineMonths))return +c.nicotineMonths>=months?'no':'yes';
  return 'unknown';
}
export function validSchedule(s:CommissionSchedule,today:string):boolean {
  const date=(d:string)=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
  return s.basis==='first-year-commissionable-premium'&&s.acknowledged&&s.reference.trim().length>0&&s.reference.length<=120&&
    s.contract.trim().length>0&&s.contract.length<=120&&date(s.effectiveFrom)&&date(s.effectiveTo)&&
    s.effectiveFrom<=today&&s.effectiveTo>=today&&s.effectiveFrom<=s.effectiveTo&&
    Object.entries(s.rates).every(([key,value])=>commissionProducts.some(p=>p[0]===key)&&
      (value===''||(finite(value)&&+value>=0&&+value<=300)));
}

export function currentLocalDate(date:Date=new Date()):string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
