import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";

const root = path.resolve(__dirname, "../../../..");
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: [
      ...["@/integrations/supabase/client", "@/contexts/AuthContext", "@/hooks/useOrganization", "@/hooks/usePermissions", "@/hooks/useCommissionCalculator"]
        .map((find) => ({ find, replacement: path.join(__dirname, "fixtures.ts") })),
      { find: "@", replacement: path.join(root, "src") },
    ],
    dedupe: ["react", "react-dom"],
  },
  css: { postcss: root },
  server: { host: "127.0.0.1", port: 4186, strictPort: true, fs: { allow: [root] } },
});
