import { apiRoute, jsonBody, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import { addPortfolioItem, loadPortfolio, removePortfolioItem, updatePortfolioProfile } from "@/lib/domains/portfolio";
import { UserFacingError } from "@/lib/domains/engagement-rules";

export const dynamic = "force-dynamic";

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof UserFacingError) throw new ApiError(e.status, e.message);
    throw e;
  }
}

/** Моё портфолио. */
export const GET = apiRoute(async (request) => {
  const { user } = await requireUser(request);
  return Response.json({ portfolio: await loadPortfolio(user.id) });
});

/** «О себе» и навыки. */
export const PUT = apiRoute(async (request) => {
  const { user } = await requireUser(request);
  if (!rateLimit(`portfolio:${user.id}`, 30, 60_000)) return tooManyRequests();
  const body = await jsonBody<{ about?: unknown; skills?: unknown }>(request).catch(() => ({} as { about?: unknown; skills?: unknown }));
  return Response.json({ portfolio: await run(() => updatePortfolioProfile(user.id, body)) });
});

/** Добавить работу (фото уже загружено в свою папку портфолио). */
export const POST = apiRoute(async (request) => {
  const { user } = await requireUser(request);
  if (!rateLimit(`portfolio:${user.id}`, 30, 60_000)) return tooManyRequests();
  const body = await jsonBody<{ title?: unknown; description?: unknown; imageUrl?: unknown }>(request).catch(() => ({} as { title?: unknown }));
  return Response.json({ portfolio: await run(() => addPortfolioItem(user.id, body)) }, { status: 201 });
});

/** Убрать работу: ?id=… */
export const DELETE = apiRoute(async (request) => {
  const { user } = await requireUser(request);
  if (!rateLimit(`portfolio:${user.id}`, 30, 60_000)) return tooManyRequests();
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[a-z0-9]{6,32}$/.test(id)) throw new ApiError(400, "Не указана работа");
  return Response.json({ portfolio: await run(() => removePortfolioItem(user.id, id)) });
});
