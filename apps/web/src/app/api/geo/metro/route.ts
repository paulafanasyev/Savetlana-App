import { apiRoute } from "@/lib/api-helpers";
import { getMetroForCity } from "@/lib/domains/classifieds";

export const dynamic = "force-dynamic";

// Metro tree for a city (currently Moscow / Saint Petersburg). Used by real
// estate search so a buyer can filter by a real station, not free text.
export const GET = apiRoute(async (request) => {
  const url = new URL(request.url);
  const cityId = url.searchParams.get("cityId");
  if (!cityId) {
    return Response.json({ error: "cityId_required" }, { status: 400 });
  }

  const lines = await getMetroForCity(cityId);
  return Response.json({
    lines: lines.map((l) => ({
      id: l.id,
      name: l.name,
      color: l.color,
      stations: l.stations.map((s) => ({ id: s.id, name: s.name })),
    })),
  });
});
