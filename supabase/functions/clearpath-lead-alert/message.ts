export const fieldLimits = {
  name:161, phone:25, email:254, affiliation:50, age:30, zip:10,
  coverage:40, goal:100, bestTime:180, callback:150, verified:20, source:80, submitted:60,
} as const;
export type Details = Partial<Record<keyof typeof fieldLimits,string>>;
export function validDetails(value:unknown):value is Details {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const d=value as Record<string,unknown>;
  return typeof d.name==='string'&&d.name.trim().length>0&&typeof d.phone==='string'&&d.phone.trim().length>0
    &&Object.entries(d).every(([k,v])=>Object.hasOwn(fieldLimits,k)&&typeof v==='string'&&v.length<=fieldLimits[k as keyof Details]);
}
export function message(id:string,kind:'lead'|'test',details?:Details){
  if(kind==='test')return 'NEW VET LEAD\n- TEST: Alerts are connected\n- No new prospect was created';
  if(!details)return `NEW VET LEAD\n- Request: ${id.slice(0,8)}\n- Details: Check your saved lead records`;
  const labels:Record<keyof typeof fieldLimits,string>={name:'Name',phone:'Phone',email:'Email',affiliation:'Military connection',age:'Age range',zip:'ZIP',coverage:'Coverage requested',goal:'Coverage goal',bestTime:'Best time to call',callback:'Callback requested',verified:'Phone verified',source:'Ad source',submitted:'Submitted'};
  const lines=['NEW VET LEAD'];
  for(const key of Object.keys(fieldLimits) as (keyof Details)[]){
    const value=details[key]?.replace(/[\s\u0000-\u001f\u007f]+/g,' ').trim();
    if(value)lines.push(`- ${labels[key]}: ${value}`);
  }
  return lines.join('\n');
}
