/**
 * Справочник городов в базе. Если он пустой (новая база, сид не запускали),
 * заполняем его сами при первом обращении: без городов нельзя разместить
 * объявление. Вставляем только недостающее, поэтому повторный запуск безопасен.
 */
import { prisma } from "../prisma";
import { DISTRICTS } from "../geo-data";

let pending: Promise<void> | null = null;

async function insertMissing(): Promise<void> {
  // Округа
  const haveDistricts = new Map((await prisma.federalDistrict.findMany({ select: { id: true, name: true } })).map((d) => [d.name, d.id]));
  const newDistricts = DISTRICTS.filter((d) => !haveDistricts.has(d.name)).map((d) => ({ name: d.name }));
  if (newDistricts.length) await prisma.federalDistrict.createMany({ data: newDistricts });
  const districtId = new Map((await prisma.federalDistrict.findMany({ select: { id: true, name: true } })).map((d) => [d.name, d.id]));

  // Регионы
  const haveRegions = new Set((await prisma.region.findMany({ select: { name: true } })).map((r) => r.name));
  const newRegions = DISTRICTS.flatMap((d) =>
    d.regions.filter((r) => !haveRegions.has(r.name)).map((r) => ({ name: r.name, type: r.type, districtId: districtId.get(d.name)! })),
  );
  if (newRegions.length) await prisma.region.createMany({ data: newRegions });
  const regionId = new Map((await prisma.region.findMany({ select: { id: true, name: true } })).map((r) => [r.name, r.id]));

  // Города
  const haveCities = new Set((await prisma.city.findMany({ select: { name: true, regionId: true } })).map((c) => `${c.regionId}/${c.name}`));
  const newCities = DISTRICTS.flatMap((d) =>
    d.regions.flatMap((r) => {
      const rid = regionId.get(r.name)!;
      return r.cities
        .filter((c) => !haveCities.has(`${rid}/${c.name}`))
        .map((c) => ({ name: c.name, regionId: rid, population: c.population ?? null, hasMetro: c.hasMetro ?? false }));
    }),
  );
  if (newCities.length) await prisma.city.createMany({ data: newCities });

  // Метро
  const metroCities = DISTRICTS.flatMap((d) => d.regions.flatMap((r) => r.cities.filter((c) => c.metro).map((c) => ({ city: c, rid: regionId.get(r.name)! }))));
  for (const { city, rid } of metroCities) {
    const row = await prisma.city.findFirst({ where: { name: city.name, regionId: rid }, select: { id: true } });
    if (!row || !city.metro) continue;
    const haveLines = new Set((await prisma.metroLine.findMany({ where: { cityId: row.id }, select: { name: true } })).map((l) => l.name));
    const newLines = Object.keys(city.metro).filter((n) => !haveLines.has(n)).map((name) => ({ name, cityId: row.id }));
    if (newLines.length) await prisma.metroLine.createMany({ data: newLines });
    const lines = await prisma.metroLine.findMany({ where: { cityId: row.id }, select: { id: true, name: true, stations: { select: { name: true } } } });
    const newStations = lines.flatMap((l) => {
      const have = new Set(l.stations.map((s) => s.name));
      return [...new Set(city.metro?.[l.name] ?? [])].filter((s) => !have.has(s)).map((name) => ({ name, lineId: l.id }));
    });
    if (newStations.length) await prisma.metroStation.createMany({ data: newStations });
  }
}

/** Заполняет справочник, если в нём нет ни одного города. Ошибки не роняют страницу. */
export async function ensureGeoSeeded(): Promise<void> {
  if ((await prisma.city.count()) > 0) return;
  pending ??= insertMissing()
    .catch((error) => {
      // Параллельный запрос мог вставить те же строки: это не страшно.
      console.warn("[geo] не удалось заполнить справочник городов:", error instanceof Error ? error.message : error);
    })
    .finally(() => {
      pending = null;
    });
  await pending;
}
