/**
 * Светлана составляет карточку товара из того, что продавец написал своими
 * словами («кроссовки Nike Air Max 90, белые, 42 размер, новые, 7990 ₽»).
 *
 * Главное правило: ничего не выдумывать. Цену, бренд, размер, цвет и
 * остальные характеристики берём только из текста продавца. Живая модель
 * (если подключена) помогает красиво оформить, но её ответ проверяется:
 * - категория только из существующих;
 * - цена только если в тексте есть сумма;
 * - характеристика остаётся, только если её значение есть в тексте;
 * - описание с числами, которых нет в тексте, отбрасывается.
 * Без модели работают правила ниже. Карточка становится черновиком,
 * продавец проверяет её и публикует сам.
 */
import { aiGateway, aiMode, newTraceId } from "../ai/gateway";

export const MAX_COMPOSE_INPUT = 2000;
const MAX_ATTRS = 15;

export interface CategoryOption {
  slug: string;
  name: string;
}

export interface ProductComposition {
  title: string;
  description: string;
  priceRub?: number;
  categorySlug: string;
  keywords: string[];
  attributes: Record<string, string>;
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function parsePrice(t: string): number | undefined {
  const num = String.raw`(\d{1,3}(?:[\s\u00a0]\d{3})+|\d{2,9})`;
  const patterns = [
    new RegExp(`(?:цена|стоимость|за)[:\\s]*${num}`, "i"),
    new RegExp(`${num}\\s*(?:₽|руб|р\\.|р(?![а-я]))`, "i"),
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (!m) continue;
    const n = Number(m[1].replace(/[\s\u00a0]/g, ""));
    if (Number.isFinite(n) && n >= 1 && n <= 100_000_000) return n;
  }
  return undefined;
}

const COLORS: [RegExp, string][] = [
  [/бел(ый|ая|ое|ые|ого)/, "белый"],
  [/черн(ый|ая|ое|ые|ого)/, "чёрный"],
  [/красн(ый|ая|ое|ые)/, "красный"],
  [/син(ий|яя|ее|ие)/, "синий"],
  [/голуб(ой|ая|ое|ые)/, "голубой"],
  [/зелен(ый|ая|ое|ые)/, "зелёный"],
  [/сер(ый|ая|ое|ые)(?![а-я])/, "серый"],
  [/бежев(ый|ая|ое|ые)/, "бежевый"],
  [/розов(ый|ая|ое|ые)/, "розовый"],
  [/желт(ый|ая|ое|ые)/, "жёлтый"],
  [/коричнев(ый|ая|ое|ые)/, "коричневый"],
  [/фиолетов(ый|ая|ое|ые)/, "фиолетовый"],
  [/оранжев(ый|ая|ое|ые)/, "оранжевый"],
];

const MATERIALS: [RegExp, string][] = [
  [/натуральн(ая|ой) кож/, "натуральная кожа"],
  [/экокож/, "экокожа"],
  [/(^|[^а-я])кож(а|и|аный|аная|аные)/, "кожа"],
  [/хлоп(ок|ка|ковый|ковая|ковые)/, "хлопок"],
  [/шерст(ь|и|яной|яная|яные)/, "шерсть"],
  [/лен(?![а-я])|льнян/, "лён"],
  [/дерев(о|а|янный|янная|янные)|массив/, "дерево"],
  [/нержавейк|нержавеющ/, "нержавеющая сталь"],
  [/стекл(о|а|янный|янная|янные)/, "стекло"],
  [/керами/, "керамика"],
  [/пластик/, "пластик"],
  [/силикон/, "силикон"],
];

const STOP = new Set(["для", "или", "это", "как", "что", "без", "при", "все", "так", "продаю", "продам", "новый", "новая", "новое", "новые", "размер", "цена", "руб", "рублей", "штук", "есть", "очень", "почти", "состояние", "отличное", "хорошее"]);

/** Категория по словам из названия категории. Только из списка. */
export function matchCategory(text: string, categories: CategoryOption[]): string {
  const t = norm(text);
  let best = "";
  let bestScore = 0;
  for (const c of categories) {
    const words = norm(c.name).split(/[^a-zа-я0-9]+/).filter((w) => w.length >= 4);
    let score = 0;
    for (const w of words) {
      const stem = w.length > 5 ? w.slice(0, w.length - 2) : w;
      if (t.includes(stem)) score += stem.length;
    }
    if (score > bestScore) {
      best = c.slug;
      bestScore = score;
    }
  }
  return best;
}

function makeTitle(text: string): string {
  const line = text.split(/\n/).map((l) => l.trim()).find(Boolean) ?? "";
  let t = (line.split(/(?<=[.!?])\s/)[0] ?? line)
    .replace(/^(продаю|продам|продается|продаётся|в наличии)\s+/i, "")
    .replace(/[,;]?\s*(цена|стоимость|за)[:\s]*\d[\d\s]*\s*(₽|руб\.?|р\.?)?.*$/i, "")
    .replace(/[,;]?\s*\d[\d\s\u00a0]*\s*(₽|руб\.?|р\.)\s*$/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
  if (t.length > 120) t = `${t.slice(0, 117).replace(/\s+\S*$/, "")}…`;
  return t.length >= 3 ? cap(t) : "";
}

/** Правила без модели: только то, что есть в тексте. */
export function parseProductText(raw: string, categories: CategoryOption[]): ProductComposition {
  const text = raw.replace(/\r/g, "").trim().slice(0, MAX_COMPOSE_INPUT);
  const t = norm(text);
  const attributes: Record<string, string> = {};

  const brand = /(?:^|[\s,(«"])([A-Z][A-Za-z0-9&'.-]{1,24})(?=[\s,)»".]|$)/.exec(text);
  if (brand && !/^(XS|S|M|L|XL|XXL|XXXL|USB|LED|HD|TV|RU|EU|US|UK)$/.test(brand[1])) attributes["Бренд"] = brand[1];

  const size = /(?:размер|р-р|р\.)\s*[:-]?\s*(\d{2}(?:[.,]5)?|xxs|xs|s|m|l|xl|xxl|xxxl)(?![a-zа-я0-9])/i.exec(text) ?? /(\d{2}(?:[.,]5)?)\s*(?:-?(?:й|го))?\s*размер/i.exec(text);
  if (size) attributes["Размер"] = size[1].toUpperCase();

  const color = COLORS.find(([re]) => re.test(t));
  if (color) attributes["Цвет"] = color[1];

  const material = MATERIALS.find(([re]) => re.test(t));
  if (material) attributes["Материал"] = material[1];

  if (/(^|[^а-я])(б\/у|бу)(?![а-я])|ношен|носил|пользовал|с пробегом/.test(t)) attributes["Состояние"] = "б/у";
  else if (/(^|[^а-я])(нов(ый|ая|ое|ые|ую)|в упаковке|с бирк)/.test(t)) attributes["Состояние"] = "новый";

  const memory = /(\d{1,4})\s*(гб|gb|тб|tb)(?![a-zа-я])/i.exec(text);
  if (memory) attributes["Память"] = `${memory[1]} ${/т|t/i.test(memory[2]) ? "ТБ" : "ГБ"}`;
  const volume = /(\d+(?:[.,]\d+)?)\s*(мл|л)(?![а-я])/i.exec(text);
  if (volume) attributes["Объём"] = `${volume[1].replace(".", ",")} ${volume[2].toLowerCase()}`;
  const weight = /(\d+(?:[.,]\d+)?)\s*(кг|гр|г)(?![а-я])/i.exec(text);
  // «2021 г.» это год, а не вес.
  if (weight && !(/^г$/i.test(weight[2]) && Number(weight[1]) >= 1900 && Number(weight[1]) <= 2100)) attributes["Вес"] = `${weight[1].replace(".", ",")} ${weight[2].toLowerCase() === "гр" ? "г" : weight[2].toLowerCase()}`;
  const set = /набор\s+(?:из\s+)?(\d{1,3})/i.exec(text);
  if (set) attributes["Предметов в наборе"] = set[1];

  const title = makeTitle(text);
  const keywords = [...new Set(
    norm(title)
      .split(/[^a-zа-я0-9-]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)),
  )].slice(0, 10);
  if (attributes["Бренд"] && !keywords.includes(norm(attributes["Бренд"]))) keywords.unshift(norm(attributes["Бренд"]));

  // Короткий текст в одну строку: описание собираем из того же текста и
  // найденных характеристик, ничего не добавляя.
  const oneLine = !text.includes("\n") && text.length < 160;
  const attrLines = Object.entries(attributes).map(([k, v]) => `${k}: ${v}`);
  const description = oneLine && attrLines.length ? `${title}.\n\n${attrLines.join("\n")}` : text;

  return {
    title,
    description,
    priceRub: parsePrice(text),
    categorySlug: matchCategory(text, categories),
    keywords: keywords.slice(0, 10),
    attributes,
  };
}

/** Есть ли значение характеристики в тексте продавца (по основе слова или числу). */
export function valueInText(value: string, text: string): boolean {
  const t = norm(text);
  const v = norm(value).trim();
  if (!v) return false;
  const digits = v.match(/\d+/g);
  if (digits && digits.every((d) => t.includes(d))) return true;
  return v.split(/[^a-zа-я0-9]+/).filter((w) => w.length >= 2).some((w) => t.includes(w.length > 4 ? w.slice(0, 4) : w));
}

/** Числа в описании модели, которых нет в тексте продавца: признак выдумки. */
export function inventedNumbers(description: string, text: string): string[] {
  const source = new Set((text.replace(/[\s\u00a0](?=\d{3}(\D|$))/g, "").match(/\d+/g) ?? []));
  return (description.replace(/[\s\u00a0](?=\d{3}(\D|$))/g, "").match(/\d+/g) ?? []).filter((n) => !source.has(n));
}

/** Название модели годится, если в нём нет чисел и латинских слов (бренд, модель), которых нет в тексте. */
export function titleFromText(title: string, text: string): boolean {
  if (inventedNumbers(title, text).length > 0) return false;
  const t = norm(text);
  return (norm(title).match(/[a-z][a-z0-9-]*/g) ?? []).every((w) => t.includes(w));
}

/** Ответ модели поверх правил: берём только проверенное. */
export function mergeModelComposition(base: ProductComposition, model: Record<string, unknown>, text: string, categories: CategoryOption[]): ProductComposition {
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[ \t]+/g, " ").trim().slice(0, max) : "");
  const title = str(model.title, 120);
  const description = typeof model.description === "string" ? model.description.trim() : "";
  const slug = str(model.categorySlug, 100);
  const price = typeof model.priceRub === "number" ? model.priceRub : Number.NaN;

  const attributes: Record<string, string> = { ...base.attributes };
  if (model.attributes && typeof model.attributes === "object" && !Array.isArray(model.attributes)) {
    for (const [k, v] of Object.entries(model.attributes as Record<string, unknown>)) {
      const key = str(k, 40);
      const value = str(v, 100);
      if (!key || !value || Object.keys(attributes).length >= MAX_ATTRS) continue;
      if (valueInText(value, text)) attributes[cap(key)] = value;
    }
  }
  const keywords = Array.isArray(model.keywords)
    ? [...new Set(model.keywords.filter((k): k is string => typeof k === "string").map((k) => norm(k).trim()).filter((k) => k.length >= 2 && k.length <= 40))].slice(0, 15)
    : [];

  return {
    title: title.length >= 3 && titleFromText(title, text) ? title : base.title,
    description: description.length >= 20 && description.length <= 4000 && inventedNumbers(description, text).length === 0 ? description : base.description,
    // Цена только если в тексте есть сумма, и модель не может её поменять на чужую.
    priceRub: base.priceRub !== undefined && Number.isFinite(price) && price === base.priceRub ? price : base.priceRub,
    categorySlug: categories.some((c) => c.slug === slug) ? slug : base.categorySlug,
    keywords: keywords.length ? keywords : base.keywords,
    attributes,
  };
}

export async function composeProduct(raw: string, categories: CategoryOption[]): Promise<{ draft: ProductComposition; source: "model" | "rules" }> {
  const text = raw.slice(0, MAX_COMPOSE_INPUT);
  const base = parseProductText(text, categories);
  if (aiMode().mode !== "LIVE") return { draft: base, source: "rules" };
  try {
    const result = await aiGateway.complete({
      taskClass: "conversation",
      traceId: newTraceId("compose"),
      jsonMode: true,
      maxTokens: 1500,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: [
            "Ты Светлана, помощница площадки АИКО. Продавец описал товар своими словами. Составь карточку товара на русском.",
            "Главное правило: ничего не выдумывай. Цену, бренд, модель, размер, цвет, материал, комплектацию и состояние бери только из текста. Чего нет в тексте, того нет в ответе.",
            "Не добавляй гарантий, сертификатов, сроков доставки, скидок и обещаний, если их нет в тексте.",
            "title: название как в каталоге, до 120 символов: что это, бренд и модель, главная характеристика.",
            "description: 2-4 коротких абзаца для покупателя только из фактов текста. Без эмодзи, без восклицательных знаков.",
            "attributes: объект «характеристика: значение», только из текста. keywords: до 10 слов, по которым покупатель будет искать.",
            "categorySlug: один slug из списка ниже или пустая строка, если ни один не подходит.",
            "Ответ строго JSON: {\"title\": string, \"description\": string, \"priceRub\": number|null, \"categorySlug\": string, \"keywords\": string[], \"attributes\": object}.",
            "Категории (slug: название):",
            categories.slice(0, 200).map((c) => `${c.slug}: ${c.name}`).join("\n"),
          ].join("\n"),
        },
        { role: "user", content: text },
      ],
    });
    if (result.response.sandbox) return { draft: base, source: "rules" };
    const parsed = JSON.parse(result.response.content) as Record<string, unknown>;
    return { draft: mergeModelComposition(base, parsed, text, categories), source: "model" };
  } catch {
    return { draft: base, source: "rules" };
  }
}
