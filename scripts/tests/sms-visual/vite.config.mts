import {defineConfig} from 'vite';import react from '@vitejs/plugin-react-swc';import {fileURLToPath} from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('.',import.meta.url)),plugins:[react()],resolve:{alias:{'@':fileURLToPath(new URL('../../../src',import.meta.url))}},build:{outDir:process.env.SMS_VISUAL_DIST || '/tmp/cg-sms-visual-dist',emptyOutDir:true}});
