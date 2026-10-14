import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { checkPhotoUrl, copyImportedPhotos, fetchRemotePhoto, isOwnPhotoUrl, isPublicAddress, PHOTO_MAX_BYTES } from "../src/lib/domains/photo-copy";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function respond(status: number, init: { body?: Uint8Array; headers?: Record<string, string> } = {}): Response {
  return new Response(init.body ?? null, { status, headers: init.headers });
}

describe("копирование фото: защита от обращений во внутреннюю сеть", () => {
  it("частные и служебные адреса не публичные", () => {
    for (const ip of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPublicAddress(ip)).toBe(false);
    }
    for (const ip of ["5.255.255.70", "87.250.250.242", "2a02:6b8::2:242"]) {
      expect(isPublicAddress(ip)).toBe(true);
    }
  });

  it("ссылка: только https, без логина, без нестандартного порта и внутренних имён", () => {
    expect(checkPhotoUrl("https://avatars.mds.yandex.net/a.jpg").ok).toBe(true);
    expect(checkPhotoUrl("http://example.ru/a.jpg").ok).toBe(false);
    expect(checkPhotoUrl("https://user:pass@example.ru/a.jpg").ok).toBe(false);
    expect(checkPhotoUrl("https://example.ru:8080/a.jpg").ok).toBe(false);
    expect(checkPhotoUrl("https://localhost/a.jpg").ok).toBe(false);
    expect(checkPhotoUrl("https://10.0.0.1/a.jpg").ok).toBe(false);
    expect(checkPhotoUrl("https://db.internal/a.jpg").ok).toBe(false);
  });

  it("свои фото не копируем", () => {
    expect(isOwnPhotoUrl("/api/storage/database/public/products/x/abc")).toBe(true);
    expect(isOwnPhotoUrl("https://abc.public.blob.vercel-storage.com/p.jpg")).toBe(true);
    expect(isOwnPhotoUrl("https://cdn.ozone.ru/p.jpg")).toBe(false);
  });

  it("скачивает картинку с публичного адреса", async () => {
    const res = await fetchRemotePhoto("https://cdn.example.ru/a.jpg", {
      lookup: async () => ["93.158.134.3"],
      fetchImpl: (async () => respond(200, { body: JPEG })) as typeof fetch,
    });
    expect(res.ok).toBe(true);
    expect(res.ok && res.bytes.length).toBe(JPEG.length);
  });

  it("имя, которое ведёт во внутреннюю сеть, отклоняется ещё до запроса", async () => {
    let called = false;
    const res = await fetchRemotePhoto("https://evil.example.ru/a.jpg", {
      lookup: async () => ["93.158.134.3", "10.0.0.5"],
      fetchImpl: (async () => { called = true; return respond(200, { body: JPEG }); }) as typeof fetch,
    });
    expect(res.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("перенаправление на внутренний адрес не проходит", async () => {
    const seen: string[] = [];
    const res = await fetchRemotePhoto("https://cdn.example.ru/a.jpg", {
      lookup: async (host) => (host === "metadata.example.ru" ? ["169.254.169.254"] : ["93.158.134.3"]),
      fetchImpl: (async (url: string) => {
        seen.push(url);
        return respond(302, { headers: { location: "https://metadata.example.ru/latest" } });
      }) as unknown as typeof fetch,
    });
    expect(res.ok).toBe(false);
    expect(seen).toEqual(["https://cdn.example.ru/a.jpg"]);
  });

  it("перенаправление на http не проходит, а бесконечные перенаправления обрываются", async () => {
    const toHttp = await fetchRemotePhoto("https://cdn.example.ru/a.jpg", {
      lookup: async () => ["93.158.134.3"],
      fetchImpl: (async () => respond(301, { headers: { location: "http://cdn.example.ru/a.jpg" } })) as typeof fetch,
    });
    expect(toHttp.ok).toBe(false);
    const loop = await fetchRemotePhoto("https://cdn.example.ru/a.jpg", {
      lookup: async () => ["93.158.134.3"],
      fetchImpl: (async () => respond(302, { headers: { location: "/again" } })) as typeof fetch,
    });
    expect(loop.ok).toBe(false);
  });

  it("слишком большой файл не скачиваем", async () => {
    const res = await fetchRemotePhoto("https://cdn.example.ru/big.jpg", {
      lookup: async () => ["93.158.134.3"],
      fetchImpl: (async () => respond(200, { body: new Uint8Array(PHOTO_MAX_BYTES + 1) })) as typeof fetch,
    });
    expect(res.ok).toBe(false);
  });
});

describe("копирование фото перенесённых товаров", () => {
  it("заменяет чужие ссылки своими, неудачные оставляет, чужие товары не трогает", async () => {
    const tag = `ph-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const mk = async (suffix: string) => {
      const user = await prisma.user.create({ data: { email: `${tag}-${suffix}@test.ru`, passwordHash: "x", role: "SELLER" } });
      const seller = await prisma.sellerProfile.create({ data: { userId: user.id, slug: `${tag}-${suffix}`, displayName: "Фото" } });
      const product = await prisma.product.create({ data: { sellerId: seller.id, sku: `${tag}-${suffix}`, title: "Кружка", aiGeneratedFrom: "catalog-import" } });
      return { user, seller, product };
    };
    const mine = await mk("a");
    const other = await mk("b");
    await prisma.productImage.createMany({
      data: [
        { productId: mine.product.id, url: "https://cdn.example.ru/ok.jpg", position: 0, isPrimary: true },
        { productId: mine.product.id, url: "https://cdn.example.ru/broken.jpg", position: 1 },
        { productId: other.product.id, url: "https://cdn.example.ru/ok.jpg", position: 0, isPrimary: true },
      ],
    });
    const deps = {
      fetchPhoto: async (url: string) => (url.endsWith("ok.jpg") ? { ok: true as const, bytes: JPEG } : { ok: false as const, reason: "сайт с фото ответил ошибкой 404" }),
      store: async (productId: string) => `/api/storage/database/public/products/${productId}/copy`,
    };
    const first = await copyImportedPhotos({ sellerId: mine.seller.id, actorId: mine.user.id }, deps);
    expect(first.copied).toBe(1);
    expect(first.failed).toBe(1);
    expect(first.nextCursor).toBeNull();

    const images = await prisma.productImage.findMany({ where: { productId: mine.product.id }, orderBy: { position: "asc" } });
    expect(images[0].url).toBe(`/api/storage/database/public/products/${mine.product.id}/copy`);
    expect(images[1].url).toBe("https://cdn.example.ru/broken.jpg");
    const others = await prisma.productImage.findMany({ where: { productId: other.product.id } });
    expect(others[0].url).toBe("https://cdn.example.ru/ok.jpg");
  });
});
