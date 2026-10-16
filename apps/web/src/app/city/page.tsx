import type { Metadata } from "next";
import { allCities } from "@/lib/geo-data";
import { CityPicker } from "./CityPicker";

export const metadata: Metadata = { title: "Мой город и погода" };

export default function CityPage() {
  const cities = allCities();
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-ink">Мой город</h1>
      <p className="mt-1 text-sm text-ink-soft">Город запомнится в этом браузере, входить в аккаунт не нужно.</p>
      <CityPicker cities={cities} />
    </div>
  );
}
