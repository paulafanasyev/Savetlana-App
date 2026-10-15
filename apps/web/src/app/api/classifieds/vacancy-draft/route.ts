import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { consumeRateLimit, tooMany } from "@/lib/domains/rate-limits";
import { draftVacancy, MAX_DRAFT_INPUT } from "@/lib/domains/vacancy-draft";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/classifieds/vacancy-draft
 * Body: { text } — описание вакансии своими словами. Возвращает черновик полей
 * формы. Ничего не публикует: работодатель проверяет и отправляет сам.
 */
export const POST = apiRoute(async (request) => {
  const { user } = await requireUser(request);
  const decision = await consumeRateLimit(`vacancy-draft:${user.id}`, 20, 60 * 60_000);
  if (!decision.allowed) return tooMany(decision);
  const body = await jsonBody<{ text?: unknown }>(request);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length < 15) {
    return Response.json({ error: "Опишите вакансию подробнее: кого ищете, сколько платите, какой график.", code: "too_short" }, { status: 400 });
  }
  if (text.length > MAX_DRAFT_INPUT) {
    return Response.json({ error: `Слишком длинно, сократите до ${MAX_DRAFT_INPUT} символов.`, code: "too_long" }, { status: 400 });
  }
  return Response.json(await draftVacancy(text));
});
