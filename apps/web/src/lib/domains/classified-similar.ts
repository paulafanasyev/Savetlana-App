/**
 * Похожие объявления: тот же раздел и тип сделки, сначала в том же городе, потом в
 * регионе. Берём из обычного поиска, поэтому истёкшие, снятые и на проверке сюда не
 * попадают.
 */
import { prisma } from "../prisma";
import { searchClassifieds, type PublicClassified } from "./classifieds";
import { pickSimilar, SIMILAR_LIMIT } from "../similar-ads";

export async function similarClassifieds(id: string): Promise<PublicClassified[]> {
  const ad = await prisma.classified.findUnique({
    where: { id },
    select: { vertical: true, dealType: true, cityId: true, regionId: true },
  });
  if (!ad) return [];
  const base = { vertical: ad.vertical, dealType: ad.dealType, limit: SIMILAR_LIMIT + 1 };
  const near = (await searchClassifieds({ ...base, cityId: ad.cityId })).items;
  const enough = near.filter((x) => x.id !== id).length >= SIMILAR_LIMIT;
  const wide = enough ? [] : (await searchClassifieds({ ...base, regionId: ad.regionId })).items;
  return pickSimilar(near, wide, id);
}
