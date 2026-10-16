import { env } from "./env";
import { prisma } from "./prisma";
import { sha256Hex } from "./utils";
import { blobStoreId, isPublicBlobUrl } from "./blob-url";

export type StorageClass = "public" | "private";
export interface UploadResult { key: string; url: string; sha256: string; sizeBytes: number; mimeType: string; storageClass: StorageClass; provider: string; }
export interface PutParams { bucket: string; filename: string; bytes: Buffer; mimeType: string; storageClass: StorageClass; }
export interface StorageProvider {
  readonly key: string;
  available(): boolean;
  put(params: PutParams): Promise<{ key: string; url: string }>;
  signedReadUrl(key: string, expiresInSec?: number): Promise<string>;
  delete(key: string): Promise<void>;
}
export interface FileVerification { allowed: boolean; reason?: string; sha256: string; sizeBytes: number; sniffedMimeType: string; storageClass: StorageClass; }

const MAX_PUBLIC_BYTES = 8 * 1024 * 1024;
const MAX_PRODUCT_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_PRIVATE_BYTES = 25 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Определяет тип файла по содержимому, а не по расширению. */
export function sniffMimeType(bytes: Buffer): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 4 && bytes.toString("ascii", 0, 4) === "%PDF") return "application/pdf";
  return "application/octet-stream";
}

export async function verifyUpload(params: { bucket: string; filename: string; bytes: Buffer; declaredMimeType?: string; storageClass: StorageClass }): Promise<FileVerification> {
  const sniffedMimeType = sniffMimeType(params.bytes);
  // Фото товаров и работ в портфолио показываются всем: держим их лёгкими.
  const isProduct = params.bucket.startsWith("public/products/") || params.bucket.startsWith("public/portfolio/");
  const limit = isProduct ? MAX_PRODUCT_IMAGE_BYTES : params.storageClass === "public" ? MAX_PUBLIC_BYTES : MAX_PRIVATE_BYTES;
  const allowed = params.storageClass === "public" ? IMAGE_TYPES : new Set(["application/pdf", ...IMAGE_TYPES]);
  const fail = (reason: string): FileVerification => ({ allowed: false, reason, sha256: "", sizeBytes: params.bytes.length, sniffedMimeType, storageClass: params.storageClass });
  if (!params.bytes.length) return fail("Пустой файл");
  if (params.bytes.length > limit) return fail(`Файл превышает лимит ${Math.round(limit / 1024 / 1024)} МБ`);
  if (!allowed.has(sniffedMimeType)) return fail(`Неподдерживаемый тип файла: ${sniffedMimeType}`);
  if (params.declaredMimeType && params.declaredMimeType !== sniffedMimeType) return fail("Содержимое файла не соответствует заявленному типу");
  if (params.storageClass === "public" && !isProduct && /^(private|documents|evidence)(\/|$)/.test(params.bucket)) return { ...fail("Приватный контент не может быть публичным"), storageClass: "private" };
  return { allowed: true, sha256: sha256Hex(params.bytes), sizeBytes: params.bytes.length, sniffedMimeType, storageClass: params.storageClass };
}

function storagePath(key: string): string {
  return `/api/storage/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Хранит файлы в базе (IntegrationLink.secretBlob). Используется, когда нет токена
 * Vercel Blob, для приватных файлов и как запасной вариант, если Blob не принял файл.
 * Ключ: database/<bucket>/<sha256>; bucket начинается с public/, private/, documents/ или evidence/.
 */
class DatabaseStorageProvider implements StorageProvider {
  readonly key = "database";
  available(): boolean { return true; }
  async put(params: PutParams): Promise<{ key: string; url: string }> {
    const digest = sha256Hex(params.bytes);
    const key = `database/${params.bucket}/${digest}`;
    const secretBlob = JSON.stringify({ mimeType: params.mimeType, bytes: params.bytes.toString("base64") });
    await prisma.integrationLink.upsert({
      where: { provider_externalId: { provider: "database-storage", externalId: key } },
      create: { provider: "database-storage", externalId: key, secretBlob, externalScope: "[]", status: "ACTIVE" },
      update: { secretBlob, status: "ACTIVE", unlinkedAt: null },
    });
    return { key, url: storagePath(key) };
  }
  async signedReadUrl(key: string): Promise<string> { return storagePath(key); }
  async delete(key: string): Promise<void> {
    await prisma.integrationLink.updateMany({ where: { provider: "database-storage", externalId: key }, data: { unlinkedAt: new Date(), status: "REVOKED" } });
  }
}

class LocalStorageProvider implements StorageProvider {
  readonly key = "local";
  available(): boolean { return true; }
  private resolve(key: string): string {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require("node:path") as typeof import("node:path");
    return path.join(path.resolve(process.cwd(), env.storageLocalDir), key);
  }
  async put(params: PutParams): Promise<{ key: string; url: string }> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const key = path.join(params.bucket, params.filename);
    const abs = this.resolve(key);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, params.bytes);
    return { key, url: storagePath(key) };
  }
  async signedReadUrl(key: string): Promise<string> { return storagePath(key); }
  async delete(key: string): Promise<void> {
    const fs = await import("node:fs/promises");
    await fs.unlink(this.resolve(key)).catch(() => undefined);
  }
}

// Протокол Vercel Blob (как в их SDK): PUT /?pathname=… и POST /delete. Своим кодом, без пакета.
const BLOB_API_URL = "https://vercel.com/api/blob";
const BLOB_API_VERSION = "13";
const BLOB_TIMEOUT_MS = 20_000;

/**
 * Публичные фото (товары, объявления, портфолио) идут в Vercel Blob и отдаются с их CDN.
 * Приватные файлы (документы продавца, доказательства в споре) остаются в базе: их
 * выдаёт наш сервер только после проверки прав. Если Blob ответил ошибкой, фото
 * сохраняется в базу, и загрузка у человека не ломается.
 */
class VercelBlobProvider implements StorageProvider {
  readonly key = "vercel-blob";
  private readonly database = new DatabaseStorageProvider();
  available(): boolean { return Boolean(env.blobReadWriteToken); }

  private async request(path: string, method: string, headers: Record<string, string>, body: BodyInit): Promise<Response> {
    const token = env.blobReadWriteToken ?? "";
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${BLOB_API_URL}${path}`, {
          method,
          body,
          headers: {
            authorization: `Bearer ${token}`,
            "x-api-version": BLOB_API_VERSION,
            "x-vercel-blob-store-id": blobStoreId(token),
            "x-api-blob-request-attempt": String(attempt),
            ...headers,
          },
          signal: AbortSignal.timeout(BLOB_TIMEOUT_MS),
        });
        if (res.status < 500) return res;
        lastError = new Error(`Vercel Blob ответил ${res.status}`);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Vercel Blob недоступен");
  }

  async put(params: PutParams): Promise<{ key: string; url: string }> {
    if (params.storageClass !== "public") return this.database.put(params);
    const pathname = `${params.bucket}/${params.filename}`;
    try {
      const res = await this.request(
        `/?${new URLSearchParams({ pathname }).toString()}`,
        "PUT",
        { "x-vercel-blob-access": "public", "x-content-type": params.mimeType, "x-add-random-suffix": "1" },
        new Uint8Array(params.bytes),
      );
      const json = (await res.json().catch(() => ({}))) as { url?: unknown; error?: { message?: string } };
      if (!res.ok || !isPublicBlobUrl(json.url)) throw new Error(json.error?.message ?? `Vercel Blob ответил ${res.status}`);
      return { key: json.url, url: json.url };
    } catch (error) {
      console.warn("[storage] Vercel Blob не принял файл, сохраняем в базу:", error instanceof Error ? error.message : error);
      return this.database.put(params);
    }
  }

  async signedReadUrl(key: string): Promise<string> {
    if (isPublicBlobUrl(key)) return key;
    return storagePath(key);
  }

  async delete(key: string): Promise<void> {
    if (!isPublicBlobUrl(key)) return this.database.delete(key);
    const res = await this.request("/delete", "POST", { "content-type": "application/json" }, JSON.stringify({ urls: [key] }));
    if (!res.ok) throw new Error(`Vercel Blob не удалил файл: ${res.status}`);
  }
}

let resolved: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (resolved) return resolved;
  if (env.storageProvider === "database" || (env.storageProvider === "vercel-blob" && !env.blobReadWriteToken)) resolved = new DatabaseStorageProvider();
  else if (env.storageProvider === "local") resolved = new LocalStorageProvider();
  else resolved = new VercelBlobProvider();
  return resolved;
}

export async function readDatabaseObject(key: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const row = await prisma.integrationLink.findFirst({ where: { provider: "database-storage", externalId: key, status: "ACTIVE", unlinkedAt: null }, select: { secretBlob: true } });
  if (!row?.secretBlob) return null;
  try {
    const value = JSON.parse(row.secretBlob) as { bytes?: string; mimeType?: string };
    if (!value.bytes || !value.mimeType) return null;
    return { bytes: Buffer.from(value.bytes, "base64"), mimeType: value.mimeType };
  } catch {
    return null;
  }
}

export async function storeUpload(params: { bucket: string; filename: string; bytes: Buffer; declaredMimeType?: string; storageClass: StorageClass }): Promise<UploadResult> {
  const verification = await verifyUpload(params);
  if (!verification.allowed) throw new Error(verification.reason ?? "Файл отклонён");
  const provider = getStorageProvider();
  if (!provider.available()) throw new Error("Хранилище недоступно: нет ключа доступа");
  const result = await provider.put({ bucket: params.bucket, filename: params.filename, bytes: params.bytes, mimeType: verification.sniffedMimeType, storageClass: verification.storageClass });
  const provenance = result.key.startsWith("database/") ? "database" : provider.key;
  return { ...result, sha256: verification.sha256, sizeBytes: verification.sizeBytes, mimeType: verification.sniffedMimeType, storageClass: verification.storageClass, provider: provenance };
}
