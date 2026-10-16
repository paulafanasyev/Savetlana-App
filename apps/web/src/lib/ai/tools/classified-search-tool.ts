/**
 * search_classifieds: Светлана ищет в разделе «Объявления» работу, резюме,
 * услуги и исполнителей (фриланс), жильё и машины. «Найди мне работу
 * водителем в Казани» → вакансии с «водител» в Казани. Модель может прислать
 * раздел словами («job», «работа») или не прислать вовсе: тогда раздел
 * понимаем по тексту запроса. Ничего не нашлось по словам: показываем свежие
 * объявления раздела и говорим, как разместить своё (резюме, заказ).
 */
import { searchClassifieds, searchCities, type PublicClassified } from "../../domains/classifieds";
import { classifiedIntent, classifiedSearchStems, normalizeDealType, normalizeVertical } from "../../classified-intent";
import type { ToolContext, ToolDefinition, ToolResult } from "./registry";
import { looseObjectSchema } from "./registry";

const LIMIT = 8;

const WHAT: Record<string, { many: string; none: string; post: string }> = {
  VACANCY: {
    many: "вакансий",
    none: "Подходящих вакансий пока нет",
    post: "Можно разместить резюме, и работодатели найдут вас сами: напишите «Составь резюме: кем хотите работать, опыт, зарплата» или откройте [форму резюме](/classifieds/new).",
  },
  RESUME: {
    many: "резюме",
    none: "Подходящих резюме пока нет",
    post: "Разместите вакансию, и соискатели откликнутся: [Разместить вакансию](/classifieds/new).",
  },
  SERVICE_OFFER: {
    many: "исполнителей и услуг",
    none: "Подходящих исполнителей пока нет",
    post: "Опишите задачу в объявлении «Нужна услуга», и исполнители напишут вам сами: [Разместить заказ](/classifieds/new).",
  },
  SERVICE_REQUEST: {
    many: "заказов",
    none: "Подходящих заказов пока нет",
    post: "Разместите объявление «Предлагаю услугу», чтобы заказчики находили вас сами: [Разместить услугу](/classifieds/new).",
  },
};

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function money(kopecks: number): string {
  return `${Math.round(kopecks / 100).toLocaleString("ru-RU")} ₽`;
}

function line(ad: PublicClassified): string {
  const price = ad.priceKopecks > 0 ? (ad.vertical === "JOB" ? `, от ${money(ad.priceKopecks)}` : `, ${money(ad.priceKopecks)}`) : "";
  return `[${ad.title}](/classifieds/${ad.id})${price}, ${ad.cityName}`;
}

async function byStems(base: Parameters<typeof searchClassifieds>[0], stems: string[]): Promise<PublicClassified[]> {
  const seen = new Map<string, PublicClassified>();
  // Поиск в базе различает регистр: ищем и «водител», и «Водител».
  for (const stem of stems) {
    for (const q of [stem, cap(stem)]) {
      const { items } = await searchClassifieds({ ...base, query: q, limit: LIMIT });
      for (const ad of items) if (!seen.has(ad.id)) seen.set(ad.id, ad);
      if (seen.size >= LIMIT) break;
    }
    if (seen.size >= LIMIT) break;
  }
  return [...seen.values()].slice(0, LIMIT);
}

export const smartSearchClassifiedsTool: ToolDefinition = {
  name: "search_classifieds",
  description:
    "Поиск в разделе «Объявления»: работа (вакансии и резюме), услуги и фриланс (исполнители и заказы), недвижимость и автомобили. " +
    "Используй, когда человек ищет работу или подработку, сотрудника, мастера, исполнителя, фрилансера, заказы для себя, жильё или машину. " +
    "Ищет работу: vertical=JOB, dealType=VACANCY. Ищет сотрудника: JOB, RESUME. Ищет исполнителя или услугу: SERVICE, SERVICE_OFFER. " +
    "Исполнитель ищет заказы: SERVICE, SERVICE_REQUEST. query: профессия или задача («водитель», «ремонт ванной»), cityName: город. Не для товаров каталога.",
  permission: "READ_PRODUCTS",
  riskLevel: "READ",
  needsConfirmation: false,
  parameters: looseObjectSchema({
    query: { type: "string", description: "профессия, задача или что ищут: «водитель», «логотип», «2-комнатная квартира»" },
    vertical: { type: "string", description: "JOB = работа, SERVICE = услуги и фриланс, REAL_ESTATE = недвижимость, AUTO = автомобили" },
    dealType: {
      type: "string",
      description: "VACANCY, RESUME, SERVICE_OFFER, SERVICE_REQUEST, SELL, LONG_RENT, DAILY_RENT, BUY_REQUEST",
    },
    cityName: { type: "string", description: "город, например Казань" },
    priceMaxRub: { type: "number", description: "максимальная цена в рублях (для работы не используется)" },
  }),
  async execute(_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const query = typeof args.query === "string" ? args.query.trim().slice(0, 200) : "";
    const cityName = typeof args.cityName === "string" ? args.cityName.trim() : "";
    const intent = classifiedIntent(query);
    const vertical = normalizeVertical(args.vertical) ?? intent.vertical;
    let dealType = normalizeDealType(args.dealType) ?? (vertical === intent.vertical ? intent.dealType : undefined);
    if (vertical === "JOB" && dealType !== "VACANCY" && dealType !== "RESUME") dealType = intent.dealType ?? "VACANCY";
    if (vertical === "SERVICE" && dealType !== "SERVICE_OFFER" && dealType !== "SERVICE_REQUEST") dealType = intent.dealType ?? "SERVICE_OFFER";

    let cityId: string | undefined;
    let cityLabel = "";
    if (cityName) {
      // «Казани», «Москве»: город в справочнике в именительном падеже, пробуем и основу слова.
      const stem = cityName.replace(/(?:ом|ой|ью|е|и|у|ы|а|я)$/i, "");
      for (const name of [cap(cityName), ...(stem.length >= 3 && stem !== cityName ? [cap(stem)] : [])]) {
        const found = await searchCities(name, 1).catch(() => []);
        if (found.length > 0) {
          cityId = found[0].id;
          cityLabel = found[0].name;
          break;
        }
      }
    }
    const priceMax = vertical !== "JOB" && Number(args.priceMaxRub) > 0 ? Math.round(Number(args.priceMaxRub) * 100) : undefined;
    const base = { vertical, dealType, cityId, priceMax };
    const stems = classifiedSearchStems(query, cityName ? [cityName] : []);

    let items = stems.length ? await byStems(base, stems) : (await searchClassifieds({ ...base, limit: LIMIT })).items;
    let broadened = false;
    if (items.length === 0 && stems.length) {
      items = (await searchClassifieds({ ...base, limit: LIMIT })).items;
      broadened = items.length > 0;
    }

    const what = (dealType && WHAT[dealType]) || { many: "объявлений", none: "Подходящих объявлений пока нет", post: "Можно разместить своё: [Разместить объявление](/classifieds/new)." };
    const where = cityLabel ? ` в городе ${cityLabel}` : "";
    const browse = `/classifieds?${new URLSearchParams({ ...(vertical ? { vertical } : {}), ...(dealType ? { dealType } : {}), ...(cityId ? { cityId } : {}) }).toString()}`;

    if (items.length === 0) {
      return {
        ok: true,
        data: { items: [], vertical, dealType, browse },
        summary: `${what.none}${where}${stems.length ? ` по запросу «${query}»` : ""}. ${what.post}`,
        verification: "VERIFIED",
      };
    }
    const head = broadened
      ? `По запросу «${query}»${where} точных совпадений нет. Вот свежие из раздела, ${what.many}: ${items.length}:`
      : `Нашла ${what.many}${where}: ${items.length}:`;
    return {
      ok: true,
      data: {
        vertical,
        dealType,
        browse,
        items: items.map((ad) => ({
          classifiedId: ad.id,
          url: `/classifieds/${ad.id}`,
          title: ad.title,
          priceKopecks: ad.priceKopecks,
          city: ad.cityName,
          dealType: ad.dealType,
          seller: ad.sellerDisplayName ?? ad.authorName,
        })),
      },
      summary: `${head}\n${items.map((ad) => `• ${line(ad)}`).join("\n")}\nВсе объявления раздела: [открыть](${browse}).`,
      verification: "VERIFIED",
    };
  },
};
