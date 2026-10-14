/**
 * Копирование фото перенесённых товаров к нам в хранилище.
 *
 * При переносе с Маркета, Ozon или WB фото приходят ссылками на чужой сайт.
 * Если тот сайт закроет доступ или удалит картинку, карточка останется без
 * фото. Поэтому после переноса скачиваем каждую картинку и кладём её туда же,
 * куда продавец загружает фото сам (storeUpload: проверка типа и размера).
 *
 * Безопасность: сервер ходит по ссылкам, которые прислал продавец, значит
 * ссылкой можно попытаться заставить его обратиться к внутренней сети. Поэтому:
 *  - только https и стандартный порт, без логина и пароля в ссылке;
 *  - имя сайта проверяем через DNS: все адреса должны быть публичными
 *    (не 10.x, 192.168.x, 127.x, 169.254.x и т. п.), так же после каждого
 *    перенаправления (не больше трёх);
 *  - не больше 2 МБ (как у фото, загруженных вручную), только PNG, JPEG, WebP,
 *    ждём не дольше 8 секунд.
 * Ограничение: между нашей проверкой DNS и самим скачиванием адрес теоретически
 * может смениться. Ответ при этом всё равно проходит проверку типа картинки и
 * в базу попадает только как файл фото, а не как ответ внутреннего сервиса.
 *
 * Не скачалось: ссылка остаётся как была, товар не ломается.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { prisma } from "../prisma";
import { storeUpload } from "../storage";
import { audit } from "./audit";

export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
/** Сколько фото за один запрос: укладываемся во время работы функции на хостинге. */
export const PHOTO_BATCH = 8;
const BATCH_DEADLINE_MS = 20_000;

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

/** Публичный ли адрес: в локальные, служебные и частные сети не ходим. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const p = ipv4Parts(ip);
    if (!p) return false;
    const [a, b, c] = p;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    if (a >= 224) return false; // многоадресные и зарезервированные
    return true;
  }
  if (kind === 6) {
    const v6 = ip.toLowerCase();
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]);
    if (v6 === "::" || v6 === "::1") return false;
    if (/^f[cd]/.test(v6)) return false; // fc00::/7
    if (/^fe[89ab]/.test(v6)) return false; // fe80::/10
    if (v6.startsWith("ff")) return false;
    if (v6.startsWith("64:ff9b:")) return false;
    if (v6.startsWith("2001:db8:") || v6.startsWith("2001:0db8:")) return false;
    if (v6.startsWith("::")) return false; // прочие совместимые с IPv4 формы
    return true;
  }
  return false;
}

/** Проверка ссылки без сети: схема, порт, логин в ссылке, явно внутренние имена. */
export function checkPhotoUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "ссылка не похожа на адрес" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "только https" };
  if (url.username || url.password) return { ok: false, reason: "в ссылке логин или пароль" };
  if (url.port && url.port !== "443") return { ok: false, reason: "нестандартный порт" };
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || /\.(local|localhost|internal|lan|home)$/.test(host)) return { ok: false, reason: "внутренний адрес" };
  if (isIP(host) && !isPublicAddress(host)) return { ok: false, reason: "внутренний адрес" };
  return { ok: true, url };
}

/** Наши собственные ссылки на фото: их копировать не нужно. */
export function isOwnPhotoUrl(url: string): boolean {
  if (url.startsWith("/")) return true;
  try {
    return /(^|\.)blob\.vercel-storage\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export type Lookup = (host: string) => Promise<string[]>;
const defaultLookup: Lookup = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

async function readLimited(res: Response, max: number): Promise<Buffer | null> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) return null;
  if (!res.body) return Buffer.from(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export type FetchedPhoto = { ok: true; bytes: Buffer } | { ok: false; reason: string };

/** Скачивает картинку по проверенной ссылке. Каждый шаг перенаправления проверяется заново. */
export async function fetchRemotePhoto(raw: string, deps: { fetchImpl?: typeof fetch; lookup?: Lookup } = {}): Promise<FetchedPhoto> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const lookup = deps.lookup ?? defaultLookup;
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = checkPhotoUrl(current);
    if (!checked.ok) return checked;
    const host = checked.url.hostname.replace(/^\[|\]$/g, "");
    let addresses: string[];
    try {
      addresses = isIP(host) ? [host] : await lookup(host);
    } catch {
      return { ok: false, reason: "сайт с фото не найден" };
    }
    if (addresses.length === 0 || !addresses.every(isPublicAddress)) return { ok: false, reason: "внутренний адрес" };
    let res: Response;
    try {
      res = await fetchImpl(checked.url.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: "image/png,image/jpeg,image/webp,image/*;q=0.8" },
      });
    } catch {
      return { ok: false, reason: "сайт с фото не ответил" };
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return { ok: false, reason: "перенаправление без адреса" };
      current = new URL(location, checked.url).toString();
      continue;
    }
    if (!res.ok) return { ok: false, reason: `сайт с фото ответил ошибкой ${res.status}` };
    const bytes = await readLimited(res, PHOTO_MAX_BYTES).catch(() => null);
    if (!bytes) return { ok: false, reason: "фото больше 2 МБ или оборвалось" };
    if (bytes.length === 0) return { ok: false, reason: "пустой файл" };
    return { ok: true, bytes };
  }
  return { ok: false, reason: "слишком много перенаправлений" };
}

export interface CopyDeps {
  fetchPhoto?: (url: string) => Promise<FetchedPhoto>;
  store?: (productId: string, bytes: Buffer) => Promise<string>;
  now?: () => number;
}

export interface CopyOutcome {
  copied: number;
  failed: number;
  failures: { url: string; reason: string }[];
  /** С какого фото продолжить; null, если всё пройдено. */
  nextCursor: string | null;
  remaining: number;
}

const defaultStore = async (productId: string, bytes: Buffer): Promise<string> => {
  const stored = await storeUpload({ bucket: `public/products/${productId}`, filename: `${Date.now()}-import`, bytes, storageClass: "public" });
  return stored.url;
};

function pendingWhere(sellerId: string, after: string | null) {
  return {
    url: { startsWith: "https://" },
    NOT: { url: { contains: "blob.vercel-storage.com" } },
    product: { sellerId, aiGeneratedFrom: "catalog-import" },
    ...(after ? { id: { gt: after } } : {}),
  };
}

/**
 * Одна порция копирования. Идём по фото по порядку id с курсора: не скачавшиеся
 * фото остаются ссылками и при следующем вызове не повторяются.
 */
export async function copyImportedPhotos(input: { sellerId: string; actorId: string; after?: string | null }, deps: CopyDeps = {}): Promise<CopyOutcome> {
  const fetchPhoto = deps.fetchPhoto ?? ((url: string) => fetchRemotePhoto(url));
  const store = deps.store ?? defaultStore;
  const now = deps.now ?? Date.now;
  const started = now();
  const after = input.after ?? null;
  const batch = await prisma.productImage.findMany({
    where: pendingWhere(input.sellerId, after),
    orderBy: { id: "asc" },
    take: PHOTO_BATCH,
    select: { id: true, url: true, productId: true },
  });
  let copied = 0;
  const failures: CopyOutcome["failures"] = [];
  let lastId: string | null = after;
  // Одна и та же картинка у нескольких товаров скачивается один раз за порцию.
  const fetched = new Map<string, FetchedPhoto>();
  for (const image of batch) {
    if (now() - started > BATCH_DEADLINE_MS) break;
    lastId = image.id;
    if (isOwnPhotoUrl(image.url)) continue;
    let photo = fetched.get(image.url);
    if (!photo) {
      photo = await fetchPhoto(image.url).catch((): FetchedPhoto => ({ ok: false, reason: "не удалось скачать" }));
      fetched.set(image.url, photo);
    }
    if (!photo.ok) {
      failures.push({ url: image.url, reason: photo.reason });
      continue;
    }
    try {
      const url = await store(image.productId, photo.bytes);
      await prisma.productImage.update({ where: { id: image.id }, data: { url } });
      copied += 1;
    } catch (e) {
      failures.push({ url: image.url, reason: e instanceof Error ? e.message : "не удалось сохранить" });
    }
  }
  const remaining = lastId === null ? 0 : await prisma.productImage.count({ where: pendingWhere(input.sellerId, lastId) });
  if (copied > 0 || failures.length > 0) {
    await audit({
      actorId: input.actorId,
      actorRole: "seller",
      action: "catalog.import_photos",
      targetType: "seller",
      targetId: input.sellerId,
      after: { copied, failed: failures.length },
    });
  }
  return {
    copied,
    failed: failures.length,
    failures,
    nextCursor: batch.length === 0 || remaining === 0 ? null : lastId,
    remaining,
  };
}
