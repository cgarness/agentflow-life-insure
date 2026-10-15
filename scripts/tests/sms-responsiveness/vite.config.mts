import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { fileURLToPath } from "node:url";
import path from "node:path";

// SMS_FIXTURE_SRC points at the `src` tree under test (the candidate by default, or a base worktree).
const here = fileURLToPath(new URL(".", import.meta.url));
const src = path.resolve(process.env.SMS_FIXTURE_SRC || path.join(here, "../../../src"));
const stub = (file: string) => path.join(here, "stubs", file);

export default defineConfig({
  root: here,
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\/integrations\/supabase\/client$/, replacement: stub("supabase.ts") },
      { find: /^@\/contexts\/AuthContext$/, replacement: stub("auth.tsx") },
      { find: /^@\/contexts\/TwilioContext$/, replacement: stub("twilio.tsx") },
      { find: /^@\/lib\/supabase-messages$/, replacement: stub("messages.ts") },
      { find: /^@fixture-real\/supabase-messages$/, replacement: path.join(src, "lib/supabase-messages.ts") },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  build: { outDir: process.env.SMS_FIXTURE_DIST || "/tmp/cg-sms-responsiveness-dist", emptyOutDir: true, sourcemap: false },
});
