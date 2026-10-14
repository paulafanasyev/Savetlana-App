import { apiRoute } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import { createClassified, searchClassifieds } from "@/lib/domains/classifieds";
import { UserFacingError } from "@/lib/domains/engagement-rules";
import { explainClassified } from "@/lib/domains/classified-guard";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Public search across real estate / auto / services. Geo filters are
// first-class so a buyer always sees ads they can actually act on.
export const GET = apiRoute(async (request) => {
  const url = new URL(request.url);
  const toNum = (v: string | null): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  const result = await searchClassifieds({
    vertical: url.searchParams.get("vertical") ?? undefined,
    dealType: url.searchParams.get("dealType") ?? undefined,
    regionId: url.searchParams.get("regionId") ?? undefined,
    cityId: url.searchParams.get("cityId") ?? undefined,
    metroId: url.searchParams.get("metroId") ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
    priceMin: toNum(url.searchParams.get("priceMin")),
    priceMax: toNum(url.searchParams.get("priceMax")),
    query: url.searchParams.get("q") ?? undefined,
    limit: toNum(url.searchParams.get("limit")) ?? 20,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });

  return Response.json(result);
});

// Create a classified ad. Authenticated; author owns the ad. Geo is resolved
// server-side from the seeded tree, so free-text locations are never stored.
// Accepts both JSON and HTML form-encoded bodies (the UI posts a plain form).
// Антифрод: опасное объявление отклоняется с причиной, подозрительное уходит
// на проверку модератору (статус MODERATION, в поиске не видно).
export const POST = apiRoute(async (request) => {
  const ctx = await requireUser(request);

  const contentType = request.headers.get("content-type") ?? "";
  let body: Record<string, unknown>;
  if (contentType.includes("application/json")) {
    body = (await request.json()) as Record<string, unknown>;
  } else {
    const form = await request.formData();
    body = Object.fromEntries(form.entries());
  }
  const isForm = !contentType.includes("application/json");

  let created: Awaited<ReturnType<typeof createClassified>>;
  try {
    created = await createClassified(
      ctx.user.id,
      {
        vertical: String(body.vertical ?? ""),
        dealType: String(body.dealType ?? ""),
        title: String(body.title ?? ""),
        description: body.description ? String(body.description) : undefined,
        category: String(body.category ?? ""),
        priceKopecks: body.priceRub ? Math.round(Number(body.priceRub) * 100) : undefined,
        cityId: String(body.cityId ?? ""),
        districtName: body.districtName ? String(body.districtName) : undefined,
        addressLine: body.addressLine ? String(body.addressLine) : undefined,
      },
      { actorRole: ctx.user.role }
    );
  } catch (error) {
    if (!(error instanceof UserFacingError)) throw error;
    if (isForm) redirect(`/classifieds/new?error=${encodeURIComponent(error.message)}`);
    throw new ApiError(error.status, error.message);
  }

  const onModeration = created.status === "MODERATION";
  // HTML form posts redirect to the new ad; JSON API clients get the id.
  if (isForm) {
    redirect(onModeration ? "/classifieds/new?sent=moderation" : `/classifieds/${created.id}`);
  }
  return Response.json(
    {
      id: created.id,
      status: created.status,
      ...(onModeration ? { moderation: explainClassified(created.screening) } : {}),
    },
    { status: 201 }
  );
});
