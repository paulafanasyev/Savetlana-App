/**
 * Защита переписки от мошенников (антифрод, шаг 1).
 *
 * Главная схема в России («Мамонт», по данным F6 больше 1 млрд ₽ за 2024–2025):
 * мошенник уводит человека из чата площадки на поддельную страницу «доставки»
 * или «оплаты», выманивает данные карты и коды из СМС, либо просит перевести
 * деньги напрямую (карта, номер телефона, СБП, QR, криптовалюта).
 *
 * Здесь чистые правила, без сети и базы: одинаковый текст всегда даёт
 * одинаковый результат, каждое срабатывание объяснено человеческим языком.
 *   block — сообщение не отправляется (фишинговая ссылка, номер карты, просьба
 *           назвать код, ссылка «на оплату/получение денег» и т.п.);
 *   warn  — сообщение уходит, но получатель видит предупреждение.
 */

export type ScamSeverity = "warn" | "block";

export interface ScamFinding {
  code: string;
  severity: ScamSeverity;
  /** Что увидит человек: почему это опасно. */
  reason: string;
}

export interface ScamVerdict {
  verdict: "ok" | ScamSeverity;
  findings: ScamFinding[];
}

/** Сокращатели ссылок: за ними почти всегда прячут фишинговый адрес. */
const SHORTENERS = [
  "bit.ly", "tinyurl.com", "clck.ru", "goo.su", "cutt.ly", "t.ly", "is.gd", "v.gd", "rb.gy", "shorturl.at",
  "ow.ly", "u.to", "qps.ru", "vk.cc", "tiny.cc", "rebrand.ly", "lnkd.in", "s.id",
];

/** Бренды, под которые чаще всего делают поддельные страницы. */
const SPOOFED_BRANDS = [
  "avito", "ozon", "wildberries", "yandex", "sber", "tinkoff", "tbank", "alfabank", "vtb", "gosuslugi",
  "cdek", "sdek", "pochta", "boxberry", "aiko", "svetlana",
];

/** Слова в адресе, типичные для страниц «оплаты» и «получения денег». */
const PAYMENT_HOST_WORDS = [
  "oplata", "pay", "dostavka", "delivery", "secure", "bezopasn", "sdelka", "vozvrat", "refund", "wallet", "bonus",
  "prize", "vyplat", "poluchen", "perevod",
];

/** Официальные домены, которые не считаем подделкой. */
const OFFICIAL_DOMAINS = [
  "avito.ru", "ozon.ru", "wildberries.ru", "wb.ru", "yandex.ru", "ya.ru", "market.yandex.ru", "sberbank.ru", "tbank.ru",
  "tinkoff.ru", "alfabank.ru", "vtb.ru", "gosuslugi.ru", "cdek.ru", "pochta.ru", "boxberry.ru", "nalog.gov.ru",
];

/** Похожие на латиницу кириллические буквы и обратно: «аvitо» с русскими а/о. */
const HOMOGLYPHS: Record<string, string> = { а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", к: "k", м: "m", т: "t", в: "b", н: "h" };

/** Приводит текст к виду, в котором трудно спрятать слово пробелами, точками и заменой букв. */
export function normalizeForScan(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function latinized(text: string): string {
  return text.replace(/[а-я]/g, (ch) => HOMOGLYPHS[ch] ?? ch);
}

/** Сжатая версия без разделителей: «w h a t s a p p» → «whatsapp». */
function squeezed(text: string): string {
  return latinized(text).replace(/[\s.\-_*•|/\\]+/g, "");
}

/** Проверка номера карты по алгоритму Луна. */
export function luhnOk(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

function hostOf(raw: string): string | null {
  const withScheme = /^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function isSubdomainOf(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Ссылки в тексте, включая «site . ru» и «site[.]ru»: адрес и как он был написан. */
export function extractLinks(text: string): { host: string; raw: string }[] {
  const unbracketed = text
    .replace(/\s*[[(]\s*(?:\.|точка|dot)\s*[\])]\s*/gi, ".")
    .replace(/\s+(?:точка|dot)\s+/gi, ".")
    // «site . ru»: точка с пробелами перед популярной доменной зоной.
    .replace(/([a-z0-9а-я-])\s*\.\s+(ru|com|net|org|su|рф|io|me|site|online|shop|store|xyz|top|info|biz|pro|cc|link|app)\b/gi, "$1.$2")
    .replace(/([a-z0-9а-я-])\s+\.\s*(ru|com|net|org|su|рф|io|me|site|online|shop|store|xyz|top|info|biz|pro|cc|link|app)\b/gi, "$1.$2");
  const re = /((?:https?:\/\/)?(?:[a-z0-9а-я-]+\.)+(?:[a-z]{2,24}|рф)(?::\d+)?(?:\/[^\s]*)?)/gi;
  const out = new Map<string, string>();
  for (const m of unbracketed.matchAll(re)) {
    // Почта (ivan@mail.ru) не ссылка: её разбирает отдельное правило.
    if (unbracketed[(m.index ?? 0) - 1] === "@") continue;
    const host = hostOf(m[1]);
    if (host && /\.[a-zа-я]{2,}$/i.test(m[1].replace(/[/:?#].*$/, "").replace(/^[a-z]+:\/\//i, "")) && !out.has(host)) out.set(host, m[1]);
  }
  return [...out].map(([host, raw]) => ({ host, raw }));
}

export function extractHosts(text: string): string[] {
  return extractLinks(text).map((l) => l.host);
}

export interface ScanOptions {
  /** Домены самой площадки: ссылки на них разрешены. */
  ownDomains?: string[];
}

export function scanMessage(raw: string, opts: ScanOptions = {}): ScamVerdict {
  const findings: ScamFinding[] = [];
  const add = (code: string, severity: ScamSeverity, reason: string) => {
    if (!findings.some((f) => f.code === code)) findings.push({ code, severity, reason });
  };
  const text = normalizeForScan(raw);
  const latin = latinized(text);
  const tight = squeezed(text);
  const own = (opts.ownDomains ?? []).map((d) => d.toLowerCase().replace(/^www\./, ""));

  // --- Ссылки ---------------------------------------------------------------
  const links = extractLinks(text).filter((l) => !own.some((d) => isSubdomainOf(l.host, d)));
  const hosts = links.map((l) => l.host);
  const paymentWords = /(оплат|оплачен|получ(ить|ения|ите) (деньги|средств|оплату|перевод)|подтверд|доставк|возврат|компенсац|выигрыш|приз|безопасн(ая|ой) сделк)/;
  for (const { host, raw: rawLink } of links) {
    if (SHORTENERS.some((s) => isSubdomainOf(host, s))) {
      add("SHORT_LINK", "block", "Сокращённая ссылка скрывает настоящий адрес. Так маскируют поддельные страницы оплаты");
      continue;
    }
    const official = OFFICIAL_DOMAINS.some((d) => isSubdomainOf(host, d));
    // Бренд ищем и в написанном адресе: «аvito» с русской «а» превращается в xn--…
    const shape = latinized(rawLink.toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "")).replace(/[^a-z0-9]/g, "");
    const spoof = !official && SPOOFED_BRANDS.some((b) => shape.includes(b));
    const paymentHost = !official && PAYMENT_HOST_WORDS.some((w) => shape.includes(w));
    if (spoof) {
      add("PHISHING_LINK", "block", "Ссылка похожа на поддельный сайт известного сервиса. Оплачивайте и получайте деньги только на этой площадке");
    } else if (paymentHost || (!official && paymentWords.test(text))) {
      add("PAYMENT_LINK", "block", "Ссылка «для оплаты, доставки или получения денег» вне площадки: это главная схема мошенников");
    } else if (!official) {
      add("EXTERNAL_LINK", "warn", "В сообщении ссылка на сторонний сайт. Не вводите там данные карты и коды");
    }
  }

  // --- Данные карты и коды ----------------------------------------------------
  for (const m of text.matchAll(/(?:\d[ -]?){16,19}/g)) {
    const digits = m[0].replace(/\D/g, "");
    const before = text.slice(Math.max(0, (m.index ?? 0) - 20), m.index ?? 0);
    const notCard = /(заказ|трек|отслеж|посылк|почт|артикул|штрихкод|sku|№)/.test(before);
    if (!notCard && digits.length >= 16 && digits.length <= 19 && /^(220[0-4]|[2-6])/.test(digits) && luhnOk(digits)) {
      add("CARD_NUMBER", "block", "Номер карты в переписке: переводы мимо площадки не защищены, деньги не вернуть");
      break;
    }
  }
  if (/(cvv|cvc|cvс|свв|свс|код (на|с) обратной стороне|три цифры (на|с) обороте|срок действия карты)/.test(latin + " " + text)) {
    add("CARD_SECRET", "block", "Просьба сообщить CVV или срок действия карты. Эти данные не нужны ни продавцу, ни покупателю");
  }
  const askCode = /((на|за)?зов(и|ите)|продикту(й|йте)|скаж(и|ите)|сообщ(и|ите)|пришл(и|ите)|скин(ь|ьте)|отправ(ь|ьте)|напиш(и|ите)).{0,40}(?<!(?:про|штрих|трек)[\s-]?)код(?!\s*(товара|заказа|скидки|купона))/;
  const smsContext = /(смс|sms|пуш|push|уведомлен|пришел|придет|подтвержд|банк|госуслуг|звонок|позвон)/;
  if ((askCode.test(text) && smsContext.test(text)) || /код.{0,25}(из|в) (смс|sms|сообщени|пуш|push|уведомлени)/.test(text)) {
    add("SMS_CODE", "block", "Просьба назвать код из СМС или уведомления. Код нужен только мошеннику, чтобы войти в ваш аккаунт или банк");
  }

  // --- Уход из площадки ------------------------------------------------------
  const messengers = /(whatsapp|watsap|vatsap|вотсап|ватсап|ватцап|вацап|telegram|телеграм|\btg\b|(?:^|[^а-яa-z])тг(?:$|[^а-яa-z])|viber|вайбер|wechat|max мессенджер|мессенджер)/;
  if (messengers.test(text) || /(whatsapp|telegram|viber)/.test(tight)) {
    add("MESSENGER_LURE", "warn", "Собеседник зовёт в мессенджер. Вне площадки нет защиты сделки и переписку нельзя приложить к спору");
  }
  if (/(?:^|\s)@[a-z0-9_]{5,32}\b/.test(text) || /(t\.me|wa\.me|chat\.whatsapp)/.test(tight)) {
    add("MESSENGER_CONTACT", "warn", "Контакт в мессенджере. Договаривайтесь в чате площадки, тогда переписка защищена");
  }
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(text)) {
    add("EMAIL", "warn", "Адрес почты в переписке. Мошенники присылают на почту поддельные письма «об оплате»: проверяйте заказ только в личном кабинете");
  }
  const phone = text.match(/(?<![\d@])(?:\+7|8|7)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}(?!\d)/);
  if (phone) {
    add("PHONE", "warn", "В сообщении номер телефона. Не переводите деньги по номеру телефона и не диктуйте коды по звонку");
  }

  // --- Оплата мимо площадки --------------------------------------------------
  const transfer = /(предоплат|задат(ок|ка)|переве(ди|дите|сти)|перевод(ом)? (на|по) (карт|номер|сбп)|скинь(те)? (на|деньги)|по сбп|через сбп|на карту|оплат(а|у|ите) (на|по) (карт|номер|qr)|qr[- ]?код|наличн(ые|ыми) курьер)/;
  if (transfer.test(text)) {
    add("OFF_PLATFORM_PAYMENT", findings.some((f) => f.code === "CARD_NUMBER" || f.code === "PHONE") ? "block" : "warn", "Просьба заплатить напрямую. Платите только кнопкой «Оплатить» на площадке: только так деньги защищены до получения товара");
  }
  if (/(usdt|usdc|tether|\bbtc\b|bitcoin|биткоин|биткойн|крипт|\beth\b|\bton\b|криптокошел)/.test(text)) {
    add("CRYPTO", "warn", "Оплата криптовалютой не защищена и не возвращается");
  }
  if (/(чтобы получить (деньги|оплату|средства)|для получения (денег|оплаты|средств)|подтверд(и|ите) получение|заполн(и|ите) (данные|форму) (карты|для выплаты))/.test(text)) {
    add("FAKE_PAYOUT", hosts.length > 0 ? "block" : "warn", "«Чтобы получить деньги, заполните данные карты»: так воруют деньги у продавцов. Площадка сама переводит выплату на ваш счёт");
  }
  if (/(служб(а|ы) безопасности|сотрудник банка|ваш аккаунт (взломан|заблокирован)|подозрительн(ая|ую) операц|безопасный сч[её]т)/.test(text)) {
    add("IMPERSONATION", "warn", "Собеседник выдаёт себя за поддержку или банк. Поддержка площадки не пишет в личные сообщения и не просит коды");
  }

  const verdict: ScamVerdict["verdict"] = findings.some((f) => f.severity === "block") ? "block" : findings.length ? "warn" : "ok";
  return { verdict, findings };
}

/** Короткое объяснение для человека: одна-две главные причины. */
export function explainVerdict(v: ScamVerdict): string {
  const main = v.findings.filter((f) => f.severity === v.verdict).slice(0, 2).map((f) => f.reason);
  return main.join(". ");
}
