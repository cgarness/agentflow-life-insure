import { CaseInput, ValidationIssue } from '../types';
import { states } from '../data';
import { el, add, note } from './dom';
import { input, select, Option } from './fields';
export function basics(c:CaseInput,change:()=>void,rerender:()=>void,errors:ValidationIssue[]):HTMLElement {
  const root=el('div','space-y-6'),grid=el('div','grid grid-cols-2 gap-5');
  const val=(key:'age'|'state'|'height'|'weight'|'face'|'nicotineMonths')=>(v:string)=>{c[key]=v;change();};
  add(grid,
    input('age','Applicant age',c.age,val('age'),{type:'number',placeholder:'Age last birthday',min:'18',max:'100',step:'1',errors}),
    select('state','Applicant state',c.state,[['','Select state'],...states.map(s=>[s,s] as Option)],val('state'),undefined,errors),
    select('height','Height',c.height,[['','Select height'],...Array.from({length:43},(_,i)=>[String(i+48),`${Math.floor((i+48)/12)}′ ${(i+48)%12}″`] as Option)],val('height'),undefined,errors),
    input('weight','Weight',c.weight,val('weight'),{type:'number',placeholder:'Pounds',min:'40',max:'1000',step:'0.1',errors}),
    input('face','Coverage needed',c.face,val('face'),{type:'number',placeholder:'e.g. 20000',min:'1000',max:'100000',step:'1',help:'Used for eligibility only. This tool does not quote premiums.',errors}),
    select('nicotine','Nicotine use',c.nicotine,[['','Choose status'],['never','Never used nicotine'],['current','Currently using'],['former','Former use'],['unknown','Unknown']],v=>{c.nicotine=v as CaseInput['nicotine'];c.nicotineMonths='';change();rerender();},'Include vaping, chewing tobacco, nicotine gum and patches.',errors)
  );
  for(const i of [4,5])grid.children[i]?.classList.add('col-span-2','sm:col-span-1');
  if(c.nicotine==='former')add(grid,input('nicotineMonths','Months since last nicotine use',c.nicotineMonths,val('nicotineMonths'),{type:'number',min:'0',max:'1200',step:'1',help:'Completed months without any nicotine. Each carrier applies its own timeframe.',errors}));
  add(root,grid,note('No identifying information needed','Use age, not a date of birth. Do not enter the client’s name, phone number, Social Security number or policy number.'));
  return root;
}
