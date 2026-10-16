"use client";

import { useState } from "react";
import { CityCombobox } from "@/components/CityCombobox";
import type { PickCity } from "@/lib/city-pick";

/** Фильтр города с поиском. Пустое поле значит «по всей России» (cityId=all). */
export function CityFilter({ cities, initialId }: { cities: PickCity[]; initialId: string }) {
  const [id, setId] = useState(initialId);
  return (
    <div>
      <label htmlFor="filter-city" className="sr-only">Город</label>
      <CityCombobox
        id="filter-city"
        cities={cities}
        value={id}
        onChange={(c) => setId(c?.id ?? "")}
        autoMyCity={false}
        placeholder="Вся Россия: введите город"
      />
      <input type="hidden" name="cityId" value={id || "all"} />
    </div>
  );
}
