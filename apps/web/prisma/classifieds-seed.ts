/**
 * Classifieds seed — real estate, auto and services with real geo binding.
 *
 * Every listing is anchored to a real City row from geo-seed so the geo
 * filters on /classifieds work out of the box. VIN checks are created for
 * auto listings with the honest NOT_PROVEN status (no real history provider
 * is connected), never a fabricated VERIFIED (spec §49).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const VERTICALS = ["REAL_ESTATE", "AUTO", "SERVICE"] as const;
const STATUSES = ["PUBLISHED", "DRAFT", "ARCHIVED", "REJECTED"] as const;

async function cityByName(name: string) {
  return prisma.city.findFirst({
    where: { name },
    include: {
      region: true,
      metroLines: { include: { stations: { take: 2 } } },
    },
  });
}

async function main() {
  const moscow = await cityByName("Москва");
  const spb = await cityByName("Санкт-Петербург");
  const novosibirsk = await cityByName("Новосибирск");
  const ekb = await cityByName("Екатеринбург");
  const kazan = await cityByName("Казань");

  if (!moscow || !spb || !novosibirsk || !ekb || !kazan) {
    throw new Error("geo seed missing — run prisma/geo-seed.ts first");
  }

  const users = await prisma.user.findMany({ take: 6 });
  const sellers = await prisma.sellerProfile.findMany({ take: 3 });
  if (users.length < 3) throw new Error("seed users missing");

  const byEmail = (e: string) => users.find((u) => u.email === e) ?? users[0];
  const privateAuthor = byEmail("anna@svetlana.example");
  const agent = byEmail("seller1@svetlana.example");

  type NewAd = {
    vertical: (typeof VERTICALS)[number];
    dealType: string;
    authorId: string;
    sellerId?: string;
    title: string;
    description: string;
    category: string;
    attrs: Record<string, unknown>;
    priceKopecks: number;
    oldPriceKopecks?: number;
    cityId: string;
    regionId: string;
    districtName?: string;
    addressLine?: string;
    metroId?: string;
    metroWalkMin?: number;
    status: (typeof STATUSES)[number];
    vin?: string;
  };

  const ads: NewAd[] = [
    // ===== НЕДВИЖИМОСТЬ =====
    {
      vertical: "REAL_ESTATE",
      dealType: "SELL",
      authorId: agent.id,
      sellerId: sellers[0]?.id,
      title: "2-комнатная квартира, 64 м², 9/17 эт.",
      description:
        "Светлая двухкомнатная квартира в кирпичном доме. Ремонт выполнен в 2023 году. Окна выходят во двор. Свободная продажа.",
      category: "Квартиры",
      attrs: { rooms: 2, areaTotal: 64, floor: 9, floorsTotal: 17, buildingType: "кирпичный" },
      priceKopecks: 18_900_000_00,
      cityId: moscow.id,
      regionId: moscow.regionId,
      districtName: "р-н Хамовники",
      addressLine: "ул. Льва Толстого, 12",
      metroId: moscow.metroLines[0]?.stations[0]?.id,
      metroWalkMin: 7,
      status: "PUBLISHED",
    },
    {
      vertical: "REAL_ESTATE",
      dealType: "LONG_RENT",
      authorId: privateAuthor.id,
      title: "Студия 30 м² у метро, сдаётся посуточно и на длительный срок",
      description: "Новая мебель и техника. Постельное бельё и посуда предоставляются. Без комиссии для жильца.",
      category: "Квартиры",
      attrs: { rooms: 1, areaTotal: 30, floor: 3, floorsTotal: 9 },
      priceKopecks: 95_000_00,
      oldPriceKopecks: 105_000_00,
      cityId: spb.id,
      regionId: spb.regionId,
      districtName: "Василеостровский р-н",
      metroId: spb.metroLines[0]?.stations[0]?.id,
      metroWalkMin: 5,
      status: "PUBLISHED",
    },
    {
      vertical: "REAL_ESTATE",
      dealType: "DAILY_RENT",
      authorId: privateAuthor.id,
      title: "Апартаменты посуточно, центр города",
      description: "Двухуровневые апартаменты с панорамным остеклением. Подходит для командировок и туристов.",
      category: "Квартиры",
      attrs: { rooms: 2, areaTotal: 88, floor: 12, floorsTotal: 24, daily: true },
      priceKopecks: 6_500_00,
      cityId: novosibirsk.id,
      regionId: novosibirsk.regionId,
      districtName: "Центральный р-н",
      status: "PUBLISHED",
    },
    {
      vertical: "REAL_ESTATE",
      dealType: "SELL",
      authorId: agent.id,
      sellerId: sellers[1]?.id,
      title: "Дом 140 м² с участком 8 соток",
      description: "Газифицированный дом в закрытом посёлке. Гараж, баня, хозблок. Охраняемая территория.",
      category: "Дома и коттеджи",
      attrs: { areaTotal: 140, landArea: 8, buildingType: "газобетон", gas: true },
      priceKopecks: 14_500_000_00,
      cityId: ekb.id,
      regionId: ekb.regionId,
      districtName: "п. Большой Исток",
      status: "PUBLISHED",
    },
    {
      vertical: "REAL_ESTATE",
      dealType: "BUY",
      authorId: privateAuthor.id,
      title: "Куплю 1-комнатную квартиру в Казани",
      description: "Рассматриваю варианты до 7 млн ₽. Районы: Вахитовский, Советский. Собственник или агентство.",
      category: "Квартиры",
      attrs: { rooms: 1, maxBudgetKopecks: 700_000_000, intent: "buy" },
      priceKopecks: 7_000_000_00,
      cityId: kazan.id,
      regionId: kazan.regionId,
      status: "DRAFT",
    },

    // ===== АВТО =====
    {
      vertical: "AUTO",
      dealType: "SELL",
      authorId: agent.id,
      sellerId: sellers[0]?.id,
      title: "Toyota Camry, 2021, 2.5 AT, 41 000 км",
      description:
        "Один владелец, обслуживание у дилера. ДТП не было. Зимняя и летняя резина в комплекте.",
      category: "Автомобили",
      attrs: { brand: "Toyota", model: "Camry", year: 2021, mileage: 41000, transmission: "AT", engineVolume: 2.5 },
      priceKopecks: 3_450_000_00,
      oldPriceKopecks: 3_690_000_00,
      cityId: moscow.id,
      regionId: moscow.regionId,
      districtName: "ЮЗАО",
      status: "PUBLISHED",
      vin: "JT2BG28K0M0123456",
    },
    {
      vertical: "AUTO",
      dealType: "SELL",
      authorId: privateAuthor.id,
      title: "Lada Vesta SW, 2023, 1.6 MT",
      description: "Автомобиль на гарантии. Установлено ГБО. Зимние коврики и тёплый комплект в подарок.",
      category: "Автомобили",
      attrs: { brand: "Lada", model: "Vesta SW", year: 2023, mileage: 12800, transmission: "MT", engineVolume: 1.6 },
      priceKopecks: 1_580_000_00,
      cityId: spb.id,
      regionId: spb.regionId,
      status: "PUBLISHED",
      vin: "XTAGFK330M3456789",
    },
    {
      vertical: "AUTO",
      dealType: "SELL",
      authorId: privateAuthor.id,
      title: "BMW X5, 2019, 3.0d xDrive",
      description: "Панорамная крыша, подогрев всех сидений, проекционный дисплей. Возможен обмен.",
      category: "Внедорожники",
      attrs: { brand: "BMW", model: "X5", year: 2019, mileage: 78500, transmission: "AT", engineVolume: 3.0, drive: "xDrive" },
      priceKopecks: 4_900_000_00,
      cityId: novosibirsk.id,
      regionId: novosibirsk.regionId,
      status: "DRAFT",
      vin: "5UXCR6C0XK9876543",
    },

    // ===== УСЛУГИ =====
    {
      vertical: "SERVICE",
      dealType: "SERVICE_OFFER",
      authorId: agent.id,
      sellerId: sellers[2]?.id,
      title: "Ремонт стиральных машин на дому, выезд за 1 час",
      description: "Опыт 12 лет. Оригинальные запчасти. Гарантия на работу 12 месяцев. Выезд по городу бесплатный.",
      category: "Ремонт техники",
      attrs: { serviceType: "Ремонт техники", responseTimeHours: 1, warrantyMonths: 12, atHome: true },
      priceKopecks: 2_500_00,
      cityId: moscow.id,
      regionId: moscow.regionId,
      status: "PUBLISHED",
    },
    {
      vertical: "SERVICE",
      dealType: "SERVICE_OFFER",
      authorId: privateAuthor.id,
      title: "Разработка сайта под ключ, Tilda и Next.js",
      description: "Дизайн, вёрстка, SEO и подключение оплат. Портфолио из 40 проектов. Договор и закрывающие документы.",
      category: "IT и разработка",
      attrs: { serviceType: "IT и разработка", contractAvailable: true, portfolioCount: 40 },
      priceKopecks: 85_000_00,
      cityId: spb.id,
      regionId: spb.regionId,
      status: "PUBLISHED",
    },
    {
      vertical: "SERVICE",
      dealType: "SERVICE_REQUEST",
      authorId: privateAuthor.id,
      title: "Нужен дизайнер интерьера для квартиры 54 м²",
      description: "Ищу специалиста для полного проекта: планировка, визуализация, авторский надзор. Бюджет обсуждается.",
      category: "Дизайн интерьера",
      attrs: { serviceType: "Дизайн интерьера", areaTotal: 54, supervisionNeeded: true },
      priceKopecks: 120_000_00,
      cityId: kazan.id,
      regionId: kazan.regionId,
      status: "PUBLISHED",
    },
  ];

  let created = 0;
  for (const ad of ads) {
    const { vin, ...rest } = ad;
    const created_ad = await prisma.classified.create({
      data: { ...rest, attrs: JSON.stringify(rest.attrs), expiresAt: null },
    });
    created++;

    if (vin && ad.vertical === "AUTO") {
      const { createHash } = await import("node:crypto");
      await prisma.vinCheck.create({
        data: {
          classifiedId: created_ad.id,
          vin,
          vinHash: createHash("sha256").update(vin).digest("hex"),
          source: "OWN_SANDBOX",
          status: "NOT_CHECKED",
          verification: "NOT_PROVEN",
        },
      });
    }
  }

  console.log(`classifieds seed complete: ${created} listings`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
