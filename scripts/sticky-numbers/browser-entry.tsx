import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {BrowserRouter} from 'react-router-dom';
import {TooltipProvider} from '@/components/ui/tooltip';
import {BrandingProvider} from '@/contexts/BrandingContext';
import {CalendarProvider} from '@/contexts/CalendarContext';
import {DialerSmsComposer} from '@/components/dialer/DialerSmsComposer';
import Conversations from '@/pages/Conversations';
import FullScreenContactView from '@/components/contacts/FullScreenContactView';
import {pendingSmsStore} from '@/lib/sms-send/pendingSmsStore';
import {supabase} from '@/integrations/supabase/client';
import '@/index.css';
const actor='20000000-0000-4000-8000-000000000002',org='10000000-0000-4000-8000-000000000001',id='30000000-0000-4000-8000-000000000001';
const qs=new URLSearchParams(location.search),surface=qs.get('surface')??'dialer';
await supabase.auth.setSession({access_token:sessionStorage.getItem('sticky-test-token')!,refresh_token:'isolated-refresh'});
pendingSmsStore.bindAuthority({realUserId:actor,organizationId:org,impersonating:qs.get('viewAs')==='1'});
function App(){const[text,setText]=useState('');return surface==='conversations'?<Conversations/>:surface==='contact'?<FullScreenContactView contact={{id,firstName:'Synthetic',lastName:'Lead',phone:'+12025550101',status:'New',assignedAgentId:actor}} type="lead" onClose={()=>{}} onUpdate={async()=>{}} onDelete={async()=>{}}/>:<main className="mx-auto max-w-2xl p-4"><h1 className="text-xl font-semibold">Dialer · Synthetic Lead</h1><DialerSmsComposer contactId={id} phone="+12025550101" name="Synthetic Lead" text={text} onChange={setText} onTemplates={()=>{}} onRefresh={()=>{}} savedIds={[]}/></main>;}
const queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});
function SessionHarness(){const[loggedIn,setLoggedIn]=useState(true);const logout=async()=>{await supabase.auth.signOut({scope:'local'});pendingSmsStore.bindAuthority({realUserId:null,organizationId:null,impersonating:false});queryClient.clear();setLoggedIn(false);};const login=async()=>{await supabase.auth.setSession({access_token:sessionStorage.getItem('sticky-test-token')!,refresh_token:'isolated-refresh'});pendingSmsStore.bindAuthority({realUserId:actor,organizationId:org,impersonating:false});setLoggedIn(true);};return loggedIn?<><App/><button data-testid="test-sign-out" onClick={()=>void logout()}>End synthetic session</button></>:<button data-testid="test-sign-in" onClick={()=>void login()}>Start synthetic session</button>;}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><BrowserRouter><TooltipProvider><BrandingProvider><CalendarProvider><SessionHarness/></CalendarProvider></BrandingProvider></TooltipProvider></BrowserRouter></QueryClientProvider>);
