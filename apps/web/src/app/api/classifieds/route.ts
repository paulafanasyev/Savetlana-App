import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireUser, ApiError } from "@/lib/auth";
import { createClassified, searchClassifieds } from "@/lib/domains/classifieds";
import { UserFacingError } from "@/lib/domains/engagement-rules";
import { explainClassified } from "@/lib/domains/classified-guard";
import { MAX_PHOTOS, MAX_PHOTOS_TOTAL_BYTES, parseAttrs } from "@/lib/classified-fields";
import { queryNumber } from "@/lib/query-number";
import { storeUpload } from "@/lib/storage";
import { sha256Hex } from "@/lib/utils";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Public search across real estate / auto / services / jobs. Geo filters are
// first-class so a buyer always sees ads they can actually act on.
// Пустой или отсутствующий числовой параметр означает «без фильтра», не ноль.
export const GET = apiRoute(async (request) => {
  const url = new URL(request.url);
  const p = url.searchParams;

  const result = await searchClassifieds({
    vertical: p.get("vertical") ?? undefined,
    dealType: p.get("dealType") ?? undefined,
    regionId: p.get("regionId") ?? undefined,
    cityId: p.get("cityId") && p.get("cityId") !== "all" ? p.get("cityId") ?? undefined : undefined,
    metroId: p.get("metroId") ?? undefined,
    category: p.get("category") ?? undefined,
    priceMin: queryNumber(p.get("priceMin")),
    priceMax: queryNumber(p.get("priceMax")),
    query: p.get("q") ?? undefined,
    limit: queryNumber(p.get("limit")) ?? 20,
    cursor: p.get("cursor") ?? undefined,
  });

  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
});

/** Коды ошибок домена объявлений, которые можно объяснить человеку. */
const CREATE_ERRORS: Record<string, string> = {
  unknown_classified_vertical: "Выберите раздел: недвижимость, авто, услуги или работа",
  unknown_deal_type: "Выберите тип сделки",
  title_too_short: "Заголовок должен быть не короче 5 символов",
  unknown_city: "Выберите город из списка",
};

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * Фото объявления сохраняются под именем из хэша содержимого: одинаковый
 * снимок у разных авторов даёт одинаковый хэш в адресе, и антифрод видит
 * чужие фотографии.
 */
async function storePhotos(files: File[]): Promise<string[]> {
  if (files.length > MAX_PHOTOS) throw new UserFacingError(`Можно добавить не больше ${MAX_PHOTOS} фото`);
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > MAX_PHOTOS_TOTAL_BYTES) throw new UserFacingError("Фото слишком тяжёлые для одной отправки, уберите часть");
  const urls: string[] = [];
  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const digest = sha256Hex(bytes);
    try {
      const stored = await storeUpload({
        bucket: "public/classifieds",
        filename: `${digest}.${EXT[file.type] ?? "jpg"}`,
        bytes,
        declaredMimeType: file.type || undefined,
        storageClass: "public",
      });
      urls.push(stored.url);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "файл отклонён";
      throw new UserFacingError(`Фото «${file.name.slice(0, 60)}» не подошло: ${reason}`);
    }
  }
  return urls;
}

// Create a classified ad. Authenticated; author owns the ad. Geo is resolved
// server-side from the seeded tree, so free-text locations are never stored.
// Accepts JSON, HTML form-encoded and multipart bodies (the form sends photos).
// Антифрод: опасное объявление отклоняется с причиной, подозрительное уходит
// на проверку модератору (статус MODERATION, в поиске не видно).
export const POST = apiRoute(async (request) => {
  const ctx = await requireUser(request);
  if (!rateLimit(`classifieds:create:${ctx.user.id}`, 10, 60 * 60_000)) return tooManyRequests();

  const contentType = request.headers.get("content-type") ?? "";
  const isJsonBody = contentType.includes("application/json");
  // Форма из браузера с JavaScript просит JSON; обычная HTML-форма ждёт переход.
  const wantsJson = isJsonBody || (request.headers.get("accept") ?? "").includes("application/json");

  let body: Record<string, unknown>;
  let files: File[] = [];
  let formAttrs: Record<string, string | number> | undefined;
  if (isJsonBody) {
    body = (await request.json()) as Record<string, unknown>;
  } else {
    const form = await request.formData();
    files = form.getAll("photos").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && (f as File).size > 0);
    body = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
    formAttrs = parseAttrs(String(body.vertical ?? ""), (name) => form.get(name));
  }

  let created: Awaited<ReturnType<typeof createClassified>>;
  try {
    const images = files.length ? await storePhotos(files) : undefined;
    const priceRub = Number(body.priceRub);
    created = await createClassified(
      ctx.user.id,
      {
        vertical: String(body.vertical ?? ""),
        dealType: String(body.dealType ?? ""),
        title: String(body.title ?? ""),
        description: body.description ? String(body.description).slice(0, 5000) : undefined,
        category: String(body.category ?? ""),
        priceKopecks: body.priceRub && Number.isFinite(priceRub) && priceRub >= 0 ? Math.round(priceRub * 100) : undefined,
        cityId: String(body.cityId ?? ""),
        districtName: body.districtName ? String(body.districtName) : undefined,
        addressLine: body.addressLine ? String(body.addressLine) : undefined,
        attrs: formAttrs ?? (body.attrs && typeof body.attrs === "object" ? (body.attrs as Record<string, unknown>) : undefined),
        images,
      },
      { actorRole: ctx.user.role }
    );
  } catch (error) {
    const known = error instanceof Error ? CREATE_ERRORS[error.message] : undefined;
    if (!(error instanceof UserFacingError) && !known) throw error;
    const message = error instanceof UserFacingError ? error.message : (known ?? "Проверьте данные");
    const status = error instanceof UserFacingError ? error.status : 400;
    if (!wantsJson) redirect(`/classifieds/new?error=${encodeURIComponent(message)}`);
    throw new ApiError(status, message);
  }

  const onModeration = created.status === "MODERATION";
  // HTML form posts redirect to the new ad; JSON API clients get the id.
  if (!wantsJson) {
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
