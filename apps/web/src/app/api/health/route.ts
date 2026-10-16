import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { aiMode } from "@/lib/ai/gateway";
import { env, integrationStatus } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getStorageProvider, lastStorageError, storeUpload } from "@/lib/storage";
import { telegramDiagnostics } from "@/lib/telegram-diagnostics";

export const dynamic = "force-dynamic";

// Крошечный PNG для пробной загрузки: сигнатура и несколько байт.
const PROBE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);

/**
 * Readiness probe (spec §131). A 200 here must mean the process can actually
 * serve requests — so the database is probed and, when it is down, the probe
 * fails with 503 instead of a misleading "ok". Liveness is reported on the
 * same route as a cheap always-200 answer so orchestrators can distinguish
 * "process alive but not ready" from "process dead".
 *
 * ?mode=storage: пробная загрузка крошечного файла и его удаление. Показывает, куда
 * реально попал файл (Blob или база) и последнюю ошибку Blob. Не чаще 3 раз в минуту.
 *
 * telegram: настроен ли бот уведомлений (только имена недостающих переменных, без значений).
 * scheduler: задан ли ключ фоновых задач (да/нет, без значения) и когда они в последний раз работали.
 * classifieds: сколько опубликованных объявлений видит именно сервер API, и сколько в каждом
 * статусе (только числа, без самих объявлений).
 */
export const GET = apiRoute(async (request) => {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");

  // Liveness: the process is up. Never depends on dependencies.
  if (mode === "liveness") {
    return Response.json({ status: "alive", time: new Date().toISOString() });
  }

  if (mode === "storage") {
    if (!rateLimit("health-storage", 3, 60_000)) return tooManyRequests();
    const provider = getStorageProvider().key;
    try {
      const stored = await storeUpload({ bucket: "public/healthcheck", filename: `probe-${Date.now()}.png`, bytes: PROBE_PNG, declaredMimeType: "image/png", storageClass: "public" });
      let deleted = true;
      await getStorageProvider().delete(stored.key).catch(() => { deleted = false; });
      return Response.json({ provider, storedIn: stored.provider, ok: stored.provider === provider, deleted, lastError: lastStorageError() });
    } catch (e) {
      return Response.json({ provider, ok: false, error: e instanceof Error ? e.message : "Хранилище недоступно", lastError: lastStorageError() }, { status: 503 });
    }
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

  let classifieds: { published: number; byStatus: Record<string, number> } | { error: string };
  try {
    if (!database.ok) {
      classifieds = { published: 0, byStatus: {} };
    } else {
      const groups = await prisma.classified.groupBy({ by: ["status"], _count: { _all: true } });
      const byStatus: Record<string, number> = {};
      for (const g of groups) byStatus[g.status] = g._count._all;
      classifieds = { published: byStatus.PUBLISHED ?? 0, byStatus };
    }
  } catch (e) {
    classifieds = { error: e instanceof Error ? e.message.slice(0, 200) : "unavailable" };
  }

  // Планировщик: без ключа фоновые задачи (автоотмена, напоминания, выплаты) не запускаются.
  let lastRunAt: string | null = null;
  if (database.ok) {
    const last = await prisma.auditLog
      .findFirst({ where: { action: "jobs.run" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } })
      .catch(() => null);
    lastRunAt = last?.createdAt.toISOString() ?? null;
  }
  const scheduler = { status: env.cronSecret ? "READY" : "NOT_CONFIGURED", lastRunAt };

  // Readiness: every hard dependency must be healthy.
  const ready = database.ok;
  return Response.json(
    {
      status: ready ? "ready" : "unready",
      time: new Date().toISOString(),
      ai: aiMode(),
      database,
      storage: getStorageProvider().key,
      integrations: integrationStatus,
      telegram: telegramDiagnostics(),
      scheduler,
      classifieds,
    },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
});
