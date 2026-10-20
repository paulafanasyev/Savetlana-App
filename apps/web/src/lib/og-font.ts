/**
 * Шрифт с кириллицей для картинок-превью (next/og): встроенный шрифт русских букв
 * не знает. Берём Montserrat из Google Fonts только для нужных букв. Не получилось
 * (нет сети, таймаут): null, картинка рисуется без русского текста.
 */
export async function loadOgFont(text: string): Promise<ArrayBuffer | null> {
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

/** Картинки в формате SVG мессенджеры в превью не показывают: для них рисуем PNG. */
export function isSvgUrl(url: string | null | undefined): boolean {
  return Boolean(url && /\.svg(?:$|[?#])/i.test(url));
}
