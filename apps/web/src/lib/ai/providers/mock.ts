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
        "Продавцам помогаю с карточками, ценами, наличием и разбором продаж.",
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
      "Заказ оплачивается картой на странице заказа сразу после оформления. Продавец получает деньги только после того, как вы получили заказ, поэтому до получения ваши деньги защищены. Неоплаченный заказ можно отменить в разделе «Мои заказы».",
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
      "Откройте заказ в разделе «Мои заказы» и нажмите «Открыть спор». Опишите проблему и приложите фото, если есть. Пока спор открыт, продавец не получает деньги за этот заказ, а решение по возврату принимает площадка.",
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
    id: "faq_trust",
    pattern: /(?:это безопасно|можно ли доверять|гаранти[ия] |мошенн|как проверяют продавц)/i,
    answer: () =>
      "Каждого продавца площадка проверяет вручную по анкете перед тем, как он сможет продавать. Деньги продавец получает только после того, как покупатель получил заказ. Если что-то не так, откройте спор на странице заказа.",
  },
];

const INTENT_RULES: IntentRule[] = [
  {
    id: "seller_search",
    pattern: /(?:найд(?:и|ите)|покаж(?:и|ите)|ищу)\s+(?:продавца|продавцов|магазин|магазины)(.*)?/i,
    tool: "search_sellers",
    args: (m) => ({ query: (m[1] ?? "").trim() }),
    reply: (m) => `Ищу продавцов: ${(m[1] ?? "").trim()}. Покажу проверку, рейтинг и историю работы на площадке.`,
  },
  {
    id: "product_search",
    pattern: /(?:найд(?:и|ите)|покаж(?:и|ите)|ищу|хочу купить|хочу|подбер(?:и|ите)|подобрать|выбрать|посоветуй(?:те)?)\s+(.*)/i,
    tool: "search_products",
    args: (m) => {
      const rest = m[1] ?? "";
      return { query: stripBudget(rest) || rest.trim(), budget: parseBudget(rest) };
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
    args: () => ({}),
    reply: () => "Готовлю черновик карточки товара по фотографии. Публикация останется за вами.",
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
    args: () => ({}),
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
      : null;
  if (!raw || raw.length === 0) return null;
  const rows = (raw as ItemLike[])
    .filter((item) => typeof item?.title === "string" && typeof item?.priceKopecks === "number")
    .slice(0, 3)
    .map((item) => `• «${item.title as string}» за ${rubles(item.priceKopecks as number)}${typeof item.seller === "string" ? `, продавец ${item.seller}` : ""}`);
  if (rows.length === 0) return null;
  return rows.join("\n");
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
