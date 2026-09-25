/**
 * TEST-ONLY Vite config for the isolated LOCAL verification (implementation_plan.md §10).
 * Differences from the production `vite.config.ts`:
 * - binds 127.0.0.1:8089 only, with strictPort;
 * - `envDir` points at a non-existent directory, so repo `.env*` files are never read;
 * - an explicit `root` (the repository);
 * - swaps `@/lib/twilio-voice` for the fake Voice.js boundary (`fakeTwilioVoice.ts`).
 *
 * Refusals (fail closed, at startup):
 * - `VITE_SUPABASE_URL` must be `http://127.0.0.1:<port>`;
 * - no `VITE_*` value may be a JWT that is not the local demo issuer, or that carries the `service_role` role.
 *
 * Vite exposes every `VITE_*` process variable to the browser, so the caller should still launch it with
 * `env -i` and only the two local values. The second refusal was added after the recorded 2026-09-24 run.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const root = path.resolve(__dirname, "../..");
const url = process.env.VITE_SUPABASE_URL ?? "";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) {
  throw new Error(`[local-verify] VITE_SUPABASE_URL must be a 127.0.0.1 URL, got: ${url || "<unset>"}`);
}
for (const [k, v] of Object.entries(process.env)) {
  if (!k.startsWith("VITE_") || !v || !/^eyJ[\w-]+\.[\w-]+\.[\w-]*$/.test(v)) continue;
  let claims: { iss?: string; role?: string } = {};
  try {
    claims = JSON.parse(Buffer.from(v.split(".")[1], "base64url").toString());
  } catch {
    throw new Error(`[local-verify] ${k} looks like a JWT but cannot be decoded`);
  }
  if (claims.iss !== "supabase-demo" || claims.role === "service_role") {
    throw new Error(`[local-verify] refusing ${k}: only the local demo anon key may reach the browser`);
  }
}

export default defineConfig({
  root,
  envDir: path.resolve(__dirname, ".env-none"), // never read repo/.env files
  server: { host: "127.0.0.1", port: 8089, strictPort: true, hmr: { overlay: false } },
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\/lib\/twilio-voice$/, replacement: path.resolve(__dirname, "fakeTwilioVoice.ts") },
      { find: "@", replacement: path.resolve(root, "src") },
    ],
    dedupe: ["react", "react-dom", "react/jsx-runtime", "@tanstack/react-query"],
  },
  optimizeDeps: { include: ["@tanstack/react-query"] },
});
