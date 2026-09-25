/**
 * Test bootstrap.
 *
 * Each suite runs against a real SQLite database (created + migrated from
 * schema.prisma) so Prisma queries are actually exercised — not mocked.
 * Tests that need data create their own fixtures inside a transaction and
 * roll back, so suites stay independent.
 */
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(__dirname, "..", ".env") });

const SCHEMA_PATH = resolve(__dirname, "..", "prisma", "schema.prisma");

// Vitest runs test files in parallel workers. If every worker force-reset the
// SAME sqlite file, concurrent writes corrupt it ("database disk image is
// malformed"). Each worker therefore gets its own isolated database.
const WORKER = process.env.VITEST_WORKER_ID ?? "0";
const DB_PATH = resolve(__dirname, "..", "prisma", `test-${WORKER}.db`);

mkdirSync(resolve(__dirname, "..", "prisma"), { recursive: true });

// Fresh schema for every run: deterministic, no leftover state.
// A stale -journal/-wal from an interrupted run leaves the file reported as
// malformed, so the file is removed wholesale first.
for (const suffix of ["", "-journal", "-wal", "-shm"]) {
  const f = `${DB_PATH}${suffix}`;
  if (existsSync(f)) rmSync(f, { force: true });
}

try {
  execSync(`npx prisma db push --force-reset --skip-generate --schema=${SCHEMA_PATH}`, {
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` },
  });
} catch (e) {
  // Fail loudly instead of silently falling back to the dev database, which
  // would let tests pass while polluting shared dev state.
  throw new Error(
    `Test database setup failed (prisma db push): ${(e as Error).message}. ` +
      "The suite cannot run safely against a shared dev database."
  );
}

// Absolute path: `lib/env.ts` resolves relative SQLite paths against the app
// root, and `config({ override: true })` there reloads .env at import time and
// would otherwise overwrite DATABASE_URL back to the development database.
// SVETLANA_TEST_DB is not present in .env, so it survives that reload and the
// Prisma client is constructed against the isolated per-worker file.
process.env.DATABASE_URL = `file:${DB_PATH}`;
process.env.SVETLANA_TEST_DB = `file:${DB_PATH}`;
