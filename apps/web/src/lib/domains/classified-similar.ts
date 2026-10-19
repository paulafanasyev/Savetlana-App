/**
 * Похожие объявления: тот же раздел и тип сделки, сначала в том же городе, потом в
 * регионе, потом по всей России (пока объявлений мало, иначе блок пустой). Берём из
 * обычного поиска, поэтому истёкшие, снятые и на проверке сюда не попадают. Город на
 * карточке виден, так что покупатель не спутает дальнее объявление с соседним.
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
  const tiers = [{ cityId: ad.cityId }, { regionId: ad.regionId }, {}];
  const found: PublicClassified[] = [];
  for (const tier of tiers) {
    found.push(...(await searchClassifieds({ ...base, ...tier })).items);
    if (pickSimilar(found, [], id).length >= SIMILAR_LIMIT) break;
  }
  return pickSimilar(found, [], id);
}
