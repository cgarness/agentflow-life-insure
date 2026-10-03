import {defineConfig} from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";
const root=path.resolve(__dirname,"../../..");
export default defineConfig({root:__dirname,plugins:[react()],server:{host:"127.0.0.1",port:4179,strictPort:true,fs:{allow:[root]}},
 resolve:{alias:[...['@/contexts/AuthContext','@/contexts/BrandingContext','@/integrations/supabase/client'].map(find=>({find,replacement:path.join(__dirname,'stubs.ts')})),{find:'@',replacement:path.join(root,'src')}],dedupe:['react','react-dom']},
 css:{postcss:root}});
