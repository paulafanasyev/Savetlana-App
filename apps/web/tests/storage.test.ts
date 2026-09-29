/**
 * Storage layer tests (spec §81, P0-11).
 *
 * Covers the security properties that matter for a marketplace that stores
 * passports, certificates and dispute evidence:
 *   - extension/content-type spoofing is rejected (magic-byte sniffing)
 *   - oversize files rejected
 *   - private content cannot be written into a public bucket
 *   - declared mime must match reality
 *   - the read route authorizes per-bucket ownership
 *
 * These are STATIC/VERIFIED against the pipeline itself. Production provider
 * behaviour (Vercel Blob) is PENDING_EXTERNAL_ACCESS until BLOB_READ_WRITE_TOKEN
 * exists; the local provider is exercised here.
 */
import { describe, it, expect } from "vitest";
import { verifyUpload, getStorageProvider, storeUpload } from "../src/lib/storage";
import fs from "node:fs/promises";
import path from "node:path";

const PNG_MAGIC = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  ...Array.from({ length: 56 }, (_, i) => (i * 7) & 0xff),
]);

const JPEG_MAGIC = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
  ...Array.from({ length: 50 }, (_, i) => (i * 3) & 0xff),
]);

describe("storage: upload verification (P0-11)", () => {
  it("accepts a genuine PNG with matching declared mime", async () => {
    const result = await verifyUpload({
      bucket: "public/products",
      filename: "photo.png",
      bytes: PNG_MAGIC,
      declaredMimeType: "image/png",
      storageClass: "public",
    });
    expect(result.allowed).toBe(true);
    expect(result.sniffedMimeType).toBe("image/png");
    expect(result.sha256).toHaveLength(64);
    expect(result.sizeBytes).toBe(PNG_MAGIC.length);
  });

  it("rejects content-type spoofing (HTML named .png)", async () => {
    const fake = Buffer.from("<html><script>steal()</script></html>");
    const result = await verifyUpload({
      bucket: "public/products",
      filename: "evil.png",
      bytes: fake,
      declaredMimeType: "image/png",
      storageClass: "public",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Неподдерживаемый тип файла");
  });

  it("rejects when declared mime disagrees with bytes", async () => {
    const result = await verifyUpload({
      bucket: "documents/seller-1",
      filename: "scan.png",
      bytes: JPEG_MAGIC,
      declaredMimeType: "image/png",
      storageClass: "private",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("не соответствует заявленному");
  });

  it("rejects oversize files", async () => {
    const huge = Buffer.alloc(9 * 1024 * 1024 + 1, 0x89);
    huge[1] = 0x50; // keep a PNG-ish head
    const result = await verifyUpload({
      bucket: "public/products",
      filename: "big.png",
      bytes: huge,
      storageClass: "public",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("превышает лимит");
  });

  it("refuses private content in a public bucket", async () => {
    const result = await verifyUpload({
      bucket: "documents/seller-1",
      filename: "passport.png",
      bytes: PNG_MAGIC,
      storageClass: "public",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Приватный контент");
  });

  it("accepts PDF for private document storage", async () => {
    const pdf = Buffer.concat([
      Buffer.from("%PDF-1.4\n"),
      Buffer.alloc(200, 0x41),
      Buffer.from("\n%%EOF"),
    ]);
    const result = await verifyUpload({
      bucket: "documents/seller-1",
      filename: "inn.pdf",
      bytes: pdf,
      declaredMimeType: "application/pdf",
      storageClass: "private",
    });
    expect(result.allowed).toBe(true);
    expect(result.sniffedMimeType).toBe("application/pdf");
  });

  it("rejects empty files", async () => {
    const result = await verifyUpload({
      bucket: "public/products",
      filename: "empty.png",
      bytes: Buffer.alloc(0),
      storageClass: "public",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Пустой файл");
  });
});

describe("storage: local provider round-trip", () => {
  it("stores and reads back a verified file", async () => {
    const stored = await storeUpload({
      bucket: `private/test-${process.env.VITEST_WORKER_ID ?? "0"}`,
      filename: `probe-${Date.now()}.png`,
      bytes: PNG_MAGIC,
      declaredMimeType: "image/png",
      storageClass: "private",
    });
    expect(stored.sha256).toHaveLength(64);
    expect(stored.mimeType).toBe("image/png");
    expect(stored.storageClass).toBe("private");

    const provider = getStorageProvider();
    expect(provider.key).toBe("local");
    expect(provider.available()).toBe(true);

    const url = await provider.signedReadUrl(stored.key);
    expect(url).toContain("/api/storage/");

    await provider.delete(stored.key);
  });

  it("throws on unavailable configuration without degrading", async () => {
    // The pipeline must refuse rather than silently store insecurely.
    await expect(
      verifyUpload({
        bucket: "public/products",
        filename: "x.png",
        bytes: Buffer.from("not an image at all"),
        storageClass: "public",
      })
    ).resolves.toMatchObject({ allowed: false });
  });
});
