import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const stub = fileURLToPath(new URL("./stubs.ts", import.meta.url));
export default defineConfig({ root, plugins: [react()],
  server: { host: "0.0.0.0", allowedHosts: ["terminal.local"] },
  resolve: { alias: [
    ...["@/contexts/AuthContext", "@/contexts/BrandingContext", "@/integrations/supabase/client", "@/hooks/useDashboardSection"]
      .map(find => ({ find, replacement: stub })),
    { find: "@", replacement: `${root}src` },
  ], dedupe: ["react", "react-dom"] },
  build: { outDir: `${root}scratch/homepage-v2-capture-dist`, emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL("./index.html", import.meta.url)) } },
});
