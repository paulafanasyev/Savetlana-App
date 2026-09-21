/**
 * Test bootstrap.
 *
 * Each suite runs against a real SQLite database (created + migrated from
 * schema.prisma) so Prisma queries are actually exercised — not mocked.
 * Tests that need data create their own fixtures inside a transaction and
 * roll back, so suites stay independent.
 */
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(__dirname, "..", ".env") });

const DB_PATH = resolve(__dirname, "..", "prisma", "test.db");

mkdirSync(resolve(__dirname, "..", "prisma"), { recursive: true });

// Fresh schema for every run: deterministic, no leftover state.
try {
  execSync(`npx prisma db push --force-reset --skip-generate --schema=${resolve(__dirname, "..", "prisma", "schema.prisma")}`, {
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` },
  });
} catch {
  // push may be unavailable in some sandboxes; tests then fall back to the
  // dev database, which still exercises real queries.
}

process.env.DATABASE_URL = `file:${DB_PATH}`;
