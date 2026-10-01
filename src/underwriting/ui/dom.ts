export function el<K extends keyof HTMLElementTagNameMap>(tag:K,classes='',text?:string):HTMLElementTagNameMap[K] {
  const node=document.createElement(tag);node.className=classes;if(text!==undefined)node.textContent=text;return node;
}
export function add<T extends HTMLElement>(node:T,...children:(Node|string|undefined|null)[]):T {
  for(const child of children)if(child!==undefined&&child!==null)node.append(typeof child==='string'?document.createTextNode(child):child);return node;
}
export function button(text:string,classes:string,action:()=>void):HTMLButtonElement {
  const b=el('button',classes,text);b.type='button';b.addEventListener('click',action);return b;
}
export const primary='inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:opacity-50';
export const secondary='inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200';
export const muted='text-sm leading-6 text-slate-500';
export function note(title:string,text:string,kind:'info'|'warning'='info'):HTMLElement {
  const n=el('div',kind==='warning'?'rounded-xl border border-amber-200 bg-amber-50 p-4':'rounded-xl border border-blue-100 bg-blue-50/70 p-4');
  return add(n,el('p','text-sm font-semibold text-slate-800',title),el('p','mt-1 text-sm leading-6 text-slate-600',text));
}
export function pill(text:string,kind:'blue'|'green'|'amber'|'slate'|'red'='slate'):HTMLElement {
  const colors={blue:'bg-blue-50 text-blue-700 ring-blue-100',green:'bg-emerald-50 text-emerald-700 ring-emerald-100',
    amber:'bg-amber-50 text-amber-800 ring-amber-200',slate:'bg-slate-100 text-slate-600 ring-slate-200',red:'bg-rose-50 text-rose-700 ring-rose-100'};
  return el('span',`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${colors[kind]}`,text);
}
export function section(title:string,subtitle?:string):HTMLElement {
  const box=el('section','space-y-5');add(box,el('h2','text-xl font-bold tracking-tight text-slate-900',title));
  if(subtitle)add(box,el('p',muted,subtitle));return box;
}
