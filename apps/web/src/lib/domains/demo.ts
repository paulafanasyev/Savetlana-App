/**
 * Примеры объявлений на пустой витрине.
 * Добавляются, только если в базе нет ни одного объявления, и удаляются сами,
 * когда настоящих опубликованных объявлений станет достаточно.
 * Отключить: переменная окружения AIKO_DEMO=off. В тестах не работает.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../prisma";
import { ensureGeoSeeded } from "./geo";
import { DEMO_ADS, DEMO_AUTHOR_EMAIL, DEMO_NOTE, DEMO_TITLE_PREFIX, shouldRemoveDemo } from "../demo-classifieds";

let checked = false;
let pending: Promise<void> | null = null;

function enabled(): boolean {
  return process.env.NODE_ENV !== "test" && process.env.AIKO_DEMO !== "off";
}

async function demoAuthorId(): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email: DEMO_AUTHOR_EMAIL },
    update: {},
    create: {
      email: DEMO_AUTHOR_EMAIL,
      // Пароль, под которым войти невозможно: случайная строка, не хеш.
      passwordHash: `disabled:${randomBytes(24).toString("hex")}`,
      name: "АИКО · примеры",
      isBlocked: true,
    },
    select: { id: true },
  });
  return user.id;
}

async function run(): Promise<void> {
  const demoUser = await prisma.user.findUnique({ where: { email: DEMO_AUTHOR_EMAIL }, select: { id: true } });

  if (demoUser) {
    const real = await prisma.classified.count({ where: { status: "PUBLISHED", authorId: { not: demoUser.id } } });
    if (shouldRemoveDemo(real)) {
      await prisma.classified.deleteMany({ where: { authorId: demoUser.id } });
    }
    return;
  }

  if ((await prisma.classified.count()) > 0) return;

  await ensureGeoSeeded();
  const names = [...new Set(DEMO_ADS.map((a) => a.city))];
  const cities = await prisma.city.findMany({ where: { name: { in: names } }, select: { id: true, name: true, regionId: true } });
  const byName = new Map(cities.map((c) => [c.name, c]));
  const authorId = await demoAuthorId();

  const now = Date.now();
  const data = DEMO_ADS.flatMap((ad, i) => {
    const city = byName.get(ad.city);
    if (!city) return [];
    return [
      {
        vertical: ad.vertical,
        dealType: ad.dealType,
        authorId,
        title: `${DEMO_TITLE_PREFIX}${ad.title}`,
        description: `${ad.text}\n\n${DEMO_NOTE}`,
        category: ad.category,
        attrs: JSON.stringify({ ...ad.attrs, demo: true }),
        priceKopecks: ad.rub * 100,
        cityId: city.id,
        regionId: city.regionId,
        status: "PUBLISHED",
        // Разное время, чтобы порядок на витрине был естественным.
        createdAt: new Date(now - i * 37 * 60 * 1000),
      },
    ];
  });
  if (data.length) await prisma.classified.createMany({ data });
}

/** Безопасно вызывать на каждой странице: проверка идёт один раз на процесс. */
export async function ensureDemoClassifieds(): Promise<void> {
  if (checked || !enabled()) return;
  pending ??= run()
    .then(() => {
      checked = true;
    })
    .catch((error) => {
      console.warn("[demo] примеры объявлений:", error instanceof Error ? error.message : error);
    })
    .finally(() => {
      pending = null;
    });
  await pending;
}
