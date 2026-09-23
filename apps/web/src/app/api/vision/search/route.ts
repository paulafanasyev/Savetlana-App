import { apiRoute, rateLimit, tooManyRequests } from "@/lib/api-helpers";
import { requireBuyer } from "@/lib/auth";
import { searchByPhoto } from "@/lib/domains/vision";

export const dynamic = "force-dynamic";

/**
 * Photo search (spec §6, §10). Accepts a multipart image upload, validates it,
 * and runs the photo-to-product pipeline. The response always carries an
 * honest status: VERIFIED / MOCK_VERIFIED / NOT_PROVEN.
 */
export const POST = apiRoute(async (request) => {
  if (!rateLimit("vision:search", 10, 60_000)) return tooManyRequests();
  await requireBuyer(request);

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    return Response.json(
      { error: "Ожидается multipart-запрос с фотографией.", code: "bad_content_type" },
      { status: 400 },
    );
  }

  const form = await request.formData();
  const file = form.get("photo");
  if (!(file instanceof File)) {
    return Response.json(
      { error: "Фотография не найдена в запросе.", code: "no_photo" },
      { status: 400 },
    );
  }

  // Upload validation (spec §81): type allowlist + size cap.
  const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!ALLOWED.includes(file.type)) {
    return Response.json(
      { error: `Неподдерживаемый формат: ${file.type}. Допустимы JPEG, PNG, WebP, GIF.`, code: "bad_image_type" },
      { status: 400 },
    );
  }
  const MAX_BYTES = 10 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: "Фотография слишком большая (максимум 10 МБ).", code: "image_too_large" },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await searchByPhoto(buffer, file.type);
  return Response.json(result);
});
