/**
 * SvetlanaCoreProvider — единая обученная Светлана на своём сервере
 * (мир-самозанятых.рф, профиль «aiko»). Одна Светлана для всех сайтов экосистемы:
 * модель, характер и знания общие, а тема АИКО (только маркетплейс, без чужих
 * площадок и ссылок) держится правилами профиля на сервере.
 *
 * Включается двумя переменными (только на сервере, в браузер не попадают):
 *   SVETLANA_CORE_URL=https://xn----8sba1acxdkgqms3b9euc.xn--p1ai
 *   SVETLANA_CORE_KEY=<ASSISTANT_KEY_AIKO с сервера Светланы>
 * Без них провайдер недоступен и шлюз работает как раньше (external → mock).
 *
 * Запросы с инструментами (tool calling) и эмбеддинги сюда не идут: сервер
 * Светланы отвечает текстом, такие задачи шлюз отдаёт следующему провайдеру.
 * Системные сообщения агентов передаются полем `system` — сервер добавляет их
 * ПОСЛЕ правил профиля, отменить тему АИКО они не могут.
 */
import { env } from "../../env";
import type { AiCompleteRequest, AiCompleteResponse, AiMessage, AiProvider } from "../types";

// Лимиты совпадают с сервером Светланы (backend/src/routes/assistant.js).
const MAX_MESSAGE = 16000;
const MAX_TURN = 8000;
const MAX_HISTORY = 10;
const MAX_SYSTEM = 20000;
const JSON_HINT = "Ответь строго одним JSON-объектом, без пояснений и без markdown.";

export interface CoreBody {
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  system?: string;
}

/** Сообщения шлюза → тело запроса к единой Светлане. */
export function toCoreBody(messages: AiMessage[], jsonMode = false): CoreBody {
  const systemParts = messages
    .filter((m) => m.role === "system" && m.content.trim())
    .map((m) => m.content);
  if (jsonMode) systemParts.push(JSON_HINT);
  const turns = messages.filter(
    (m) => (m.role === "user" || m.role === "assistant") && m.content.trim(),
  );
  let last = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === "user") {
      last = i;
      break;
    }
  }
  if (last < 0) throw new Error("SvetlanaCoreProvider: no user message");
  const history = turns
    .slice(0, last)
    .slice(-MAX_HISTORY)
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content.slice(0, MAX_TURN),
    }));
  const system = systemParts.join("\n\n").slice(0, MAX_SYSTEM);
  const body: CoreBody = { message: turns[last].content.slice(0, MAX_MESSAGE), history };
  if (system) body.system = system;
  return body;
}

export function coreChatUrl(base: string): string {
  return `${base.replace(/\/+$/, "")}/api/v1/assistant/aiko/chat`;
}

export class SvetlanaCoreProvider implements AiProvider {
  readonly key = "svetlana-core";
  readonly displayName = "svetlana-core";
  readonly sandbox = false;
  readonly available: boolean;
  private readonly baseUrl: string | undefined;
  private readonly apiKey: string | undefined;

  constructor(baseUrl: string | undefined = env.svetlanaCoreUrl, apiKey: string | undefined = env.svetlanaCoreKey) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.available = Boolean(baseUrl && apiKey && /^https:\/\//.test(baseUrl));
  }

  /** Может ли этот провайдер честно выполнить запрос (без инструментов). */
  supports(request: AiCompleteRequest): boolean {
    return request.taskClass !== "embedding" && !(request.tools && request.tools.length > 0);
  }

  async complete(request: AiCompleteRequest): Promise<AiCompleteResponse> {
    if (!this.available || !this.baseUrl || !this.apiKey) {
      throw new Error("SvetlanaCoreProvider is not configured");
    }
    if (!this.supports(request)) {
      throw new Error("SvetlanaCoreProvider: tool calling is not supported");
    }
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.aiGatewayTimeoutMs);
    try {
      const response = await fetch(coreChatUrl(this.baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(toCoreBody(request.messages, request.jsonMode)),
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`svetlana-core ${response.status}`);
      const json = (await response.json()) as { content?: unknown };
      const content = typeof json.content === "string" ? json.content : "";
      if (!content.trim()) throw new Error("svetlana-core: empty answer");
      return {
        content,
        provider: this.key,
        model: "svetlana-core/aiko",
        latencyMs: Date.now() - started,
        sandbox: false,
        finishReason: "stop",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
