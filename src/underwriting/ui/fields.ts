import { Answer, ValidationIssue } from '../types';
import { el, add, button } from './dom';
export const inputClass='min-w-0 w-full min-h-[48px] rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100';
export type Option=readonly [string,string];
export function field(id:string,title:string,control:HTMLElement,help?:string,errors:ValidationIssue[]=[]):HTMLElement {
  const box=el('div','min-w-0 space-y-2');control.id=id;
  const label=el('label','block text-sm font-semibold text-slate-700',title);label.htmlFor=id;add(box,label,control);
  const err=errors.find(e=>e.field===id);
  if(err){control.setAttribute('aria-invalid','true');control.setAttribute('aria-describedby',`${id}-error`);
    const p=el('p','text-sm text-rose-700',err.message);p.id=`${id}-error`;add(box,p);}
  else if(help){const p=el('p','text-xs leading-5 text-slate-500',help);p.id=`${id}-help`;control.setAttribute('aria-describedby',p.id);add(box,p);}
  return box;
}
export function input(id:string,title:string,value:string,onChange:(v:string)=>void,options:{type?:string;help?:string;placeholder?:string;maxLength?:number;errors?:ValidationIssue[];min?:string;max?:string;step?:string}={}):HTMLElement {
  const c=el('input',inputClass);c.type=options.type??'text';c.value=value;c.autocomplete='off';
  if(c.type==='number')c.inputMode='decimal';c.maxLength=options.maxLength??250;
  if(options.placeholder)c.placeholder=options.placeholder;
  if(options.min)c.min=options.min;if(options.max)c.max=options.max;if(options.step)c.step=options.step;
  c.addEventListener('input',()=>onChange(c.value));return field(id,title,c,options.help,options.errors);
}
export function select(id:string,title:string,value:string,options:Option[],onChange:(v:string)=>void,help?:string,errors:ValidationIssue[]=[]):HTMLElement {
  const c=el('select',inputClass);for(const [v,label] of options){const o=el('option','',label);o.value=v;c.append(o);}c.value=value;
  c.addEventListener('change',()=>onChange(c.value));return field(id,title,c,help,errors);
}
export function answer(id:string,title:string,value:Answer,onChange:(v:Answer)=>void,help?:string):HTMLElement {
  const fs=el('fieldset','rounded-xl border border-slate-200 p-4');
  const legend=el('legend','px-1 text-sm font-semibold leading-6 text-slate-800',title);add(fs,legend);
  if(help)add(fs,el('p','mb-3 text-xs leading-5 text-slate-500',help));
  const group=el('div','grid grid-cols-3 gap-2');fs.id=id;
  for(const [v,t] of [['yes','Yes'],['no','No'],['unknown','Unknown']] as const){
    const label=el('label',`flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-lg border px-2 py-2 text-sm font-medium ${value===v?'border-blue-500 bg-blue-50 text-blue-700':'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`);
    const radio=el('input','h-4 w-4 accent-blue-600');radio.type='radio';radio.name=id;radio.value=v;radio.checked=value===v;
    radio.addEventListener('change',()=>onChange(v));add(label,radio,el('span','',t));group.append(label);
  }add(fs,group);return fs;
}
