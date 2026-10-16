import { apiRoute } from "@/lib/api-helpers";
import { cityCoords } from "@/lib/geo-data";
import { formatTemp, openMeteoUrl, parseOpenMeteo, weatherLook, type Weather } from "@/lib/weather";

export const dynamic = "force-dynamic";

// Погода для виджета в шапке. Источник: Open-Meteo (бесплатно, без ключа).
// Запрос идёт с сервера: браузеру разрешено ходить только на наш сайт.
// Только города из справочника, поэтому кэш не разрастается.
const TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; weather: Weather }>();

export const GET = apiRoute(async (request) => {
  const city = (new URL(request.url).searchParams.get("city") ?? "").trim().slice(0, 80);
  const coords = city ? cityCoords(city) : null;
  if (!coords) return Response.json({ error: "Такого города нет в справочнике" }, { status: 404 });

  const key = `${coords.lat},${coords.lon}`;
  let hit = cache.get(key);
  if (!hit || Date.now() - hit.at > TTL_MS) {
    try {
      const res = await fetch(openMeteoUrl(coords.lat, coords.lon), { signal: AbortSignal.timeout(4000), cache: "no-store" });
      const weather = res.ok ? parseOpenMeteo(await res.json()) : null;
      if (weather) {
        hit = { at: Date.now(), weather };
        cache.set(key, hit);
      }
    } catch {
      // Сервис погоды не ответил: покажем прошлое значение, если оно есть.
    }
  }
  if (!hit) return Response.json({ error: "Погода временно недоступна" }, { status: 503 });

  const look = weatherLook(hit.weather.code, hit.weather.isDay);
  return Response.json(
    { city, temp: formatTemp(hit.weather.temp), emoji: look.emoji, label: look.label, updatedAt: new Date(hit.at).toISOString() },
    { headers: { "Cache-Control": "public, max-age=600" } },
  );
});
