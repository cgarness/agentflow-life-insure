import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: {
    "https://esm.sh/@supabase/supabase-js@2": "@supabase/supabase-js",
    "https://esm.sh/zod@3.25.76": "zod",
    "https://deno.land/std@0.190.0/http/server.ts": path.resolve("supabase/tests/google-serve-stub.ts"),
  } },
  test: { environment: "node", include: ["supabase/functions/_shared/google*.test.ts", "supabase/tests/google*.test.ts"], testTimeout: 20000, hookTimeout: 30000, fileParallelism: false },
});
