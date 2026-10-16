"use client";

import { MAP_VIEW, mapPoint, mapTiles } from "@/lib/city-map";

export interface MapCity {
  name: string;
  regionName: string;
  population: number;
  lat: number;
  lon: number;
}

const TILES = mapTiles();

/**
 * Карта России с точками городов. Нажатие на точку выбирает город.
 * Подложка: тайлы OpenStreetMap (масштаб 3), поверх них SVG с точками,
 * поэтому карта сама подстраивается под ширину экрана.
 */
export function CityMap({ cities, selected, onPick }: { cities: MapCity[]; selected: string | null; onPick: (name: string) => void }) {
  // Мелкие города рисуем первыми, крупные поверх: в Подмосковье точки не перекрывают Москву.
  const ordered = [...cities].sort((a, b) => a.population - b.population);
  const chosen = cities.find((c) => c.name === selected) ?? null;
  const chosenPoint = chosen ? mapPoint(chosen.lat, chosen.lon) : null;

  return (
    <figure className="relative overflow-hidden rounded-2xl border border-surface-line bg-[#aad3df]">
      <svg viewBox={`0 0 ${MAP_VIEW.width} ${MAP_VIEW.height}`} className="block h-auto w-full" role="group" aria-label="Карта городов России">
        {TILES.map((t) => (
          <image key={t.url} href={t.url} x={t.x} y={t.y} width={256} height={256} preserveAspectRatio="none" />
        ))}
        {ordered.map((c) => {
          const p = mapPoint(c.lat, c.lon);
          const big = c.population >= 1_000_000;
          const isChosen = c.name === selected;
          return (
            <g
              key={c.name}
              role="button"
              tabIndex={0}
              aria-label={`Выбрать город ${c.name}`}
              className="cursor-pointer focus:outline-none"
              onClick={() => onPick(c.name)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPick(c.name);
                }
              }}
            >
              <title>{c.name === c.regionName ? c.name : `${c.name}, ${c.regionName}`}</title>
              {/* Невидимый круг побольше: в точку проще попасть мышью. */}
              <circle cx={p.x} cy={p.y} r={8} fill="transparent" />
              <circle
                cx={p.x}
                cy={p.y}
                r={isChosen ? 6 : big ? 4 : 2.6}
                fill={isChosen ? "#dc2626" : big ? "#7c3aed" : "#a78bfa"}
                stroke="#fff"
                strokeWidth={1.2}
              />
            </g>
          );
        })}
        {chosen && chosenPoint && (
          <text
            x={chosenPoint.x + 9}
            y={chosenPoint.y + 4}
            fontSize={14}
            fontWeight={600}
            fill="#111827"
            stroke="#fff"
            strokeWidth={3}
            paintOrder="stroke"
            pointerEvents="none"
          >
            {chosen.name}
          </text>
        )}
      </svg>
      <figcaption className="absolute bottom-0 right-0 rounded-tl bg-white/85 px-1.5 py-0.5 text-[10px] text-ink-soft">
        ©{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">
          участники OpenStreetMap
        </a>
      </figcaption>
    </figure>
  );
}
