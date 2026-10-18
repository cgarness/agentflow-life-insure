import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const fixture=path.dirname(fileURLToPath(import.meta.url));
const af=path.resolve(fixture,'../../../..');
const peer=process.env.UV_PROFILE_PEER;
if(!peer) throw Error('UV_PROFILE_PEER is required');
const uv=process.env.UV_BROWSER_TARGET==='uv';
const root=uv?path.resolve(peer):af;
const subject=uv ? `
 import React from 'react'; import {BrowserRouter,Routes,Route} from 'react-router-dom';
 import Index from '@/pages/Index'; import Search from '@/pages/Search';
 export default function Subject(){return <BrowserRouter><Routes><Route path="/" element={<Search/>}/><Route path="/:agencySlug/:agentSlug" element={<Index/>}/></Routes></BrowserRouter>}
` : `
 import React from 'react'; import {FixtureAuth} from './auth';
 import {UnderwriterVerifiedProfile} from '@/components/underwriter-verified/UnderwriterVerifiedProfile';
 export default function Subject(){return <FixtureAuth><UnderwriterVerifiedProfile/></FixtureAuth>}
`;
export default defineConfig({
 root:fixture,envDir:false,
 plugins:[react(),{name:'synthetic-subject',resolveId(id){if(id==='virtual:subject')return path.join(fixture,'subject.tsx');},load(id){if(id===path.join(fixture,'subject.tsx'))return subject;}}],
 define:{'import.meta.env.VITE_UV_PROFILE_ENABLED':JSON.stringify('true'),'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('http://127.0.0.1:54321'),
  'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('synthetic-test-only'),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('synthetic-test-only'),
  'import.meta.env.VITE_DEPLOYMENT_ENV':JSON.stringify('preview')},
 server:{host:'127.0.0.1',port:uv?4188:4187,strictPort:true,fs:{allow:[af,path.resolve(peer)]}},
 resolve:{alias:[{find:'@/contexts/AuthContext',replacement:path.join(fixture,'auth.tsx')},{find:'@',replacement:path.join(root,'src')}],dedupe:['react','react-dom','@tanstack/react-query']},
 css:{postcss:root}
});
