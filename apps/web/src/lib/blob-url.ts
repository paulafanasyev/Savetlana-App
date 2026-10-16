/**
 * Мелкие правила для Vercel Blob без самого пакета: store id из токена и проверка,
 * что ссылка ведёт в публичное хранилище Vercel, а не куда-то ещё.
 */

/** Токен вида vercel_blob_rw_<storeId>_<secret>: store id нужен в заголовке запроса. */
export function blobStoreId(token: string | undefined): string {
  return token?.split("_")[3] ?? "";
}

/** Публичная ссылка Vercel Blob: https://<store>.public.blob.vercel-storage.com/… */
export function isPublicBlobUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 1000) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /^[A-Za-z0-9]+\.public\.blob\.vercel-storage\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}
