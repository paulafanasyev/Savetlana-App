"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { cityLabel, matchCity, normalize, suggestCities, type PickCity } from "@/lib/city-pick";
import { readCityCookie } from "@/lib/my-city";

/**
 * Поле «Город» с поиском: начинаете печатать, ниже появляются подходящие
 * города. Работает мышью, пальцем и клавиатурой (стрелки, Enter, Esc).
 * Выбранный город уходит в форму скрытым полем с его id.
 * Пустое поле само заполняется «моим городом» (выбран в шапке сайта).
 */
export function CityCombobox({
  cities,
  value,
  onChange,
  id,
  name,
  placeholder = "Начните вводить город",
}: {
  cities: PickCity[];
  value: string;
  onChange: (city: PickCity | null) => void;
  id?: string;
  name?: string;
  placeholder?: string;
}) {
  const listId = useId();
  const selected = useMemo(() => cities.find((c) => c.id === value) ?? null, [cities, value]);
  const [text, setText] = useState(selected ? cityLabel(selected) : "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  // Пустое поле: подставляем город, который человек выбрал в шапке сайта. Один раз, при открытии.
  useEffect(() => {
    if (value || cities.length === 0) return;
    const mine = readCityCookie(document.cookie);
    const found = mine ? cities.find((c) => normalize(c.name) === normalize(mine)) : undefined;
    if (found) onChange(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cities.length]);

  // Город выбрали снаружи (например, Светлана взяла его из текста): показываем его название.
  useEffect(() => {
    if (selected) setText(cityLabel(selected));
  }, [selected]);

  const options = useMemo(() => suggestCities(text === (selected ? cityLabel(selected) : null) ? "" : text, cities, 8), [text, selected, cities]);

  const choose = (c: PickCity) => {
    onChange(c);
    setText(cityLabel(c));
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(options.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open && options[active]) {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
          if (selected && e.target.value !== cityLabel(selected)) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          if (!selected) {
            const match = matchCity(text, cities);
            if (match) choose(match);
          }
        }}
        onKeyDown={onKeyDown}
      />
      {name && <input type="hidden" name={name} value={selected?.id ?? ""} />}
      {open && options.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg">
          {options.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer px-3 py-2 ${i === active ? "bg-zinc-100" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(c);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="font-medium text-zinc-900">{c.name}</span>
              {c.name !== c.regionName && <span className="text-zinc-500">, {c.regionName}</span>}
            </li>
          ))}
        </ul>
      )}
      {open && text.trim().length > 0 && options.length === 0 && (
        <p className="absolute z-30 mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600 shadow-lg">
          Такого города пока нет в списке. Выберите ближайший крупный город.
        </p>
      )}
    </div>
  );
}
