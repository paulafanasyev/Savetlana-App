"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CITY_EVENT, readCityCookie } from "@/lib/my-city";

export interface WeatherNow {
  temp: string;
  emoji: string;
  label: string;
}

/** Выбранный город из куки; обновляется, когда город меняют на странице /city. */
export function useMyCity(): { city: string | null; ready: boolean } {
  const [city, setCity] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sync = () => {
      setCity(readCityCookie(document.cookie));
      setReady(true);
    };
    sync();
    window.addEventListener(CITY_EVENT, sync);
    return () => window.removeEventListener(CITY_EVENT, sync);
  }, []);
  return { city, ready };
}

/** Погода сейчас в городе. null: ещё грузится или сервис погоды не ответил. */
export function useWeather(city: string | null): WeatherNow | null {
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  useEffect(() => {
    setWeather(null);
    if (!city) return;
    let cancelled = false;
    void fetch(`/api/weather?city=${encodeURIComponent(city)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Partial<WeatherNow> | null) => {
        if (!cancelled && d?.temp && d.emoji) setWeather({ temp: d.temp, emoji: d.emoji, label: d.label ?? "" });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [city]);
  return weather;
}

/** Маленький виджет над шапкой: «📍 Казань ☁️ +12°». Нажали: страница с картой и выбором города. */
export function WeatherWidget({ className = "" }: { className?: string }) {
  const { city, ready } = useMyCity();
  const weather = useWeather(city);
  if (!ready) return null;
  const title = city ? (weather ? `${city}: ${weather.label.toLowerCase()}, ${weather.temp}` : `${city}: сменить город`) : "Выбрать свой город";
  return (
    <Link
      href="/city"
      data-testid="weather-widget"
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-ink-soft hover:bg-surface-muted hover:text-ink ${className}`}
      title={title}
      aria-label={title}
    >
      <span aria-hidden>📍</span>
      <span className="max-w-[10rem] truncate">{city ?? "Выбрать город"}</span>
      {weather && (
        <span className="whitespace-nowrap font-medium text-ink">
          <span aria-hidden>{weather.emoji}</span> {weather.temp}
        </span>
      )}
    </Link>
  );
}
