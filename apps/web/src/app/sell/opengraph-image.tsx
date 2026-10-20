import { ImageResponse } from "next/og";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "Продавайте на АИКО";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Шрифт с кириллицей берём из Google Fonts только для нужных букв: встроенный шрифт
 * картинок кириллицы не знает. Не получилось (нет сети, таймаут): null, и картинка
 * рисуется без русского текста, а не ломается.
 */
async function loadFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const cssRes = await fetch(
      `https://fonts.googleapis.com/css2?family=Montserrat:wght@700&text=${encodeURIComponent(text)}`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (!cssRes.ok) return null;
    const css = await cssRes.text();
    const match = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/);
    if (!match) return null;
    const fontRes = await fetch(match[1], { signal: AbortSignal.timeout(4000) });
    return fontRes.ok ? await fontRes.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export default async function SellOgImage() {
  const fee = String(env.platformFeePercent).replace(".", ",");
  const lines = {
    brand: "АИКО",
    title: "Продавайте на АИКО",
    fee: `Комиссия ${fee}% с продажи`,
    points: ["Самозанятых одобряем по данным ФНС", "Карточки товаров со Светланой", "Безопасная сделка"],
  };
  const font = await loadFont([lines.brand, lines.title, lines.fee, ...lines.points, "✓"].join(""));
  const cyrillic = Boolean(font);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "linear-gradient(135deg, #4c1d95 0%, #7c3aed 55%, #a78bfa 100%)",
          color: "#ffffff",
          fontFamily: cyrillic ? "Montserrat" : undefined,
        }}
      >
        <div style={{ display: "flex", fontSize: 40, fontWeight: 700, letterSpacing: 4, opacity: 0.9 }}>{cyrillic ? lines.brand : "AIKO"}</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, lineHeight: 1.1 }}>{cyrillic ? lines.title : "AIKO"}</div>
          <div style={{ display: "flex", marginTop: 24, fontSize: 48, fontWeight: 700, color: "#fde68a" }}>{cyrillic ? lines.fee : `${fee}%`}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 30, fontWeight: 700 }}>
          {cyrillic
            ? lines.points.map((p) => (
                <div key={p} style={{ display: "flex", marginTop: 10 }}>{`✓ ${p}`}</div>
              ))
            : null}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: font ? [{ name: "Montserrat", data: font, weight: 700, style: "normal" }] : undefined,
    },
  );
}
