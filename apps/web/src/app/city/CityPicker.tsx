"use client";

import Link from "next/link";
import { useMemo } from "react";
import { CityCombobox } from "@/components/CityCombobox";
import { CityMap, type MapCity } from "@/components/CityMap";
import { useMyCity, useWeather } from "@/components/WeatherWidget";
import { CITY_EVENT, cityCookieString } from "@/lib/my-city";
import type { PickCity } from "@/lib/city-pick";

/** Выбор своего города: поиском (везде) и по карте (на компьютере). */
export function CityPicker({ cities }: { cities: MapCity[] }) {
  const { city, ready } = useMyCity();
  const weather = useWeather(city);
  const options = useMemo<PickCity[]>(() => cities.map((c) => ({ id: c.name, name: c.name, regionName: c.regionName })), [cities]);

  const choose = (name: string) => {
    document.cookie = cityCookieString(name);
    window.dispatchEvent(new Event(CITY_EVENT));
  };

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="order-2 hidden md:block lg:order-1">
        <CityMap cities={cities} selected={city} onPick={choose} />
        <p className="mt-2 text-xs text-ink-soft">Нажмите на точку города. Наведите мышь, чтобы увидеть название.</p>
      </div>

      <div className="order-1 space-y-4 lg:order-2">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="my-city">Город</label>
          {ready && (
            <CityCombobox
              id="my-city"
              cities={options}
              value={city ?? ""}
              onChange={(c) => {
                if (c) choose(c.name);
              }}
            />
          )}
        </div>

        <div className="card p-4" aria-live="polite">
          {city ? (
            <>
              <div className="text-sm text-ink-soft">Сейчас в городе {city}</div>
              {weather ? (
                <div className="mt-1 flex items-center gap-3">
                  <span className="text-4xl" aria-hidden>{weather.emoji}</span>
                  <div>
                    <div className="text-2xl font-semibold text-ink">{weather.temp}</div>
                    <div className="text-sm text-ink-soft">{weather.label}</div>
                  </div>
                </div>
              ) : (
                <div className="mt-1 text-sm text-ink-soft">Узнаём погоду…</div>
              )}
              <p className="mt-3 text-xs text-ink-soft">Погода видна над шапкой сайта. Город подставится в новое объявление.</p>
              <Link href="/classifieds" className="btn btn-ghost mt-3 px-3 py-2 text-sm">Объявления</Link>
            </>
          ) : (
            <p className="text-sm text-ink-soft">Выберите город: покажем погоду над шапкой сайта и подставим город в новое объявление.</p>
          )}
        </div>
        <p className="text-[11px] text-ink-soft">Погода: Open-Meteo, обновляется раз в 30 минут.</p>
      </div>
    </div>
  );
}
