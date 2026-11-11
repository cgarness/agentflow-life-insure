import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');

export default defineConfig({
  root: here,
  envDir: false,
  plugins: [react()],
  resolve: { alias: [
    { find: '@/integrations/supabase/client', replacement: path.join(here, 'client.ts') },
    { find: '@/contexts/AuthContext', replacement: path.join(here, 'auth.ts') },
    { find: '@', replacement: path.join(root, 'src') },
  ] },
  css: { postcss: root },
  server: { host: '127.0.0.1', port: 4188, strictPort: true, fs: { allow: [root] } },
});
