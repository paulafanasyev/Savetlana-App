/**
 * Deterministic MOCK provider (sandbox).
 *
 * Used when AI_GATEWAY_API_KEY is absent, and in tests. It is a rule-based
 * intent processor, NOT a language model. Every response it produces carries
 * sandbox: true and must be reported as MOCK VERIFIED, never VERIFIED.
 *
 * It is deliberately good at the handful of commerce intents the platform
 * needs, so the agent orchestration layer is fully exercisable offline.
 */
import type {
  AiCompleteRequest,
  AiCompleteResponse,
  AiEmbeddingRequest,
  AiEmbeddingResponse,
  AiProvider,
  AiTaskClass,
} from "../types";

interface IntentRule {
  id: string;
  pattern: RegExp;
  tool?: string;
  args: (match: RegExpMatchArray) => Record<string, unknown>;
  reply: (match: RegExpMatchArray) => string;
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

const INTENT_RULES: IntentRule[] = [
  {
    id: "seller_search",
    pattern: /(?:найд[и|ите]|покаж[и|ите]|ищу)\s+(?:продавца|продавцов|магазин|магазины)(.*)?/i,
    tool: "search_sellers",
    args: (m) => ({ query: (m[1] ?? "").trim() }),
    reply: (m) => `Ищу продавцов: ${(m[1] ?? "").trim()}. Покажу верификацию, рейтинг и историю работы на платформе.`,
  },
  {
    id: "product_search",
    pattern: /(?:найд[и|ите]|покаж[и|ите]|ищу|хочу|подобрать|выбрать|посоветуй)\s+(.*)/i,
    tool: "search_products",
    args: (m) => {
      const rest = m[1] ?? "";
      return { query: rest.trim(), budget: parseBudget(rest) };
    },
    reply: (m) => `Выполняю поиск по запросу: «${(m[1] ?? "").trim()}». Сейчас подберу подходящие варианты.`,
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
    pattern: /(где (мой )?заказ|статус заказа|отслед[и|ить]|доставк[а|у])\s*(.*)?/i,
    tool: "get_order",
    args: () => ({ mine: true }),
    reply: () => "Проверяю статус ваших заказов и доставок по реальным данным.",
  },
  {
    id: "review_analysis",
    pattern: /(?:что говорят|отзывы|отзыв|какие плюсы|какие минусы|недостатки|стоит ли брать)\s*(.*)?/i,
    tool: "get_reviews",
    args: (m) => ({ query: (m[1] ?? "").trim() }),
    reply: (m) => `Анализирую отзывы: ${(m[1] ?? "").trim() || "повторяющиеся преимущества, жалобы и тональность"}. Всё по реальным отзывам покупателей.`,
  },
  {
    id: "seller_sales_drop",
    pattern: /(?:почему|из-за чего).*(?:упали|плохо прода|снизил).*(?:продаж|заказ)/i,
    tool: "analyze_seller_sales",
    args: () => ({}),
    reply: () => "Анализирую продажи: трафик, конверсию, цену, конкурентов, отзывы и наличие.",
  },
  {
    id: "seller_competitors",
    pattern: /(конкурент|конкуренты|сопостав|сравни с конкурентами)\s*(.*)?/i,
    tool: "find_competitors",
    args: (m) => ({ scope: (m[2] ?? "").trim() || "catalog" }),
    reply: () => "Ищу конкурирующие предложения по публичным данным каталога.",
  },
  {
    id: "confirm_availability",
    pattern: /(?:подтверд[и|ить]|подтверждаю).*(?:наличи[е|е]|в наличии)/i,
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
    pattern: /(?:дешевле|подешевле|недорого|дешевый|бюджетный)/i,
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

const GREETING = /(?:привет|здравствуй|добрый день|доброе утро|добрый вечер|hi|hello)/i;
const THANKS = /(?:спасибо|благодарю|спс)/i;

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

    if (GREETING.test(text)) {
      return this.respond(request, "Здравствуйте! Я Светлана. Помогу найти товар, выбрать подарок, оформить карточку или разобраться с продажами. Что вас интересует?");
    }
    if (THANKS.test(text)) {
      return this.respond(request, "Пожалуйста! Обращайтесь, если понадобятся ещё варианты.");
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

    return this.respond(
      request,
      request.jsonMode
        ? JSON.stringify({ intent: "unknown", confidence: 0.2, reply: "Не уверен, что понял задачу. Уточните, пожалуйста." })
        : "Опишите задачу подробнее: что ищем, для кого, какой бюджет и какие сроки доставки важны."
    );
  }

  /**
   * Turns a tool result into the answer the user reads. It reports only what
   * the tool actually returned — an ok:false result is relayed as a failure,
   * never as success (spec §58).
   */
  private summarizeToolResult(payload: string): string {
    try {
      const result = JSON.parse(payload) as { ok?: boolean; summary?: string; error?: string };
      if (result.ok === false) {
        return `Не получилось: ${result.error ?? "причина неизвестна"}. Давайте попробуем иначе.`;
      }
      return result.summary ?? "Готово — данные получены.";
    } catch {
      return "Готово — данные получены.";
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
