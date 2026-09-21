import { apiRoute } from "@/lib/api-helpers";
import { aiMode } from "@/lib/ai/gateway";
import { integrationStatus } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async () => {
  let db = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    db = e instanceof Error ? e.message : "unavailable";
  }
  return Response.json({
    status: "ok",
    time: new Date().toISOString(),
    ai: aiMode(),
    database: db,
    integrations: integrationStatus,
  });
});
