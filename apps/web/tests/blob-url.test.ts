import { describe, expect, it } from "vitest";
import { blobStoreId, isPublicBlobUrl } from "../src/lib/blob-url";

describe("Vercel Blob без пакета", () => {
  it("store id берётся из токена", () => {
    expect(blobStoreId("vercel_blob_rw_AbC123xyz_secretPart")).toBe("AbC123xyz");
    expect(blobStoreId(undefined)).toBe("");
    expect(blobStoreId("bad")).toBe("");
  });

  it("принимаем только публичные ссылки Vercel Blob", () => {
    expect(isPublicBlobUrl("https://AbC123xyz.public.blob.vercel-storage.com/public/portfolio/u1/x-AbC.jpg")).toBe(true);
    expect(isPublicBlobUrl("http://abc.public.blob.vercel-storage.com/x.jpg")).toBe(false);
    expect(isPublicBlobUrl("https://abc.public.blob.vercel-storage.com.evil.example/x.jpg")).toBe(false);
    expect(isPublicBlobUrl("https://evil.example/x.jpg")).toBe(false);
    expect(isPublicBlobUrl("не ссылка")).toBe(false);
  });
});
