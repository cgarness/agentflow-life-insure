// Isolated Vite harness alias only. Never imported by the application bundle.
const actor='20000000-0000-4000-8000-000000000002',org='10000000-0000-4000-8000-000000000001';
const profile={id:actor,organization_id:org,role:'Agent',status:'Active',first_name:'Synthetic',last_name:'Agent',email:'synthetic@example.invalid',is_super_admin:false,permissions:{}};
const state={user:{id:actor,email:profile.email},profile,realProfile:profile,session:null,isAuthenticated:true,isLoading:false,isBuildingOrganization:false,isImpersonating:new URLSearchParams(location.search).get('viewAs')==='1',impersonatedUser:null};
export const useAuth=()=>state;
export const useTwilio=()=>({selectedCallerNumber:'+12025552222',isConnected:false,callState:'idle'});
