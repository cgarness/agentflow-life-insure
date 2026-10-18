import { createContext, useContext, useState, type ReactNode } from 'react';
const own = {id:'20000000-0000-4000-8000-000000000001',organization_id:'10000000-0000-4000-8000-000000000001',phone:'+15550001000',email:'synthetic@example.invalid'};
const Auth = createContext({user:{id:own.id} as {id:string}|null,realProfile:own,profile:own,isLoading:false,isImpersonating:false});
export const useAuth = () => useContext(Auth);
export function FixtureAuth({children}:{children:ReactNode}) {
 const [mode,setMode]=useState('self');
 return <Auth.Provider value={{user:mode==='out'?null:{id:own.id},realProfile:own,profile:own,isLoading:false,isImpersonating:mode==='view'}}>
  <main className="mx-auto max-w-3xl space-y-4 p-4">
   <h1 className="text-lg font-semibold">Synthetic acceptance only</h1>
   <nav className="flex gap-3">{['self','view','out'].map(value=><button key={value} onClick={()=>setMode(value)}>{value}</button>)}</nav>
   {children}
  </main>
 </Auth.Provider>;
}
