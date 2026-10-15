import { apiRoute, jsonBody } from "@/lib/api-helpers";
import { requireUser } from "@/lib/auth";
import { consumeRateLimit, tooMany } from "@/lib/domains/rate-limits";
import { draftResume, MAX_RESUME_INPUT } from "@/lib/domains/resume-draft";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/classifieds/resume-draft
 * Body: { text } — о себе своими словами. Возвращает черновик полей формы
 * резюме. Ничего не публикует: соискатель проверяет и отправляет сам.
 */
export const POST = apiRoute(async (request) => {
  const { user } = await requireUser(request);
  const decision = await consumeRateLimit(`resume-draft:${user.id}`, 20, 60 * 60_000);
  if (!decision.allowed) return tooMany(decision);
  const body = await jsonBody<{ text?: unknown }>(request);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length < 15) {
    return Response.json({ error: "Расскажите подробнее: кем хотите работать, какой у вас опыт, какую зарплату и график хотите.", code: "too_short" }, { status: 400 });
  }
  if (text.length > MAX_RESUME_INPUT) {
    return Response.json({ error: `Слишком длинно, сократите до ${MAX_RESUME_INPUT} символов.`, code: "too_long" }, { status: 400 });
  }
  return Response.json(await draftResume(text));
});
