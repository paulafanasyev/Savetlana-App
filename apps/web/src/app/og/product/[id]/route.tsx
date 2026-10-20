import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { rub } from "@/lib/format";
import { absoluteImage } from "@/lib/seo";
import { isDemoSeller } from "@/lib/domains/seller-trust-display";
import { loadOgFont } from "@/lib/og-font";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIZE = { width: 1200, height: 630 };

/**
 * Сервер скачивает фото только с нашего сайта и из нашего хранилища (Vercel Blob).
 * Ссылки из импорта каталога могут вести куда угодно, в том числе во внутреннюю
 * сеть хостинга, поэтому чужие адреса и переадресации не открываем.
 */
function allowedImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const hosts = new Set<string>();
    for (const base of [env.publicAppUrl, absoluteImage("/")]) {
      try {
        hosts.add(new URL(base).host);
      } catch {
        // пустой или неверный адрес сайта: просто пропускаем
      }
    }
    return hosts.has(u.host) || u.hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

/** Фото товара как data-URL: SVG кладём в картинку целиком, без второго запроса из рисовалки. */
async function imageData(url: string | null): Promise<string | null> {
  if (!url || !allowedImageUrl(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000), redirect: "manual" });
    if (!res.ok) return null;
    const type = res.headers.get("content-type")?.split(";")[0] ?? "image/svg+xml";
    if (!/^image\/(svg\+xml|png|jpeg)$/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 1_500_000) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Картинка-превью товара 1200×630 в PNG для Telegram, WhatsApp и соцсетей. Нужна там,
 * где фото товара в SVG (демо-товары): SVG мессенджеры в превью не показывают.
 * Только опубликованные товары; демо помечено на самой картинке.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await prisma.product
    .findFirst({
      where: { id, status: "ACTIVE" },
      select: {
        title: true,
        priceKopecks: true,
        images: { orderBy: { position: "asc" }, take: 1, select: { url: true } },
        sellerProfile: { select: { displayName: true, slug: true } },
      },
    })
    .catch(() => null);
  if (!product) return new Response("Товар не найден", { status: 404 });

  const demo = isDemoSeller({ slug: product.sellerProfile.slug });
  const title = product.title.length > 70 ? `${product.title.slice(0, 69)}…` : product.title;
  const price = rub(product.priceKopecks);
  const seller = demo ? "Демо-товар площадки" : `Продавец: ${product.sellerProfile.displayName}`;
  const raw = product.images[0]?.url ?? null;
  const [photo, font] = await Promise.all([
    imageData(raw ? absoluteImage(raw) : null),
    loadOgFont(["АИКО", title, price, seller, "Безопасная сделка"].join("")),
  ]);
  const ru = Boolean(font);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#ffffff", fontFamily: ru ? "Montserrat" : undefined }}>
        <div style={{ width: 560, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f3ff" }}>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} width={440} height={440} style={{ objectFit: "contain" }} alt="" />
          ) : (
            <div style={{ display: "flex", fontSize: 120 }}>📦</div>
          )}
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 56px 48px" }}>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 700, color: "#6d28d9", letterSpacing: 3 }}>{ru ? "АИКО" : "AIKO"}</div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 46, fontWeight: 700, color: "#18181b", lineHeight: 1.15 }}>{ru ? title : ""}</div>
            <div style={{ display: "flex", marginTop: 24, fontSize: 56, fontWeight: 700, color: "#6d28d9" }}>{price.replace("₽", ru ? "₽" : "RUB")}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 24, fontWeight: 700, color: "#52525b" }}>
            <div style={{ display: "flex" }}>{ru ? seller : ""}</div>
            <div style={{ display: "flex", marginTop: 8 }}>{ru ? "✓ Безопасная сделка" : ""}</div>
          </div>
        </div>
      </div>
    ),
    {
      ...SIZE,
      fonts: font ? [{ name: "Montserrat", data: font, weight: 700, style: "normal" }] : undefined,
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
    },
  );
}
