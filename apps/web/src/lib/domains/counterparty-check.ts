/**
 * Проверка контрагента перед сделкой: кто продавец по документам и можно ли
 * ему доверять партию. Это список проверок с источником каждой, а не одна
 * «магическая оценка»: человек видит, что проверено, чем и что нет.
 *
 * Источники:
 *   • контрольные суммы ИНН и ОГРН (локально);
 *   • проверка анкеты площадкой (модерация) и ФНС для самозанятых (statusnpd);
 *   • ЕГРЮЛ/ЕГРИП: статус организации через DaData (findById/party), если задан
 *     DADATA_API_KEY; ответ кешируется на сутки в журнале проверок;
 *   • РНП (реестр недобросовестных поставщиков) открытого API не имеет: даём
 *     ссылку для ручной проверки и честно пишем, что автоматически не проверяли;
 *   • история на площадке: завершённые заказы и споры.
 * Чего не проверили, то помечено «не проверено». Выдуманных галочек нет.
 */
import { prisma } from "../prisma";
import { isValidInn, isValidOgrn } from "../legal";

export type CheckStatus = "OK" | "WARN" | "FAIL" | "UNKNOWN";

export type CounterpartyCheck = {
  id: "requisites" | "moderation" | "npd" | "egrul" | "rnp" | "history";
  title: string;
  status: CheckStatus;
  detail: string;
  source: string;
  url?: string;
};

export type CounterpartyReport = {
  sellerId: string;
  displayName: string;
  inn: string | null;
  checks: CounterpartyCheck[];
  verdict: "RECOMMENDED" | "CAUTION" | "NOT_RECOMMENDED";
  verdictText: string;
};

export const DADATA_PARTY_URL = "https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party";
const EGRUL_CACHE_MS = 24 * 60 * 60 * 1000;

export type EgrulInfo = {
  status: "ACTIVE" | "LIQUIDATING" | "LIQUIDATED" | "BANKRUPT" | "REORGANIZING" | "UNKNOWN";
  name: string | null;
  registeredAt: string | null;
};

const EGRUL_LABEL: Record<EgrulInfo["status"], string> = {
  ACTIVE: "действующая",
  LIQUIDATING: "ликвидируется",
  LIQUIDATED: "ликвидирована",
  BANKRUPT: "банкротство",
  REORGANIZING: "реорганизуется",
  UNKNOWN: "статус не определён",
};

/** Запрос статуса в ЕГРЮЛ/ЕГРИП через DaData. null: проверить не удалось или ключа нет. */
export async function fetchEgrul(inn: string, opts: { fetchImpl?: typeof fetch; apiKey?: string; timeoutMs?: number } = {}): Promise<EgrulInfo | null> {
  const key = opts.apiKey ?? process.env.DADATA_API_KEY;
  if (!key) return null;
  if (!opts.fetchImpl && process.env.NODE_ENV === "test") return null;
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 6000);
  try {
    const res = await doFetch(DADATA_PARTY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Token ${key}` },
      body: JSON.stringify({ query: inn, count: 1 }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as {
      suggestions?: { value?: string; data?: { state?: { status?: string; registration_date?: number }; name?: { short_with_opf?: string } } }[];
    };
    const s = data.suggestions?.[0];
    if (!s) return { status: "UNKNOWN", name: null, registeredAt: null };
    const raw = String(s.data?.state?.status ?? "UNKNOWN").toUpperCase();
    const status = (["ACTIVE", "LIQUIDATING", "LIQUIDATED", "BANKRUPT", "REORGANIZING"].includes(raw) ? raw : "UNKNOWN") as EgrulInfo["status"];
    const reg = s.data?.state?.registration_date;
    return {
      status,
      name: s.data?.name?.short_with_opf ?? s.value ?? null,
      registeredAt: typeof reg === "number" ? new Date(reg).toISOString().slice(0, 10) : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** ЕГРЮЛ с кешем на сутки в журнале проверок продавца. */
async function egrulCached(sellerId: string, inn: string, opts: CheckOpts): Promise<EgrulInfo | null> {
  const cached = await prisma.verificationRecord.findFirst({
    where: { sellerId, kind: "egrul", source: "dadata", createdAt: { gt: new Date(Date.now() - EGRUL_CACHE_MS) } },
    orderBy: { createdAt: "desc" },
    select: { checkedFields: true },
  });
  if (cached) {
    try {
      return JSON.parse(cached.checkedFields) as EgrulInfo;
    } catch {
      /* перезапросим */
    }
  }
  const info = await fetchEgrul(inn, opts);
  if (info) {
    await prisma.verificationRecord.create({
      data: {
        sellerId,
        kind: "egrul",
        status: info.status === "ACTIVE" ? "VERIFIED" : info.status === "UNKNOWN" ? "PENDING" : "REJECTED",
        source: "dadata",
        externalRef: "ЕГРЮЛ/ЕГРИП",
        checkedFields: JSON.stringify(info),
        note: `${EGRUL_LABEL[info.status]}${info.name ? `: ${info.name}` : ""}`.slice(0, 300),
        verifiedAt: info.status === "ACTIVE" ? new Date() : null,
      },
    });
  }
  return info;
}

const VERDICT_TEXT: Record<CounterpartyReport["verdict"], string> = {
  RECOMMENDED: "Проверки пройдены: с продавцом можно работать, деньги всё равно у площадки до получения.",
  CAUTION: "Часть проверок не пройдена или не проведена: перед крупной партией проверьте продавца по ссылкам ниже.",
  NOT_RECOMMENDED: "Есть серьёзный красный флаг: сделку с этим продавцом не рекомендуем.",
};

export type CheckOpts = { fetchImpl?: typeof fetch; apiKey?: string };

export async function checkCounterparty(sellerId: string, opts: CheckOpts = {}): Promise<CounterpartyReport | null> {
  const seller = await prisma.sellerProfile.findUnique({
    where: { id: sellerId },
    select: { id: true, displayName: true, sellerType: true, inn: true, ogrn: true, identityStatus: true, businessStatus: true, npdStatus: true, isActivated: true },
  });
  if (!seller) return null;
  const inn = seller.inn?.replace(/\D/g, "") || null;
  const checks: CounterpartyCheck[] = [];

  // 1. Реквизиты.
  const innOk = inn !== null && isValidInn(inn);
  const needsOgrn = seller.sellerType === "IP" || seller.sellerType === "COMPANY";
  const ogrnOk = !needsOgrn || (seller.ogrn ? isValidOgrn(seller.ogrn) : false);
  checks.push({
    id: "requisites",
    title: "ИНН и ОГРН",
    status: !inn ? "UNKNOWN" : innOk && ogrnOk ? "OK" : "FAIL",
    detail: !inn ? "продавец не указал ИНН" : innOk && ogrnOk ? `ИНН ${inn}${seller.ogrn ? `, ОГРН ${seller.ogrn}` : ""}: контрольные суммы верны` : "реквизиты не проходят проверку контрольной суммы",
    source: "проверка контрольных сумм",
  });

  // 2. Модерация площадкой.
  const verified = seller.isActivated && seller.identityStatus === "VERIFIED" && (seller.businessStatus === "VERIFIED" || seller.npdStatus === "VERIFIED");
  const rejected = seller.businessStatus === "REJECTED" || seller.identityStatus === "REJECTED";
  checks.push({
    id: "moderation",
    title: "Проверка площадкой",
    status: verified ? "OK" : rejected ? "FAIL" : "WARN",
    detail: verified ? "анкета продавца проверена модератором" : rejected ? "площадка отклонила анкету" : "анкета ещё не проверена",
    source: "модерация АИКО",
  });

  // 3. Самозанятый: ответ ФНС.
  if (seller.sellerType === "SELF_EMPLOYED") {
    checks.push({
      id: "npd",
      title: "Статус самозанятого",
      status: seller.npdStatus === "VERIFIED" ? "OK" : seller.npdStatus === "REJECTED" ? "FAIL" : "UNKNOWN",
      detail: seller.npdStatus === "VERIFIED" ? "ФНС подтвердила статус плательщика НПД" : seller.npdStatus === "REJECTED" ? "ФНС не подтвердила статус НПД" : "ответа ФНС пока нет",
      source: "ФНС, statusnpd.nalog.ru",
    });
  }

  // 4. ЕГРЮЛ/ЕГРИП.
  if (inn && innOk && seller.sellerType !== "SELF_EMPLOYED") {
    const egrul = await egrulCached(seller.id, inn, opts).catch(() => null);
    checks.push(
      egrul
        ? {
            id: "egrul",
            title: "ЕГРЮЛ / ЕГРИП",
            status: egrul.status === "ACTIVE" ? "OK" : egrul.status === "UNKNOWN" || egrul.status === "REORGANIZING" ? "WARN" : "FAIL",
            detail: `${EGRUL_LABEL[egrul.status]}${egrul.name ? `, ${egrul.name}` : ""}${egrul.registeredAt ? `, зарегистрирована ${egrul.registeredAt}` : ""}`,
            source: "ЕГРЮЛ через DaData",
            url: "https://egrul.nalog.ru/index.html",
          }
        : {
            id: "egrul",
            title: "ЕГРЮЛ / ЕГРИП",
            status: "UNKNOWN",
            detail: "автоматическая проверка не подключена или сервис не ответил; проверьте выписку по ИНН вручную",
            source: "ФНС, egrul.nalog.ru",
            url: "https://egrul.nalog.ru/index.html",
          }
    );
  }

  // 5. РНП: только ручная проверка.
  if (inn) {
    checks.push({
      id: "rnp",
      title: "Реестр недобросовестных поставщиков",
      status: "UNKNOWN",
      detail: "открытого API у реестра нет, автоматически не проверяли: откройте поиск по ИНН",
      source: "ЕИС, zakupki.gov.ru",
      url: `https://zakupki.gov.ru/epz/dishonestsupplier/search/results.html?searchString=${inn}`,
    });
  }

  // 6. История на площадке.
  const [completed, disputes] = await Promise.all([
    prisma.order.count({ where: { sellerId, status: "COMPLETED" } }),
    prisma.dispute.count({ where: { sellerId } }),
  ]);
  const disputeRate = completed + disputes > 0 ? disputes / (completed + disputes) : 0;
  checks.push({
    id: "history",
    title: "История на площадке",
    status: completed === 0 ? "WARN" : disputeRate > 0.25 ? "FAIL" : disputeRate > 0.1 ? "WARN" : "OK",
    detail: completed === 0 ? "завершённых сделок пока нет" : `завершённых сделок: ${completed}, споров: ${disputes}`,
    source: "данные АИКО",
  });

  const fail = checks.some((c) => c.status === "FAIL");
  const allCore = checks.filter((c) => c.id === "requisites" || c.id === "moderation").every((c) => c.status === "OK");
  const egrulOk = checks.find((c) => c.id === "egrul")?.status !== "FAIL";
  const verdict: CounterpartyReport["verdict"] = fail && (!egrulOk || checks.find((c) => c.id === "requisites")?.status === "FAIL" || rejected)
    ? "NOT_RECOMMENDED"
    : fail || !allCore
      ? "CAUTION"
      : "RECOMMENDED";
  return { sellerId: seller.id, displayName: seller.displayName, inn, checks, verdict, verdictText: VERDICT_TEXT[verdict] };
}

/** Одна строка для чата: «Продавец: проверка площадкой ✓, ЕГРЮЛ ✓, РНП — вручную». */
export function counterpartyLine(r: CounterpartyReport): string {
  const mark = (s: CheckStatus) => (s === "OK" ? "✓" : s === "FAIL" ? "✗" : s === "WARN" ? "!" : "не проверено");
  const parts = r.checks.map((c) => `${c.title} ${mark(c.status)}`);
  return `Проверка продавца «${r.displayName}»: ${parts.join(", ")}. ${r.verdictText}`;
}
