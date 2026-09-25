import { apiRoute } from "@/lib/api-helpers";
import { aiMode } from "@/lib/ai/gateway";
import { integrationStatus } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Readiness probe (spec §131). A 200 here must mean the process can actually
 * serve requests — so the database is probed and, when it is down, the probe
 * fails with 503 instead of a misleading "ok". Liveness is reported on the
 * same route as a cheap always-200 answer so orchestrators can distinguish
 * "process alive but not ready" from "process dead".
 */
export const GET = apiRoute(async (request) => {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");

  // Liveness: the process is up. Never depends on dependencies.
  if (mode === "liveness") {
    return Response.json({ status: "alive", time: new Date().toISOString() });
  }

  let database: { ok: boolean; latencyMs: number; error?: string };
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = { ok: true, latencyMs: Date.now() - started };
  } catch (e) {
    database = {
      ok: false,
      latencyMs: Date.now() - started,
      error: e instanceof Error ? e.message : "unavailable",
    };
  }

  // Readiness: every hard dependency must be healthy.
  const ready = database.ok;
  return Response.json(
    {
      status: ready ? "ready" : "unready",
      time: new Date().toISOString(),
      ai: aiMode(),
      database,
      integrations: integrationStatus,
    },
    { status: ready ? 200 : 503 }
  );
});
