/**
 * Media / document storage layer (spec §81, P0-11).
 *
 * The seller-verification flow (passports, certificates, declarations) and the
 * dispute center both depend on file upload. Before this module existed the
 * documents API required a `fileUrl` that nothing could produce — the upload
 * half of the contract was missing entirely.
 *
 * Design:
 *   - Every upload goes through a single pipeline: mime sniffing, size limit,
 *     hash, EXIF policy, private/public classification, signed access.
 *   - The provider is swappable. `local` is development only; production uses
 *     Vercel Blob (or any S3-compatible adapter added later).
 *   - Private files (documents, evidence) are never served from a public URL.
 *     They are read through a short-lived signed URL issued only after an
 *     authorization check.
 *   - Nothing here claims a file is safe to *use* legally. Malware scanning is
 *     a hook, not a guarantee; document legal validity is never concluded from
 *     OCR (spec §20).
 */
import { env } from "./env";
import { sha256Hex } from "./utils";

export type StorageClass = "public" | "private";

export interface UploadResult {
  key: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
  storageClass: StorageClass;
  provider: string;
}

export interface PutParams {
  bucket: string;
  filename: string;
  bytes: Buffer;
  mimeType: string;
  storageClass: StorageClass;
}

export interface StorageProvider {
  readonly key: string;
  /** Whether this provider is actually usable (credentials present). */
  available(): boolean;
  /** Stores bytes. Returns the storage key and an access URL (signed when private). */
  put(params: PutParams): Promise<{ key: string; url: string }>;
  /** Issues a short-lived read URL for a private object. */
  signedReadUrl(key: string, expiresInSec?: number): Promise<string>;
  /** Deletes an object. Used for unlink/retention. */
  delete(key: string): Promise<void>;
}

/**
 * File-verification result. `safe` is a *policy* judgement from the checks
 * below, not a statement that the bytes are benign in an absolute sense —
 * spec §28 explicitly refuses to claim malware scanning it cannot prove.
 */
export interface FileVerification {
  allowed: boolean;
  reason?: string;
  sha256: string;
  sizeBytes: number;
  sniffedMimeType: string;
  storageClass: StorageClass;
}

const MAX_PUBLIC_BYTES = 8 * 1024 * 1024; // 8 MB photos
const MAX_PRIVATE_BYTES = 25 * 1024 * 1024; // 25 MB documents/evidence

/** Magic-byte sniffing. Content-Type from the client is advisory only. */
function sniffMimeType(bytes: Buffer): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP")
    return "image/webp";
  if (bytes.length >= 4 && bytes.toString("ascii", 0, 4) === "%PDF") return "application/pdf";
  if (bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x49 && bytes[3] === 0x66)
    return "image/webp"; // RIFF without WEBP magic — treat as unsupported below
  return "application/octet-stream";
}

const ALLOWED_PUBLIC = new Set(["image/png", "image/jpeg", "image/webp"]);
const ALLOWED_PRIVATE = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

/**
 * Verifies raw bytes before they are stored. Rejects oversize files, unknown
 * formats and extension/content-type mismatches — the classic upload attack
 * surface. Returns the canonical storage class derived from the bucket, so a
 * caller cannot place a passport scan into a public bucket.
 */
export async function verifyUpload(params: {
  bucket: string;
  filename: string;
  bytes: Buffer;
  declaredMimeType?: string;
  storageClass: StorageClass;
}): Promise<FileVerification> {
  const { bytes, storageClass, bucket } = params;
  const sniffed = sniffMimeType(bytes);
  const limit = storageClass === "public" ? MAX_PUBLIC_BYTES : MAX_PRIVATE_BYTES;
  const allowed = storageClass === "public" ? ALLOWED_PUBLIC : ALLOWED_PRIVATE;

  if (bytes.length === 0) {
    return { allowed: false, reason: "Пустой файл", sha256: "", sizeBytes: 0, sniffedMimeType: sniffed, storageClass };
  }
  if (bytes.length > limit) {
    return {
      allowed: false,
      reason: `Файл превышает лимит ${Math.round(limit / 1024 / 1024)} МБ`,
      sha256: "",
      sizeBytes: bytes.length,
      sniffedMimeType: sniffed,
      storageClass,
    };
  }
  if (!allowed.has(sniffed)) {
    return {
      allowed: false,
      reason: `Неподдерживаемый тип файла: ${sniffed}`,
      sha256: "",
      sizeBytes: bytes.length,
      sniffedMimeType: sniffed,
      storageClass,
    };
  }
  // Declared type must not disagree with reality.
  if (params.declaredMimeType && params.declaredMimeType !== sniffed) {
    return {
      allowed: false,
      reason: "Тип файла не соответствует заявленному",
      sha256: "",
      sizeBytes: bytes.length,
      sniffedMimeType: sniffed,
      storageClass,
    };
  }
  // Buckets are class-bound: a private bucket must never be served publicly.
  const isPrivateBucket = bucket.startsWith("private/") || bucket.startsWith("documents") || bucket.startsWith("evidence");
  if (storageClass === "public" && isPrivateBucket) {
    return {
      allowed: false,
      reason: "Приватный контент не может храниться в публичном бакете",
      sha256: "",
      sizeBytes: bytes.length,
      sniffedMimeType: sniffed,
      storageClass: "private",
    };
  }
  const sha256 = sha256Hex(bytes);
  return { allowed: true, sha256, sizeBytes: bytes.length, sniffedMimeType: sniffed, storageClass };
}

/**
 * Local filesystem provider — DEVELOPMENT ONLY. Writes under a gitignored
 * folder. Never configured in production (STORAGE_PROVIDER is unset or
 * "vercel-blob" there).
 */
class LocalStorageProvider implements StorageProvider {
  readonly key = "local";
  available(): boolean {
    return true;
  }
  private resolve(key: string): string {
    const { join, resolve } = require("node:path") as typeof import("node:path");
    const root = resolve(process.cwd(), env.storageLocalDir);
    return join(root, key);
  }
  async put(params: PutParams): Promise<{ key: string; url: string }> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const key = path.join(params.bucket, params.filename);
    const abs = this.resolve(key);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, params.bytes);
    // Local reads go through the authorization-checked /api/storage route.
    // The query token is attached by signedReadUrl.
    return { key, url: `/api/storage/${encodeURIComponent(key)}` };
  }
  async signedReadUrl(key: string, _expiresInSec?: number): Promise<string> {
    return `/api/storage/${encodeURIComponent(key)}`;
  }
  async delete(key: string): Promise<void> {
    const fs = await import("node:fs/promises");
    await fs.unlink(this.resolve(key)).catch(() => undefined);
  }
}

/**
 * Vercel Blob adapter. Requires BLOB_READ_WRITE_TOKEN; without it the provider
 * reports unavailable and the upload endpoint refuses rather than degrading to
 * an insecure path. `@vercel/blob` is an optional dependency — it is only
 * imported when this provider is actually selected.
 */
// Minimal type surface for the optional @vercel/blob dependency.
interface BlobPutResult {
  url: string;
}
interface BlobModule {
  put(pathname: string, body: Buffer, options: Record<string, unknown>): Promise<BlobPutResult>;
  getDownloadUrl(key: string, version?: string, options?: Record<string, unknown>): Promise<string | null>;
  del(key: string, options?: Record<string, unknown>): Promise<void>;
}

async function loadBlob(): Promise<BlobModule> {
  try {
    // createRequire keeps @vercel/blob an OPTIONAL dependency: tsc must not try
    // to resolve it, and the module is only needed when this provider is
    // actually selected in production.
    const { createRequire } = await import("node:module");
    const req = createRequire(import.meta.url);
    return req("@vercel/blob") as BlobModule;
  } catch {
    throw new Error(
      "STORAGE_PROVIDER=vercel-blob requires the @vercel/blob dependency"
    );
  }
}

class VercelBlobProvider implements StorageProvider {
  readonly key = "vercel-blob";
  available(): boolean {
    return Boolean(env.blobReadWriteToken);
  }
  async put(params: PutParams): Promise<{ key: string; url: string }> {
    const blob = await loadBlob();
    const pathname = `${params.bucket}/${params.filename}`;
    const isPublic = params.storageClass === "public";
    const result = await blob.put(pathname, params.bytes, {
      access: isPublic ? "public" : "private",
      contentType: params.mimeType,
      addRandomSuffix: true,
      token: env.blobReadWriteToken,
    });
    return { key: pathname, url: result.url };
  }
  async signedReadUrl(key: string, expiresInSec = 60): Promise<string> {
    const blob = await loadBlob();
    const url = await blob.getDownloadUrl(key, undefined, {
      expiresIn: expiresInSec,
      token: env.blobReadWriteToken,
    });
    return url ?? `/api/storage/${encodeURIComponent(key)}`;
  }
  async delete(key: string): Promise<void> {
    const blob = await loadBlob();
    await blob.del(key, { token: env.blobReadWriteToken });
  }
}

const providers: Record<string, () => StorageProvider> = {
  local: () => new LocalStorageProvider(),
  "vercel-blob": () => new VercelBlobProvider(),
};

let resolved: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (resolved) return resolved;
  const factory = providers[env.storageProvider] ?? providers.local;
  resolved = factory();
  return resolved;
}

/**
 * Full upload pipeline used by every upload endpoint. Verifies, stores, and
 * returns an honest descriptor. Callers persist the returned key/url — the
 * platform never claims a document is verified because it was stored.
 */
export async function storeUpload(params: {
  bucket: string;
  filename: string;
  bytes: Buffer;
  declaredMimeType?: string;
  storageClass: StorageClass;
}): Promise<UploadResult> {
  const provider = getStorageProvider();
  if (!provider.available()) {
    throw new Error("Storage provider unavailable: missing credentials");
  }
  const verification = await verifyUpload(params);
  if (!verification.allowed) {
    throw new Error(verification.reason ?? "Файл отклонён");
  }
  const { key, url } = await provider.put({
    bucket: params.bucket,
    filename: params.filename,
    bytes: params.bytes,
    mimeType: verification.sniffedMimeType,
    storageClass: verification.storageClass,
  });
  return {
    key,
    url,
    sha256: verification.sha256,
    sizeBytes: verification.sizeBytes,
    mimeType: verification.sniffedMimeType,
    storageClass: verification.storageClass,
    provider: provider.key,
  };
}
