// Isolated visual harness only. No auth token, API endpoint or customer records.
export const useAuth=()=>({profile:{organization_id:"fixture-org",role:"Agent"}});
export const useBranding=()=>({branding:{timezone:"America/Los_Angeles",companyName:"Fixture Insurance Agency"},formatTime:String,formatDate:String});
export const supabase={from:()=>{
 const q={select:()=>q,eq:()=>q,maybeSingle:()=>Promise.resolve({data:null,error:null})};return q;
}};
