/**
 * Проверка самозанятого в ФНС: официальный бесплатный сервис
 * «Проверка статуса налогоплательщика НПД» (statusnpd.nalog.ru, без ключа).
 * Описание API: https://npd.nalog.ru/html/sites/www.npd.nalog.ru/api_statusnpd_nalog_ru.pdf
 *
 * Отметку «проверено» ставим только по ответу ФНС. Если сервис недоступен,
 * отвечает ошибкой или ограничил частоту запросов, статус остаётся «на
 * проверке»: никакой выдуманной галочки.
 */
import { isValidInn } from "../legal";

export const NPD_ENDPOINT = "https://statusnpd.nalog.ru/api/v1/tracker/taxpayer_status";

export type NpdCheckStatus = "VERIFIED" | "REJECTED" | "UNAVAILABLE";

export interface NpdCheckResult {
  status: NpdCheckStatus;
  /** Ответ ФНС или причина, почему проверить не удалось. */
  message: string;
  /** Дата, на которую проверяли (YYYY-MM-DD, по Москве). */
  requestDate: string;
}

/** Сегодняшняя дата по Москве в формате ФНС. */
export function moscowDate(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}

export async function checkNpdStatus(
  inn: string,
  opts: { now?: Date; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<NpdCheckResult> {
  const requestDate = moscowDate(opts.now);
  const clean = inn.replace(/\D/g, "");
  if (clean.length !== 12 || !isValidInn(clean)) {
    return { status: "REJECTED", message: "ИНН самозанятого должен состоять из 12 цифр с верной контрольной суммой", requestDate };
  }
  // В автотестах в ФНС не ходим: только с явно переданным fetch.
  if (!opts.fetchImpl && process.env.NODE_ENV === "test") {
    return { status: "UNAVAILABLE", message: "проверка ФНС отключена в тестах", requestDate };
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await doFetch(NPD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ inn: clean, requestDate }),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as { status?: unknown; message?: unknown; code?: unknown };
    const message = typeof data.message === "string" ? data.message.slice(0, 300) : "";
    if (res.ok && typeof data.status === "boolean") {
      return {
        status: data.status ? "VERIFIED" : "REJECTED",
        message: message || (data.status ? "является плательщиком НПД" : "не является плательщиком НПД"),
        requestDate,
      };
    }
    if (res.status === 422) return { status: "REJECTED", message: message || "ФНС не приняла ИНН", requestDate };
    if (res.status === 429) return { status: "UNAVAILABLE", message: "ФНС ограничила частоту проверок, повторим позже", requestDate };
    return { status: "UNAVAILABLE", message: `сервис ФНС ответил ${res.status}`, requestDate };
  } catch {
    return { status: "UNAVAILABLE", message: "сервис ФНС не ответил", requestDate };
  } finally {
    clearTimeout(timer);
  }
}
