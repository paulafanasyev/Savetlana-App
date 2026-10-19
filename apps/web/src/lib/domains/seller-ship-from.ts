/**
 * Город отгрузки продавца в базе: адрес пользователя с пометкой «Город отгрузки»
 * (один на пользователя). См. lib/ship-from.ts.
 */
import { prisma } from "../prisma";
import { DEMO_SHIP_CITIES, SHIP_FROM_LABEL, resolveShipCity } from "../ship-from";
import { audit } from "./audit";

/** Почта демо-аккаунтов (demo-catalog.ts): по ней отличаем демо от настоящих продавцов. */
const DEMO_EMAIL_SUFFIX = "@demo.svetlana.local";

export async function getShipCity(userId: string): Promise<string | null> {
  const row = await prisma.address.findFirst({ where: { userId, label: SHIP_FROM_LABEL }, select: { city: true } });
  return row?.city ?? null;
}

/** Записать или убрать (null) город отгрузки. Город должен быть из справочника. */
export async function setShipCity(userId: string, rawCity: string | null): Promise<string | null> {
  const city = rawCity ? resolveShipCity(rawCity) : null;
  if (rawCity && !city) throw new Error("unknown_city");
  const before = await getShipCity(userId);
  await prisma.$transaction([
    prisma.address.deleteMany({ where: { userId, label: SHIP_FROM_LABEL } }),
    ...(city
      ? [prisma.address.create({ data: { userId, label: SHIP_FROM_LABEL, line1: city.name, city: city.name, region: city.regionName, isDefault: false } })]
      : []),
  ]);
  await audit({
    actorId: userId,
    actorRole: "SELLER",
    action: "seller.ship_city",
    targetType: "User",
    targetId: userId,
    before: { city: before },
    after: { city: city?.name ?? null },
  });
  return city?.name ?? null;
}

/** Город отгрузки для каждого продавца из списка (ключ: id профиля продавца). */
export async function shipCitiesBySeller(sellerIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (sellerIds.length === 0) return out;
  const rows = await prisma.sellerProfile.findMany({
    where: { id: { in: [...new Set(sellerIds)] } },
    select: { id: true, user: { select: { addresses: { where: { label: SHIP_FROM_LABEL }, select: { city: true }, take: 1 } } } },
  });
  for (const r of rows) {
    const city = r.user.addresses[0]?.city;
    if (city) out.set(r.id, city);
  }
  return out;
}

let demoReady = false;

/**
 * Демо-магазинам один раз проставляем город (повторный вызов ничего не меняет).
 * Демо-самозанятому ставим условный НПД так же, как демо-ИП и организациям стоит
 * условная регистрация: иначе по новому правилу он не сможет принимать демо-заказы.
 * Настоящих продавцев не трогаем: только аккаунты с демо-почтой.
 */
export async function ensureDemoShipCities(): Promise<void> {
  if (demoReady) return;
  const sellers = await prisma.sellerProfile.findMany({
    where: { displayName: { in: Object.keys(DEMO_SHIP_CITIES) } },
    select: { displayName: true, userId: true, user: { select: { addresses: { where: { label: SHIP_FROM_LABEL }, select: { id: true }, take: 1 } } } },
  });
  for (const s of sellers) {
    if (s.user.addresses.length > 0) continue;
    const city = resolveShipCity(DEMO_SHIP_CITIES[s.displayName]);
    if (!city) continue;
    await prisma.address.create({ data: { userId: s.userId, label: SHIP_FROM_LABEL, line1: city.name, city: city.name, region: city.regionName, isDefault: false } });
  }
  await prisma.sellerProfile
    .updateMany({
      where: { sellerType: "SELF_EMPLOYED", npdStatus: { not: "VERIFIED" }, user: { email: { endsWith: DEMO_EMAIL_SUFFIX } } },
      data: { npdStatus: "VERIFIED" },
    })
    .catch(() => undefined);
  demoReady = true;
}
