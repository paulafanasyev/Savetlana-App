/**
 * Антифрод объявлений (шаг 2): недвижимость, авто, услуги и вакансии.
 *
 * Схемы, от которых защищаемся (Россия и мир):
 * - фишинг и оплата мимо площадки прямо в тексте объявления (как в чате);
 * - «слишком дешёвая» приманка: квартира или машина в два раза дешевле рынка;
 * - аренда: «задаток до просмотра», «я за границей, ключи вышлю почтой»;
 * - авто: предоплата за машину «с доставкой», продажа без ПТС или в залоге,
 *   подозрительно маленький пробег для возраста (скрученный одометр);
 * - работа: «оплатите обучение / форму / медкнижку», «лёгкий заработок»,
 *   набор дропов и курьеров для забора наличных у пострадавших;
 * - чужие фотографии: те же снимки уже есть в объявлении другого человека;
 * - вакансии: зарплата в разы выше рынка, большие деньги «без опыта»,
 *   просьба прислать фото паспорта до собеседования (на чужой паспорт
 *   оформляют займы и сим-карты), работа без оформления.
 *
 * Чистые правила без базы: block — объявление не публикуется; review —
 * уходит на проверку модератору и не видно в поиске; warn — публикуется.
 */
import { scanMessage, type ScanOptions } from "./scam-guard";

export type ClassifiedSeverity = "warn" | "review" | "block";

export interface ClassifiedFinding {
  code: string;
  severity: ClassifiedSeverity;
  reason: string;
}

export interface ClassifiedVerdict {
  verdict: "ok" | ClassifiedSeverity;
  findings: ClassifiedFinding[];
}

export interface ClassifiedForScan {
  vertical: string;
  dealType: string;
  title: string;
  description?: string | null;
  category?: string;
  priceKopecks: number;
  attrs: Record<string, unknown>;
}

export interface ComparableAd {
  priceKopecks: number;
  attrs: Record<string, unknown>;
}

export interface ClassifiedScanContext extends ScanOptions {
  /** Похожие опубликованные объявления в том же городе (та же вертикаль и тип сделки). */
  comparables?: ComparableAd[];
  /** Сколько чужих объявлений уже используют те же фотографии. */
  duplicatePhotoAds?: number;
  now?: Date;
}

/** Предупреждения чата, которые в объявлении означают проверку модератором. */
const CHAT_WARN_TO_REVIEW = new Set(["CRYPTO", "FAKE_PAYOUT", "IMPERSONATION", "EXTERNAL_LINK"]);
/**
 * В объявлении сделка и так проходит между людьми, поэтому «оплата переводом»
 * или «наличными курьеру» сами по себе не повод для проверки: опасные случаи
 * (предоплата до просмотра, аренда, авто с доставкой) ловят отдельные правила.
 */
const CHAT_ALWAYS_WARN = new Set(["OFF_PLATFORM_PAYMENT"]);

const RENT_DEALS = new Set(["RENT", "LONG_RENT", "DAILY_RENT"]);

/** Во сколько раз дешевле рынка считаем приманкой. */
export const LOW_PRICE_RATIO = 0.5;
/** Сколько похожих объявлений нужно, чтобы судить о рыночной цене. */
export const MIN_COMPARABLES = 5;
/** Во сколько раз выше обычной зарплаты в городе считаем приманкой. */
export const HIGH_SALARY_RATIO = 3;
/** Зарплата «без опыта», от которой вакансия уходит на проверку, ₽ в месяц и за смену. */
export const NO_EXPERIENCE_MONTH_RUB = 300_000;
export const NO_EXPERIENCE_SHIFT_RUB = 25_000;

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/**
 * Рыночная цена для сравнения: для авто по той же марке и модели (год ±2),
 * для недвижимости за квадратный метр того же типа. Для услуг не считаем:
 * цены там слишком разные.
 */
export function marketReference(ad: ClassifiedForScan, comparables: ComparableAd[]): { own: number; market: number; count: number } | null {
  if (ad.priceKopecks <= 0) return null;
  if (ad.vertical === "AUTO") {
    const brand = str(ad.attrs.brand);
    const model = str(ad.attrs.model);
    if (!brand || !model) return null;
    const year = num(ad.attrs.year);
    const same = comparables.filter((c) => {
      if (c.priceKopecks <= 0 || str(c.attrs.brand) !== brand || str(c.attrs.model) !== model) return false;
      const y = num(c.attrs.year);
      return year === null || y === null || Math.abs(y - year) <= 2;
    });
    const m = median(same.map((c) => c.priceKopecks));
    return m !== null && same.length >= MIN_COMPARABLES ? { own: ad.priceKopecks, market: m, count: same.length } : null;
  }
  if (ad.vertical === "REAL_ESTATE") {
    const area = num(ad.attrs.areaTotal);
    if (!area || area <= 0) return null;
    const type = str(ad.attrs.propertyType);
    const perM2 = comparables
      .filter((c) => c.priceKopecks > 0 && (!type || !str(c.attrs.propertyType) || str(c.attrs.propertyType) === type))
      .map((c) => {
        const a = num(c.attrs.areaTotal);
        return a && a > 0 ? c.priceKopecks / a : null;
      })
      .filter((v): v is number => v !== null);
    const m = median(perM2);
    return m !== null && perM2.length >= MIN_COMPARABLES ? { own: ad.priceKopecks / area, market: m, count: perM2.length } : null;
  }
  return null;
}

/** «в 3 раза», «в 5 раз». */
function times(ratio: number): string {
  const n = Math.floor(ratio);
  return n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? `${n} раза` : `${n} раз`;
}

/** Обычная зарплата для вакансии: медиана похожих вакансий города за тот же период. */
export function salaryReference(ad: ClassifiedForScan, comparables: ComparableAd[]): { own: number; market: number; count: number } | null {
  if (ad.vertical !== "JOB" || ad.priceKopecks <= 0) return null;
  const period = str(ad.attrs.salaryPeriod) || "month";
  const same = comparables.filter((c) => c.priceKopecks > 0 && (str(c.attrs.salaryPeriod) || "month") === period);
  const m = median(same.map((c) => c.priceKopecks));
  return m !== null && m > 0 && same.length >= MIN_COMPARABLES ? { own: ad.priceKopecks, market: m, count: same.length } : null;
}

export function scanClassified(ad: ClassifiedForScan, ctx: ClassifiedScanContext = {}): ClassifiedVerdict {
  const findings: ClassifiedFinding[] = [];
  const add = (code: string, severity: ClassifiedSeverity, reason: string) => {
    if (!findings.some((f) => f.code === code)) findings.push({ code, severity, reason });
  };
  const raw = `${ad.title}\n${ad.description ?? ""}`;
  const text = raw.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");

  // --- Те же правила, что в чате: фишинг, карты, коды, оплата мимо площадки ---
  const chat = scanMessage(raw, { ownDomains: ctx.ownDomains });
  for (const f of chat.findings) {
    if (CHAT_ALWAYS_WARN.has(f.code)) add(f.code, "warn", f.reason);
    else if (f.severity === "block") add(f.code, "block", f.reason);
    else if (CHAT_WARN_TO_REVIEW.has(f.code)) add(f.code, "review", f.reason);
    else add(f.code, "warn", f.reason);
  }

  // --- Работа и «заработок» ---------------------------------------------------
  if (/(обнал|(?:^|[^а-яa-z])дроп(ы|ов|ам|ом)?(?:$|[^а-яa-z])|сда(ть|й|йте) (свою |банковскую )?карт[уы] в аренду|аренд[аы] (банковск(ой|их) )?карт|оформ(ить|и|ите) (на себя |на свое имя )?(банковск(ую|ие) )?карт[уы]? (и |для )?(переда|прода)|(переда(ть|ча)|прода(ть|жа)) (свою |своей )?(банковск(ую|ой) )?карт[уыа]|(забрать|забор|забирать|получить) (деньг|денежн|наличн)\S* у (пенсионер|клиент|граждан|людей)|курьер.{0,40}(забира|забор|забрат|получ)\S*.{0,25}(деньг|наличн))/.test(text)) {
    add("MONEY_MULE", "block", "Похоже на вербовку «дропов» или курьеров для забора денег у обманутых людей. За это грозит уголовная ответственность");
  }
  if (/(оплат(ите|ить|а|у)|внес(ти|ите)|взнос|купить|приобрести|за свой сч[её]т).{0,30}(обучени|стажировк|оформлени|пропуск|униформ|спецодежд|форм[уыа]|медкнижк|медицинск(ой|ую) книжк|регистрац|стартов(ый|ого) набор|материал(ы|ов) для работы)|вступительн(ый|ого) взнос|страхов(ой|ого) взнос за (работу|трудоустройство)|залог за (работу|трудоустройств|оборудовани|инструмент)|платн(ое|ая) (обучение|стажировка) (с|и) (последующим )?трудоустройств/.test(text)) {
    add("JOB_FEE", "review", "Работодатель просит деньги за обучение, форму, медкнижку или оформление. Честный работодатель за работу не берёт денег");
  }
  if (/(легк(ий|ие|ая) (заработок|деньги|работа)|быстр(ый|ые) (заработок|деньги)|пассивн(ый|ого) доход|без вложений.{0,30}доход|доход от \d[\d\s]*(000|тыс|к)?\s?(₽|р|руб)?\S*\s?(в|за) (день|час|сутки)|от \d[\d\s]*(000|тыс)\s?(₽|р|руб)?\S*\s?(в|за) (день|сутки) без опыта)/.test(text)) {
    add("EASY_MONEY", "review", "Обещание лёгкого заработка без опыта. Так часто заманивают в схемы с вложениями или дропами");
  }

  // --- Вакансии -------------------------------------------------------------
  if (ad.vertical === "JOB" && /(пришлите|присылайте|отправьте|отправь|скиньте|скинь|сфотографируйте|прикрепите|загрузите)\s.{0,40}(паспорт|снилс|(?:^|[^а-яa-z])инн(?:$|[^а-яa-z])|водительск(ое|ого|их) (удостоверени|прав))|(фото|скан|копи|селфи)\S* (с )?(паспорт|снилс)\S* (до|перед) (собеседовани|встреч|звонк)/.test(text)) {
    add("PASSPORT_REQUEST", "review", "Просят прислать фото паспорта или СНИЛС заранее. На чужие документы оформляют займы и сим-карты: документы показывают только при оформлении на работу");
  }
  if (ad.vertical === "JOB" && ad.dealType === "VACANCY") {
    const period = str(ad.attrs.salaryPeriod) || "month";
    const salaryRub = ad.priceKopecks / 100;
    if (str(ad.attrs.experience) === "none" && salaryRub > 0 &&
        ((period === "month" && salaryRub >= NO_EXPERIENCE_MONTH_RUB) || (period === "shift" && salaryRub >= NO_EXPERIENCE_SHIFT_RUB))) {
      add("EASY_MONEY", "review", `Зарплата от ${salaryRub.toLocaleString("ru-RU")} ₽ без опыта работы. Так часто заманивают в схемы с вложениями или дропами`);
    }
    const ref = salaryReference(ad, ctx.comparables ?? []);
    if (ref && ref.own >= ref.market * HIGH_SALARY_RATIO) {
      add("SALARY_TOO_HIGH", "review", `Зарплата в ${times(ref.own / ref.market)} выше, чем в похожих вакансиях города. Слишком щедрое предложение часто оказывается приманкой`);
    }
    if (ad.attrs.contract === "none") {
      add("JOB_NO_CONTRACT", "warn", "Работа без оформления: если зарплату не заплатят, добиться её будет трудно");
    }
  }

  // --- Предоплата до встречи -------------------------------------------------
  if (/(предоплат|задат(ок|ка|ком)|бронь|бронировани|оплат(а|у|ить|ите)|перев(од|ести|едите)).{0,60}до (просмотра|осмотра|встречи|заселения)/.test(text) ||
      /просмотр (только )?после (оплаты|предоплаты|задатка)/.test(text)) {
    add("PREPAY_BEFORE_VIEWING", "review", "Деньги просят до просмотра. Платите только после того, как увидели квартиру, машину или работу своими глазами");
  }
  if (RENT_DEALS.has(ad.dealType) || (ad.vertical === "REAL_ESTATE" && ad.dealType !== "SELL" && ad.dealType !== "BUY_REQUEST")) {
    if (/(предоплат|задат(ок|ка)|бронь).{0,50}(на карту|переводом|по сбп|по номеру|на сч[её]т|заранее)/.test(text)) {
      add("RENT_PREPAYMENT", "review", "Аренда с предоплатой переводом заранее: частая схема с несуществующими квартирами");
    }
    if (/((я|хозяин|собственник) (сейчас )?(за границей|за рубежом|в другом городе|в командировке|не в городе)|ключи (вышлю|отправлю|передам курьером|пришлю)|(вышлю|отправлю) ключи)/.test(text)) {
      add("RENT_REMOTE_OWNER", "review", "«Хозяин далеко, ключи вышлю после оплаты»: классическая схема аренды без квартиры");
    }
  }

  // --- Авто ------------------------------------------------------------------
  if (ad.vertical === "AUTO") {
    if (/(предоплат|задат(ок|ка)|бронь)/.test(text) && /(на карту|перевод|сбп|автовоз|транспортн(ой|ая|ую) компани|доставк|пригоню|отправлю)/.test(text)) {
      add("AUTO_PREPAYMENT", "review", "Предоплата за машину с доставкой: деньги отдают за автомобиль, которого может не быть");
    }
    if (/(без птс|птс (дубликат|утерян|потерян)|дубликат птс|документы (потом|позже|при встрече не)|без документов|без сто?с|в залоге|под залогом|залогов(ый|ое|ая) (авто|автомобиль|машина)|в кредите|запрет на регистрац|ограничени(е|я) на регистрац|под арестом)/.test(text)) {
      add("AUTO_DOCS_RISK", "review", "Машина без ПТС, с дубликатом, в залоге или с запретом. Такую машину могут забрать у нового владельца");
    }
    if (ad.attrs.pts === "duplicate" || ad.attrs.pts === "none") {
      add("AUTO_DOCS_RISK", "review", "Машина без ПТС или с дубликатом ПТС. Проверьте по VIN, нет ли залога и запретов");
    }
    const year = num(ad.attrs.year);
    const km = num(ad.attrs.mileageKm);
    const nowYear = (ctx.now ?? new Date()).getFullYear();
    if (year !== null && km !== null && year > 1950 && year <= nowYear) {
      const age = nowYear - year;
      if (age >= 4 && km < age * 2000) {
        add("MILEAGE_SUSPICIOUS", "review", `Пробег ${Math.round(km).toLocaleString("ru-RU")} км для машины ${year} года очень мал. Возможно, одометр скручен: сверьте пробег по истории ТО и отчёту по VIN`);
      }
    }
  }

  // --- Цена-приманка -----------------------------------------------------------
  const ref = marketReference(ad, ctx.comparables ?? []);
  if (ref && ref.own < ref.market * LOW_PRICE_RATIO) {
    const pct = Math.round((1 - ref.own / ref.market) * 100);
    add("PRICE_TOO_LOW", "review", `Цена на ${pct}% ниже похожих объявлений в городе. Слишком дешёвое предложение часто оказывается приманкой мошенников`);
  }

  // --- Чужие фотографии ------------------------------------------------------
  if ((ctx.duplicatePhotoAds ?? 0) > 0) {
    add("DUPLICATE_PHOTOS", "review", "Эти фотографии уже есть в объявлении другого человека. Мошенники копируют чужие снимки");
  }

  const verdict: ClassifiedVerdict["verdict"] = findings.some((f) => f.severity === "block")
    ? "block"
    : findings.some((f) => f.severity === "review")
      ? "review"
      : findings.length
        ? "warn"
        : "ok";
  return { verdict, findings };
}

/** Одна-две главные причины для человека. */
export function explainClassified(v: ClassifiedVerdict): string {
  const target = v.verdict === "ok" ? "warn" : v.verdict;
  return v.findings.filter((f) => f.severity === target).slice(0, 2).map((f) => f.reason).join(". ");
}

/** Подписи кодов для модератора. */
export const CLASSIFIED_FINDING_LABEL: Record<string, string> = {
  MONEY_MULE: "Вербовка дропов",
  JOB_FEE: "Деньги за трудоустройство",
  EASY_MONEY: "«Лёгкий заработок»",
  PREPAY_BEFORE_VIEWING: "Оплата до просмотра",
  RENT_PREPAYMENT: "Предоплата аренды",
  RENT_REMOTE_OWNER: "Хозяин далеко",
  AUTO_PREPAYMENT: "Предоплата за авто",
  AUTO_DOCS_RISK: "ПТС, залог, запрет",
  MILEAGE_SUSPICIOUS: "Подозрительный пробег",
  PRICE_TOO_LOW: "Цена сильно ниже рынка",
  DUPLICATE_PHOTOS: "Чужие фото",
  PASSPORT_REQUEST: "Просят фото паспорта",
  SALARY_TOO_HIGH: "Зарплата сильно выше рынка",
  JOB_NO_CONTRACT: "Без оформления",
  PHISHING_LINK: "Фишинговая ссылка",
  SHORT_LINK: "Сокращённая ссылка",
  PAYMENT_LINK: "Ссылка на оплату",
  EXTERNAL_LINK: "Сторонняя ссылка",
  CARD_NUMBER: "Номер карты",
  CARD_SECRET: "CVV карты",
  SMS_CODE: "Код из СМС",
  OFF_PLATFORM_PAYMENT: "Оплата напрямую",
  CRYPTO: "Криптовалюта",
  FAKE_PAYOUT: "«Получить деньги»",
  IMPERSONATION: "Выдаёт себя за банк",
  MESSENGER_LURE: "Зовёт в мессенджер",
  MESSENGER_CONTACT: "Контакт мессенджера",
  EMAIL: "Почта",
  PHONE: "Телефон",
};
