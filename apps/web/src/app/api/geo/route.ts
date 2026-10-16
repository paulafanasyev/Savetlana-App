import { apiRoute } from "@/lib/api-helpers";
import { getGeoTree, searchCities } from "@/lib/domains/classifieds";
import { ensureGeoSeeded } from "@/lib/domains/geo";

export const dynamic = "force-dynamic";

// Full geo tree: federal districts -> regions -> cities. Public; used by the
// classified picker so every ad carries a real, filterable location.
// Пустой справочник заполняется сам при первом запросе.
export const GET = apiRoute(async (request) => {
  await ensureGeoSeeded();
  const url = new URL(request.url);
  const query = url.searchParams.get("q");

  if (query && query.trim().length >= 2) {
    const cities = await searchCities(query.trim());
    return Response.json({
      items: cities.map((c) => ({
        id: c.id,
        name: c.name,
        region: c.region.name,
        regionId: c.region.id,
        population: c.population,
      })),
    });
  }

  const tree = await getGeoTree();
  return Response.json({
    districts: tree.map((d) => ({
      id: d.id,
      name: d.name,
      regions: d.regions.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        cities: r.cities.map((c) => ({
          id: c.id,
          name: c.name,
          hasMetro: c.hasMetro,
          population: c.population,
        })),
      })),
    })),
  });
});
