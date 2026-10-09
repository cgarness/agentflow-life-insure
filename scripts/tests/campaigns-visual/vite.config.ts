import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
const stubs = path.join(__dirname, "stubs.ts");

/** Isolated Campaigns fixture: real page/components/hooks/queries; synthetic transport only. */
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: { host: "127.0.0.1", port: 4190, strictPort: true, fs: { allow: [root] } },
  resolve: {
    alias: [
      ...["@/contexts/AuthContext", "@/integrations/supabase/client", "@/hooks/usePermissions", "@/contexts/BrandingContext"]
        .map((find) => ({ find, replacement: stubs })),
      { find: "@", replacement: path.join(root, "src") },
    ],
    dedupe: ["react", "react-dom"],
  },
  css: { postcss: root },
});
