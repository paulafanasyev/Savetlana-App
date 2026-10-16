/**
 * Geography seed — Russian federal districts → regions → cities (+ Moscow / SPb
 * metro trees). Every classified must carry a real, filterable location, so the
 * geo tree must exist before any ad can be posted.
 *
 * Данные лежат в src/lib/geo-data.ts (оттуда же берёт их сайт, если база пустая).
 * Idempotent: upserts on the natural keys (names are @unique per parent).
 */
import { prisma } from "../src/lib/prisma";
import { DISTRICTS } from "../src/lib/geo-data";

export async function seedGeo(): Promise<{
  districts: number;
  regions: number;
  cities: number;
  metroLines: number;
  metroStations: number;
}> {
  let districts = 0;
  let regions = 0;
  let cities = 0;
  let metroLines = 0;
  let metroStations = 0;

  for (const d of DISTRICTS) {
    const district = await prisma.federalDistrict.upsert({
      where: { name: d.name },
      update: {},
      create: { name: d.name },
    });
    districts++;

    for (const r of d.regions) {
      const region = await prisma.region.upsert({
        where: { name: r.name },
        update: {},
        create: { name: r.name, type: r.type, districtId: district.id },
      });
      regions++;

      for (const c of r.cities) {
        const city = await prisma.city.upsert({
          where: { name_regionId: { name: c.name, regionId: region.id } },
          update: { population: c.population ?? null, hasMetro: c.hasMetro ?? false },
          create: {
            name: c.name,
            regionId: region.id,
            population: c.population ?? null,
            hasMetro: c.hasMetro ?? false,
          },
        });
        cities++;

        if (c.hasMetro && c.metro) {
          for (const [lineName, stations] of Object.entries(c.metro)) {
            const line = await prisma.metroLine.upsert({
              where: { name_cityId: { name: lineName, cityId: city.id } },
              update: {},
              create: { name: lineName, cityId: city.id },
            });
            metroLines++;
            for (const st of stations) {
              await prisma.metroStation.upsert({
                where: { name_lineId: { name: st, lineId: line.id } },
                update: {},
                create: { name: st, lineId: line.id },
              });
              metroStations++;
            }
          }
        }
      }
    }
  }

  return { districts, regions, cities, metroLines, metroStations };
}

async function main() {
  const stats = await seedGeo();
  console.log("geo seed:", JSON.stringify(stats));
}

// Only run as a script, not when imported (e.g. by the test setup, which calls
// seedGeo() directly). Otherwise an import would exit the importing process.
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
