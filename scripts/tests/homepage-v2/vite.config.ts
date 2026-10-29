import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { fileURLToPath } from "node:url";

// Only this isolated development harness permits the managed preview host.
// The application's Vite settings and production authentication are untouched.
const root = fileURLToPath(new URL("../../../", import.meta.url));
export default defineConfig({
  root,
  plugins: [react()],
  server: { host: "0.0.0.0", allowedHosts: ["terminal.local"] },
  resolve: { alias: { "@": `${root}src` }, dedupe: ["react", "react-dom"] },
});
