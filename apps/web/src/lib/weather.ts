/**
 * Погода для виджета в шапке: разбор ответа Open-Meteo (бесплатно, без ключа)
 * и подписи по коду погоды WMO. Чистые функции без сети.
 */

export interface Weather {
  temp: number;
  code: number;
  isDay: boolean;
}

/** Достаёт текущую погоду из ответа api.open-meteo.com/v1/forecast?current=… */
export function parseOpenMeteo(json: unknown): Weather | null {
  if (!json || typeof json !== "object") return null;
  const current = (json as { current?: unknown }).current;
  if (!current || typeof current !== "object") return null;
  const c = current as Record<string, unknown>;
  const temp = c.temperature_2m;
  const code = c.weather_code;
  if (typeof temp !== "number" || !Number.isFinite(temp)) return null;
  if (typeof code !== "number" || !Number.isInteger(code)) return null;
  return { temp, code, isDay: c.is_day !== 0 };
}

/** «+12°», «0°», «−3°» (настоящий минус, не дефис). */
export function formatTemp(t: number): string {
  const n = Math.round(t);
  if (n === 0) return "0°";
  return n > 0 ? `+${n}°` : `−${Math.abs(n)}°`;
}

/** Значок и подпись по коду WMO. Ночью вместо солнца луна. */
export function weatherLook(code: number, isDay = true): { emoji: string; label: string } {
  if (code === 0) return { emoji: isDay ? "☀️" : "🌙", label: "Ясно" };
  if (code === 1) return { emoji: isDay ? "🌤️" : "🌙", label: "Малооблачно" };
  if (code === 2) return { emoji: "⛅", label: "Переменная облачность" };
  if (code === 3) return { emoji: "☁️", label: "Пасмурно" };
  if (code === 45 || code === 48) return { emoji: "🌫️", label: "Туман" };
  if (code >= 51 && code <= 57) return { emoji: "🌦️", label: "Морось" };
  if (code >= 61 && code <= 67) return { emoji: "🌧️", label: "Дождь" };
  if (code >= 71 && code <= 77) return { emoji: "❄️", label: "Снег" };
  if (code >= 80 && code <= 82) return { emoji: "🌧️", label: "Ливень" };
  if (code === 85 || code === 86) return { emoji: "🌨️", label: "Снегопад" };
  if (code >= 95 && code <= 99) return { emoji: "⛈️", label: "Гроза" };
  return { emoji: "🌡️", label: "Погода" };
}

export function openMeteoUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lon.toFixed(2),
    current: "temperature_2m,weather_code,is_day",
    timezone: "auto",
  });
  return `https://api.open-meteo.com/v1/forecast?${q.toString()}`;
}
