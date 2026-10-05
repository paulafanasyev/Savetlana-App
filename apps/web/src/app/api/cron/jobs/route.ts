import { apiRoute } from "@/lib/api-helpers";
import { env } from "@/lib/env";
import { runJobs } from "@/lib/domains/jobs";
import { audit } from "@/lib/domains/audit";

export const dynamic = "force-dynamic";

/**
 * Background job entry point (P0-18, spec §50).
 *
 * Driven by Vercel Cron (see vercel.json), the `cron` container of the
 * self-hosted docker-compose stack, or any external scheduler that hits this
 * URL. Protected by a shared secret so the endpoint cannot be abused to
 * trigger unbounded payout work: the caller must present
 * `Authorization: Bearer <CRON_SECRET>`, which only the deployment knows.
 *
 * Vercel Cron issues GET requests, self-hosted schedulers use POST: both are
 * accepted and share exactly the same authorization check. Before this fix
 * only POST existed, so Vercel Cron received 405 and no job ever ran.
 *
 * Each call performs one bounded slice of every category (see jobs.ts), so a
 * missed tick degrades to slightly staler work rather than a lost job.
 */
async function handle(request: Request): Promise<Response> {
  const provided = request.headers.get("authorization");
  const expected = env.cronSecret;
  if (!expected) {
    // Unconfigured deployment must never expose an open job runner.
    return Response.json({ error: "Планировщик не настроен", code: "not_configured" }, { status: 503 });
  }
  if (provided !== `Bearer ${expected}`) {
    return Response.json({ error: "Нет доступа", code: "forbidden" }, { status: 403 });
  }

  const result = await runJobs();

  // One audit row per run, without secrets, so operators can confirm the
  // worker is actually executing (spec §140). actorId is null: "system" is not
  // a User row, and the FK on AuditLog.actorId would otherwise reject the
  // insert (the audit log itself must never break the job it records).
  const failures = Object.entries(result.categories).filter(([, v]) => !v.ok);
  await audit({
    actorRole: "system",
    action: "jobs.run",
    targetType: "system",
    targetId: "scheduler",
    after: { categories: Object.keys(result.categories), failures: failures.map(([k]) => k) },
  }).catch(() => undefined);

  return Response.json(result);
}

export const POST = apiRoute(async (request) => handle(request));
export const GET = apiRoute(async (request) => handle(request));
