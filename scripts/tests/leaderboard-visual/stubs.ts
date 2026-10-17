// Isolated visual harness only. No auth token, API endpoint or customer records.
import {format,parseISO} from "date-fns";
export const useAuth=()=>({profile:{organization_id:"fixture-org",role:"Agent"}});
// Same formats as BrandingContext (12-hour clock); date-only strings are calendar dates, never shifted through UTC.
const at=(d:string|Date)=>typeof d==="string"?parseISO(d):d;
export const useBranding=()=>({branding:{timezone:"America/Los_Angeles",companyName:"Fixture Insurance Agency"},
 formatTime:(d:string|Date)=>format(at(d),"h:mm a"),formatDate:(d:string|Date)=>format(at(d),"MM/dd/yyyy")});
export const supabase={from:()=>{
 const q={select:()=>q,eq:()=>q,maybeSingle:()=>Promise.resolve({data:null,error:null})};return q;
}};
