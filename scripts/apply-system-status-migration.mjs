#!/usr/bin/env node
/**
 * Applies system_status migration via direct Postgres (pooler).
 * Requires: SUPABASE_DB_PASSWORD from Dashboard → Settings → Database
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const password = process.env.SUPABASE_DB_PASSWORD;
const projectRef = process.env.SUPABASE_PROJECT_REF ?? "jncvvsvckxhqgqvkppmj";

if (!password) {
  console.error(
    "Set SUPABASE_DB_PASSWORD (Supabase Dashboard → Project Settings → Database → password)",
  );
  process.exit(1);
}

const sql = postgres({
  host: "aws-1-us-east-1.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  username: `postgres.${projectRef}`,
  password,
  ssl: "require",
  max: 1,
});

const migrationPath = join(
  __dirname,
  "../supabase/migrations/20260521000000_create_system_status.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8");

try {
  await sql.unsafe(migrationSql);
  console.log("Migration applied: system_status");
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
} finally {
  await sql.end();
}
