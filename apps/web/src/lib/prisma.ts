import { PrismaClient } from "@prisma/client";
import { env } from "./env";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Single Prisma client per process. The datasource URL is passed explicitly:
 * an inherited ambient `DATABASE_URL` or a value baked into the generated
 * client must never win over the resolved configuration.
 * Next.js hot-reloads modules in dev; the global cache prevents connection
 * exhaustion.
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: env.databaseUrl } },
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
