import { execSync } from "node:child_process";

const PRODUCTION_PROJECT_REF = "jncvvsvckxhqgqvkppmj";

export function loadAdminEnv() {
  const url =
    process.env.SUPABASE_URL?.trim() ||
    process.env.VITE_SUPABASE_URL?.trim() ||
    `https://${PRODUCTION_PROJECT_REF}.supabase.co`;

  let serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    try {
      const raw = execSync(
        `npx supabase projects api-keys --project-ref ${PRODUCTION_PROJECT_REF} -o json`,
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      const rows = JSON.parse(raw);
      serviceRoleKey = rows.find((r) => r.name === "service_role")?.api_key?.trim();
    } catch {
      /* fall through */
    }
  }

  return { url, serviceRoleKey, projectRef: PRODUCTION_PROJECT_REF };
}

export function assertProductionAllowed(url, projectRef) {
  if (!url.includes(projectRef)) return;
  if (process.env.ALLOW_PRODUCTION === "yes") return;
  throw new Error(
    "Refusing production without ALLOW_PRODUCTION=yes.\n" +
      "You asked to seed live data — re-run with: ALLOW_PRODUCTION=yes",
  );
}
