import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../../..');
export default defineConfig({root:here,plugins:[react()],resolve:{alias:[{find:'@/integrations/supabase/client',replacement:path.join(here,'client.ts')},{find:'@twilio/voice-sdk',replacement:path.join(here,'voice.ts')},{find:'@',replacement:path.join(root,'src')}]},css:{postcss:root},server:{host:'127.0.0.1',port:4176,strictPort:true,fs:{allow:[root]}}});
