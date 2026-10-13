/**
 * Встроенный движок Светланы (работает прямо на сайте, без внешних сервисов).
 *
 * Используется, когда внешняя модель не подключена, и в тестах. Это не
 * языковая модель, а разбор намерений по правилам: он понимает основные
 * запросы покупателя и продавца, отвечает на частые вопросы о площадке и
 * вызывает те же инструменты, что и внешняя модель, поэтому все действия
 * (поиск, заказы, карточки) идут по реальным данным сайта. Каждый ответ
 * помечен sandbox: true, чтобы отчёты честно отличали его от внешней модели.
 */
import type {
  AiCompleteRequest,
  AiCompleteResponse,
  AiEmbeddingRequest,
  AiEmbeddingResponse,
  AiProvider,
  AiTaskClass,
} from "../types";
import { DELIVERY_OPTIONS } from "../../delivery-options";

interface IntentRule {
  id: string;
  pattern: RegExp;
  tool?: string;
  args: (match: RegExpMatchArray) => Record<string, unknown>;
  reply: (match: RegExpMatchArray) => string;
}

interface FaqRule {
  id: string;
  pattern: RegExp;
  answer: () => string;
}

// Numbers in Russian text: "до 100 тысяч", "100000", "10 000"
function parseBudget(text: string): number | undefined {
  const m =
    /(?:до|не дороже|бюджет(?:ом)?|в пределах)\s*([0-9][0-9\s]{0,12})\s*(тыс|тысяч|тысячи|млн|руб|рублей|₽)?/i.exec(
      text
    ) ?? /([0-9]{4,7})\s*(руб|рублей|₽)?/i.exec(text);
  if (!m) return undefined;
  const raw = Number(m[1].replace(/\s/g, ""));
  if (!Number.isFinite(raw)) return undefined;
  const unit = (m[2] ?? "").toLowerCase();
  if (unit.startsWith("тыс")) return raw * 1000;
  if (unit.startsWith("млн")) return raw * 1_000_000;
  return raw;
}

/** Убирает из запроса бюджет: «чайник до 3000 рублей» → «чайник». */
function stripBudget(text: string): string {
  return text
    .replace(/(?:до|не дороже|дешевле|в пределах|бюджет(?:ом)?)\s*[0-9][0-9\s]*\s*(?:тыс\S*|млн|руб\S*|р\.|₽)?/gi, " ")
    .replace(/[?!.,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const FILLER_WORDS = new Set([
  "мне", "пожалуйста", "please", "с", "со", "и", "или", "в", "на", "для", "по", "из", "у", "о", "об",
  "самой", "самый", "самая", "самое", "самым", "самую", "лучшим", "лучший", "лучшая", "лучшую", "лучше",
  "дешёвой", "дешевой", "дешёвый", "дешевый", "недорогой", "недорогие", "стоимостью", "ценой", "цене",
  "рейтингом", "рейтинг", "магазина", "магазин", "какой-нибудь", "какие-нибудь", "нужен", "нужна", "нужны",
  "хороший", "хорошие", "хорошую", "качественный", "качественные",
]);

/** Оставляет в запросе только суть: «кроссовки Nike с самой дешёвой стоимостью» → «кроссовки Nike». */
function coreQuery(text: string): string {
  const words = stripBudget(text)
    .replace(/[«»"'!?.,;:()]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER_WORDS.has(w.toLowerCase()));
  return words.slice(0, 4).join(" ");
}

/** «Создай карточку товара кроссовки Nike за 9990» → { title: "Кроссовки Nike", priceRub: 9990 }. */
export function draftArgs(text: string): { title?: string; priceRub?: number } {
  const rest = /(?:карточк\S*|объявлени\S*|товар)\s+(?:товара\s+|на\s+)?(.+)/i.exec(text)?.[1] ?? "";
  const priceMatch = /(?:за|цена|по цене|стоимость(?:ю)?)\s*([0-9][0-9\s]*)\s*(?:₽|руб\S*|р\.?)?/i.exec(rest);
  const priceRub = priceMatch ? Number(priceMatch[1].replace(/\s/g, "")) : undefined;
  const rawTitle = (priceMatch ? rest.slice(0, priceMatch.index) : rest).replace(/[«»"'.,!?:;]+/g, " ").replace(/\s+/g, " ").trim();
  const title = rawTitle.length > 2 ? rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1) : undefined;
  return { title, priceRub: priceRub && Number.isFinite(priceRub) && priceRub > 0 ? priceRub : undefined };
}

function rubles(kopecks: number): string {
  return `${Math.round(kopecks / 100).toLocaleString("ru-RU")} ₽`;
}

function deliveryText(): string {
  const lines = DELIVERY_OPTIONS.map(
    (o) => `• ${o.label}: ${o.priceKopecks === 0 ? "бесплатно" : rubles(o.priceKopecks)}. ${o.hint}.`
  );
  return [
    "Способ доставки вы выбираете при оформлении заказа:",
    ...lines,
    "Цена доставки входит в сумму заказа до оплаты и потом не меняется.",
  ].join("\n");
}

/**
 * Частые вопросы о площадке. Ответы описывают то, как сайт работает на самом
 * деле, поэтому для них не нужен ни внешний сервис, ни инструмент.
 */
const FAQ_RULES: FaqRule[] = [
  {
    id: "faq_capabilities",
    pattern: /(?:что ты умеешь|что умеешь|что ты можешь|что вы умеете|что вы можете|чем (?:ты |вы )?(?:можешь|можете) помочь|кто ты|кто вы такая|как с тобой работать)/i,
    answer: () =>
      [
        "Я Светлана, помощник этой площадки. Вот что я умею:",
        "• найти товар: напишите, например, «чайник до 3000 рублей»;",
        "• сравнить товары и показать, что пишут в отзывах;",
        "• подобрать подарок;",
        "• рассказать, где ваш заказ и что с оплатой;",
        "• объяснить доставку, оплату и возврат.",
        "Продавцам помогаю с карточками, ценами, наличием, покупателями и разбором продаж, и подскажу, как закупать товар в Китае.",
      ].join("\n"),
  },
  {
    id: "faq_delivery",
    pattern: /(?:способ\S* доставки|как(?:ая|ие)? (?:есть )?доставк|сколько стоит доставк|стоимость доставки|цена доставки|условия доставки|самовывоз|доставляете|есть ли доставка|как работает доставка)/i,
    answer: deliveryText,
  },
  {
    id: "faq_payment",
    pattern: /(?:как оплатить|способ\S* оплаты|чем (?:можно )?оплатить|как (?:происходит|проходит|работает) оплата|когда (?:нужно )?платить|безопасно ли (?:платить|оплачивать))/i,
    answer: () =>
      "Заказ оплачивается на странице заказа сразу после оформления: картой или через СБП. Деньги продавцу площадка переводит только после того, как заказ получен, поэтому до получения ваши деньги защищены. Неоплаченный заказ можно отменить в разделе «Мои заказы».",
  },
  {
    id: "faq_cancel",
    pattern: /(?:как отменить заказ|отменить заказ|отмени(?:те)? (?:мой )?заказ|отмена заказа)/i,
    answer: () =>
      "Откройте заказ в разделе «Мои заказы». Пока заказ не оплачен, там есть кнопка «Отменить заказ». Если заказ уже оплачен и что-то пошло не так, нажмите «Открыть спор»: площадка разберётся, и при отмене деньги вернутся.",
  },
  {
    id: "faq_return",
    pattern: /(?:как вернуть|вернуть товар|возврат товара|оформить возврат|обмен(?:ять)? товар|товар не пришёл|товар не пришел|пришёл брак|пришел брак|не тот товар)/i,
    answer: () =>
      "Откройте заказ в разделе «Мои заказы». Если заказ уже получен, нажмите «Оформить возврат» и укажите причину. Если товар не пришёл, пришёл с браком или продавец не отвечает, нажмите «Открыть спор» и опишите проблему: пока спор открыт, продавец не получает деньги, а решение принимает площадка.",
  },
  {
    id: "faq_become_seller",
    pattern: /(?:как стать продавцом|стать продавцом|хочу продавать|как начать продавать|как продавать|как разместить товар|как выставить товар|как добавить товар)/i,
    answer: () =>
      "Зарегистрируйтесь и откройте «Кабинет продавца». Заполните анкету (ИНН, для компании и ОГРН): площадка проверит её вручную. После одобрения добавьте товар: название, цена, фото и остаток. Без фото и остатка карточку опубликовать нельзя, чтобы покупатели не заказывали то, чего нет.",
  },
  {
    id: "faq_checkout",
    pattern: /(?:как оформить заказ|как купить|как сделать заказ|как заказать|как положить в корзину)/i,
    answer: () =>
      "Откройте товар и нажмите «В корзину» (если есть варианты, сначала выберите нужный). Затем в корзине нажмите «Оформить», выберите самовывоз или доставку продавцом, проверьте сумму и оплатите заказ.",
  },
  {
    id: "faq_cheaper_alone",
    pattern: /^\s*(?:а\s+)?(?:есть\s+)?(?:что-нибудь\s+|что-то\s+)?(?:подешевле|дешевле|недорого|бюджетнее)(?:\s+есть)?\s*[?!.]*\s*$/i,
    answer: () =>
      "Подскажите, что именно ищем, и я найду варианты дешевле. Например: «наушники дешевле 5000» или «кроссовки подешевле».",
  },
  {
    id: "faq_trust",
    pattern: /(?:это безопасно|можно ли доверять|гаранти[ия] |мошенн|как проверяют продавц)/i,
    answer: () =>
      "Каждого продавца площадка проверяет вручную по анкете перед тем, как он сможет продавать. Деньги продавец получает только после того, как покупатель получил заказ. Если что-то не так, откройте спор на странице заказа.",
  },
];

const INTENT_RULES: IntentRule[] = [
  {
    // Закупка за рубежом и перепродажа: ищем по внешним площадкам, а не только в каталоге.
    id: "global_sourcing",
    pattern: /(?:в кита|китай|1688|alibaba|алибаб|taobao|таобао|aliexpress|алиэкспресс|оптом|закуп|поставщик|перепрод)/i,
    tool: "global_search",
    args: (m) => {
      const text = String(m.input ?? "");
      // Сначала отрезаем «в Китае, хочу …», потом берём то, что после глагола поиска.
      const head = text.replace(/(?:в кита\S*|на 1688|на alibaba|на taobao|на aliexpress|оптом|для перепрод\S*).*$/i, "");
      const product = /(?:найти|найд(?:и|ите)|ищу|купить)\s+(.*)/i.exec(head)?.[1] ?? head;
      return { query: coreQuery(product) || text.trim(), tier: 2 };
    },
    reply: () => "Ищу предложения на зарубежных площадках и сравниваю цены и рейтинг продавцов.",
  },
  {
    id: "seller_customers",
    pattern: /(?:мои покупатели|мои клиенты|моих покупателей|моих клиентов|постоянн\S* (?:покупател|клиент)|лучши\S* (?:покупател|клиент)|база клиентов|\bcrm\b|срм|повторн\S* покуп|кто (?:у меня )?покупает)/i,
    tool: "seller_customers",
    args: () => ({}),
    reply: () => "Смотрю ваших покупателей: кто возвращается, кто давно не заказывал.",
  },
  {
    id: "seller_orders",
    pattern: /(?:заказы (?:от )?покупател|заказы клиент|новые заказы|что (?:у меня )?заказали|кто (?:у меня )?заказал|заказы (?:в|моего) магазин)/i,
    tool: "get_order",
    args: () => ({ scope: "seller" }),
    reply: () => "Смотрю заказы ваших покупателей.",
  },
  {
    id: "seller_pricing",
    pattern: /(?:какую цену|по какой цене (?:продавать|выставить|ставить)|сколько (?:мне )?(?:ставить|поставить)|посоветуй(?:те)? цену|совет по цене|цен[ауы]? (?:на|для) (?:мо|сво)|переоцен|стоит ли (?:снижать|поднимать) цен)/i,
    tool: "advise_price",
    args: () => ({}),
    reply: () => "Сравниваю вашу цену с рынком и подскажу, что с ней сделать.",
  },
  {
    id: "seller_search",
    pattern: /(?:найд(?:и|ите)|покаж(?:и|ите)|ищу)\s+(?:продавца|продавцов|магазин|магазины)(.*)?/i,
    tool: "search_sellers",
    args: (m) => ({ query: (m[1] ?? "").trim() }),
    reply: (m) => `Ищу продавцов: ${(m[1] ?? "").trim()}. Покажу проверку, рейтинг и историю работы на площадке.`,
  },
  {
    id: "product_search",
    pattern: /(?:помоги(?:те)? найти|найти|найд(?:и|ите)|покаж(?:и|ите)|ищу|хочу купить|хочу|подбер(?:и|ите)|подобрать|выбрать|подскаж(?:и|ите)|посоветуй(?:те)?)\s+(.*)/i,
    tool: "search_products",
    args: (m) => {
      const rest = m[1] ?? "";
      return { query: coreQuery(rest) || rest.trim(), budget: parseBudget(rest) };
    },
    reply: (m) => `Ищу по запросу «${(m[1] ?? "").trim()}».`,
  },
  {
    id: "gift_request",
    pattern: /(?:подар(?:ок|ить|ю)|подобрать подарок)[^.!?]{0,140}/i,
    tool: "plan_gift",
    args: (m) => {
      const raw = (m[0] ?? "").trim();
      return {
        occasion: "custom",
        recipientName: guessRecipient(raw),
        note: raw,
        budget: parseBudget(raw),
      };
    },
    reply: (m) => `Подбираю подарок: ${(m[0] ?? "").trim()}. Учту интересы, бюджет и прошлые подарки.`,
  },
  {
    id: "order_tracking",
    pattern: /(где (мой )?заказ|статус заказа|мои заказы|отслед(?:и|ить)|доставк[аеуи])\s*(.*)?/i,
    tool: "get_order",
    args: () => ({ mine: true }),
    reply: () => "Проверяю статус ваших заказов и доставок по реальным данным.",
  },
  {
    id: "review_analysis",
    pattern: /(?:что говорят|отзывы|отзыв|какие плюсы|какие минусы|недостатки|стоит ли брать)\s*(.*)?/i,
    tool: "get_reviews",
    args: (m) => ({ query: (m[1] ?? "").trim() }),
    reply: (m) => `Смотрю отзывы: ${(m[1] ?? "").trim() || "повторяющиеся плюсы, жалобы и общий тон"}.`,
  },
  {
    id: "seller_sales_drop",
    pattern: /(?:почему|из-за чего).*(?:упали|плохо прода|снизил).*(?:продаж|заказ)|(?:как (?:мои )?продажи|что с продажами|разбери продажи)/i,
    tool: "analyze_seller_sales",
    args: () => ({}),
    reply: () => "Разбираю продажи: просмотры, конверсию, цену, конкурентов, отзывы и наличие.",
  },
  {
    id: "seller_competitors",
    pattern: /(конкурент|конкуренты|сопостав|сравни с конкурентами)\s*(.*)?/i,
    tool: "find_competitors",
    args: (m) => ({ scope: (m[2] ?? "").trim() || "catalog" }),
    reply: () => "Ищу конкурирующие предложения по данным каталога.",
  },
  {
    id: "confirm_availability",
    pattern: /(?:подтверд(?:и|ить)|подтверждаю).*(?:наличи[еяи]|в наличии)/i,
    tool: "confirm_inventory",
    args: () => ({}),
    reply: () => "Подтверждаю наличие товара и продлеваю размещение.",
  },
  {
    id: "create_product_draft",
    pattern: /(?:создай|сделай|оформи|выложи).*(?:карточку|товар|объявление)/i,
    tool: "create_product_draft",
    args: (m) => draftArgs(String(m.input ?? "")),
    reply: (m) => {
      const title = draftArgs(String(m.input ?? "")).title;
      return title ? `Готовлю черновик карточки «${title}». Публикация останется за вами.` : "Готовлю черновик карточки. Публикация останется за вами.";
    },
  },
  {
    id: "compare",
    pattern: /(?:сравни|сравнение)\s+(.*)/i,
    tool: "compare_products",
    args: (m) => ({ query: (m[1] ?? "").trim() }),
    reply: (m) => `Сравниваю варианты по запросу «${(m[1] ?? "").trim()}»: цену, характеристики, продавца и доставку.`,
  },
  {
    id: "cheaper",
    pattern: /(?:дешевле|подешевле|недорого|дешевый|дешёвый|бюджетный)/i,
    tool: "search_cheaper",
    args: (m) => {
      const text = String(m.input ?? "");
      const query = coreQuery(stripBudget(text).replace(/(?:найди|найти|покажи|есть|что-нибудь|что-то|подешевле|дешевле|недорого|дешёвый|дешевый|бюджетный|аналог\S*)/gi, " "));
      return { query: query || undefined, maxPrice: parseBudget(text) };
    },
    reply: () => "Ищу более доступные аналоги с учётом доставки и продавца.",
  },
];


/**
 * Recipient extraction for the gift intent: "подарок маме", "подари папе",
 * "для друга". Returns null when nothing plausible is found — the tool then
 * asks back rather than inventing a recipient (zero-hallucination policy).
 */
const RECIPIENT_ROLES: Record<string, string> = {
  маме: "мама", маму: "мама", мамой: "мама",
  папе: "папа", папу: "папа", папой: "папа",
  сестре: "сестра", сестру: "сестра",
  брату: "брат", брата: "брат",
  бабушке: "бабушка", дедушке: "дедушка",
  жене: "жена", мужу: "муж",
  другу: "друг", подруге: "подруга",
  коллеге: "коллега",
  ребёнку: "ребёнок", ребенку: "ребёнок", детям: "ребёнок",
  сыну: "сын", дочери: "дочь", дочке: "дочь",
  внуку: "внук", внучке: "внучка", мальчику: "мальчик", девочке: "девочка",
};
function guessRecipient(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [key, label] of Object.entries(RECIPIENT_ROLES)) {
    if (lower.includes(key)) return label;
  }
  return null;
}

const GREETING = /^(?:привет|здравствуй|здравствуйте|добрый день|доброе утро|добрый вечер|hi|hello)(?:[\s,!.]|$)/i;
const THANKS = /(?:спасибо|благодарю|спс)/i;
const QUESTION_START = /^(?:как|почему|зачем|когда|где|кто|что|можно|сколько|какой|какая|какие|есть ли)(?:\s|$)/i;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Короткая фраза без вопроса чаще всего и есть название товара:
 * «чайник», «кроссовки 42», «наушники до 5000». Её ищем в каталоге.
 */
function looksLikeProductQuery(text: string): boolean {
  const trimmed = text.trim();
  const words = wordCount(trimmed);
  if (words < 1 || words > 6) return false;
  if (!/[a-zа-яё]/i.test(trimmed)) return false;
  if (QUESTION_START.test(trimmed)) return false;
  return true;
}

interface ItemLike {
  title?: unknown;
  priceKopecks?: unknown;
  seller?: unknown;
}

function listItems(data: unknown): string | null {
  const raw = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)
      ? (data as { items: unknown[] }).items
      : data && typeof data === "object" && Array.isArray((data as { hits?: unknown }).hits)
        ? (data as { hits: unknown[] }).hits
        : null;
  if (!raw || raw.length === 0) return null;
  const rows = (raw as ItemLike[])
    .filter((item) => typeof item?.title === "string" && typeof item?.priceKopecks === "number")
    .slice(0, 3)
    .map((item) => `• «${item.title as string}» за ${rubles(item.priceKopecks as number)}${typeof item.seller === "string" ? `, продавец ${item.seller}` : ""}`);
  if (rows.length === 0) return null;
  return rows.join("\n");
}

interface GlobalSearchData {
  tier?: number;
  platformCount?: number;
  externalCount?: number;
  liveExternal?: boolean;
  hits?: unknown[];
}

/**
 * Ответ на поиск поставщиков за рубежом. Если зарубежные площадки не
 * подключены, Светлана честно говорит об этом (цены оттуда не выдумывает),
 * показывает, что есть на нашей площадке, и даёт план закупки.
 */
export function sourcingAnswer(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as GlobalSearchData;
  if (typeof d.externalCount !== "number" || typeof d.platformCount !== "number") return null;
  const items = listItems({ hits: (d.hits ?? []).filter((h) => (h as { source?: string })?.source !== "external") });
  const external = listItems({ hits: (d.hits ?? []).filter((h) => (h as { source?: string })?.source === "external") });
  const lines: string[] = [];
  if (d.liveExternal && external) {
    lines.push("Вот самые выгодные предложения на зарубежных площадках:", external);
  } else {
    lines.push("Прямого подключения к 1688, Taobao и AliExpress у площадки пока нет, поэтому цены и рейтинги оттуда я не выдумываю.");
  }
  lines.push(
    d.platformCount > 0 && items
      ? `У нас на площадке уже есть похожие предложения (${d.platformCount}), с ними вы будете конкурировать:\n${items}`
      : "На нашей площадке похожих предложений пока нет, так что ниша свободна."
  );
  lines.push(
    "Как выбрать поставщика в Китае:",
    "1. Ищите на 1688 или Alibaba с отметкой проверенного поставщика (Verified, Gold Supplier) и стажем от 3 лет, смотрите рейтинг магазина и долю повторных покупок.",
    "2. Сравните несколько поставщиков, попросите видео товара и закажите образец до партии.",
    "3. Посчитайте себестоимость: цена + доставка в Россию + пошлина и НДС, затем сравните с ценами здесь. Я помогу с наценкой, когда будете создавать карточку.",
    "4. Для брендов (Nike, Adidas и других) нужен договор или разрешение правообладателя: товар без этого считается контрафактом, и продавать его здесь нельзя. Обувь также подлежит маркировке «Честный знак».",
    "Когда выберете товар, напишите «создай карточку товара … за … рублей», и я подготовлю черновик."
  );
  return lines.join("\n");
}

export class MockAiProvider implements AiProvider {
  readonly key = "mock";
  readonly displayName = "sandbox-rule-engine";
  readonly sandbox = true;
  readonly available = true;

  async complete(request: AiCompleteRequest): Promise<AiCompleteResponse> {
    const started = Date.now();
    const ordered = [...request.messages].reverse();
    const lastUserMessage = ordered.find((m) => m.role === "user");
    const text = lastUserMessage?.content ?? "";

    // After tool results, the conversation must converge on an answer: the
    // model reacts to the data instead of re-decoding the original intent.
    const lastIsTool = ordered[0]?.role === "tool";
    if (lastIsTool) {
      const toolPayload = ordered[0]?.content ?? "";
      return this.respond(request, this.summarizeToolResult(toolPayload));
    }

    if (GREETING.test(text.trim()) && wordCount(text) <= 4) {
      return this.respond(request, "Здравствуйте! Я Светлана. Помогу найти товар, выбрать подарок, оформить карточку или разобраться с продажами. Что вас интересует?");
    }
    if (THANKS.test(text) && wordCount(text) <= 4) {
      return this.respond(request, "Пожалуйста! Обращайтесь, если понадобятся ещё варианты.");
    }

    for (const faq of FAQ_RULES) {
      if (faq.pattern.test(text)) {
        const answer = faq.answer();
        if (request.jsonMode) {
          return this.respond(request, JSON.stringify({ intent: faq.id, confidence: 0.9, reply: answer }));
        }
        return this.respond(request, answer);
      }
    }

    for (const rule of INTENT_RULES) {
      const match = rule.pattern.exec(text);
      if (match) {
        if (request.jsonMode) {
          return this.respond(
            request,
            JSON.stringify({
              intent: rule.id,
              confidence: 0.9,
              tool: rule.tool,
              arguments: rule.args(match),
              reply: rule.reply(match),
            })
          );
        }
        // Emit a tool call so the agent loop is exercised end-to-end offline.
        return this.respond(request, rule.reply(match), [
          {
            id: `call_${rule.id}_${started}`,
            name: rule.tool as string,
            arguments: rule.args(match),
          },
        ]);
      }
    }

    if (!request.jsonMode && looksLikeProductQuery(text)) {
      const query = stripBudget(text) || text.trim();
      return this.respond(request, `Ищу «${query}» в каталоге.`, [
        {
          id: `call_short_search_${started}`,
          name: "search_products",
          arguments: { query, budget: parseBudget(text) },
        },
      ]);
    }

    return this.respond(
      request,
      request.jsonMode
        ? JSON.stringify({ intent: "unknown", confidence: 0.2, reply: "Не уверен, что понял задачу. Уточните, пожалуйста." })
        : "Опишите задачу подробнее: что ищем, для кого, какой бюджет и какие сроки доставки важны. Можно просто написать название товара, например «чайник до 3000 рублей»."
    );
  }

  /**
   * Turns a tool result into the answer the user reads. It reports only what
   * the tool actually returned — an ok:false result is relayed as a failure,
   * never as success (spec §58).
   */
  private summarizeToolResult(payload: string): string {
    try {
      const result = JSON.parse(payload) as { ok?: boolean; summary?: string; error?: string; data?: unknown };
      if (result.ok === false) {
        return `Не получилось: ${result.error ?? "причина неизвестна"}. Давайте попробуем иначе.`;
      }
      const sourcing = sourcingAnswer(result.data);
      if (sourcing) return sourcing;
      const summary = result.summary ?? "Готово, данные получены.";
      const items = listItems(result.data);
      return items ? `${summary}\n${items}` : summary;
    } catch {
      return "Готово, данные получены.";
    }
  }

  private respond(
    request: AiCompleteRequest,
    content: string,
    toolCalls?: AiCompleteResponse["toolCalls"]
  ): AiCompleteResponse {
    return {
      content,
      toolCalls,
      provider: this.key,
      model: "sandbox-rule-engine",
      latencyMs: 1,
      sandbox: true,
      finishReason: "stop",
    };
  }
}

/**
 * Task-class aware mock: keeps a tiny deterministic "embedding" so the vector
 * search layer has something real to test against without a model.
 */
export class MockEmbeddingProvider implements AiProvider {
  readonly key = "mock-embedding";
  readonly displayName = "sandbox-hashing-embedding";
  readonly sandbox = true;
  readonly available = true;

  async complete(request: AiCompleteRequest): Promise<AiCompleteResponse> {
    throw new Error("Embedding provider cannot answer chat requests");
  }

  async embed(request: AiEmbeddingRequest): Promise<AiEmbeddingResponse> {
    const started = Date.now();
    return {
      vectors: request.texts.map((text) => hashEmbedding(text)),
      provider: this.key,
      model: "sandbox-hashing-embedding",
      sandbox: true,
      latencyMs: Date.now() - started,
    };
  }
}

/**
 * Deterministic 64-dimensional embedding from a hash of character n-grams.
 * Not semantic quality — it gives the vector layer stable, testable vectors
 * (identical input always yields identical output).
 */
const EMBED_DIM = 64;

export function hashEmbedding(text: string): number[] {
  const vec = new Array(EMBED_DIM).fill(0);
  const normalized = text.toLowerCase().replace(/[^a-zа-я0-9 ]/gi, "");
  for (let i = 0; i < normalized.length - 2; i++) {
    const trigram = normalized.slice(i, i + 3);
    let hash = 0;
    for (let j = 0; j < trigram.length; j++) {
      hash = (hash * 31 + trigram.charCodeAt(j)) % 9973;
    }
    vec[Math.abs(hash) % EMBED_DIM] += 1;
  }
  // L2 normalize
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export const MOCK_TASK_CLASSES: AiTaskClass[] = [
  "classification",
  "search_intent",
  "reasoning",
  "conversation",
  "safety",
];
