/**
 * Поля характеристик объявления по вертикалям: одно описание для формы
 * подачи, разбора на сервере и показа на странице объявления.
 * Чистый модуль без серверных зависимостей, его можно импортировать в браузер.
 */

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDef {
  key: string;
  label: string;
  type: "number" | "text" | "select";
  options?: FieldOption[];
  unit?: string;
  min?: number;
  max?: number;
  /** Дробные значения (площадь, высота потолков). */
  step?: number;
  placeholder?: string;
  maxLength?: number;
  /** Не показывать покупателю целиком (VIN). */
  masked?: boolean;
}

const yesNo: FieldOption[] = [
  { value: "yes", label: "Да" },
  { value: "no", label: "Нет" },
];

export const REAL_ESTATE_FIELDS: FieldDef[] = [
  {
    key: "propertyType", label: "Тип недвижимости", type: "select", options: [
      { value: "APARTMENT", label: "Квартира" },
      { value: "ROOM", label: "Комната" },
      { value: "STUDIO", label: "Студия" },
      { value: "HOUSE", label: "Дом" },
      { value: "TOWNHOUSE", label: "Таунхаус" },
      { value: "DUPLEX", label: "Дуплекс" },
      { value: "LAND", label: "Участок" },
      { value: "COMMERCIAL_OFFICE", label: "Офис" },
      { value: "COMMERCIAL_RETAIL", label: "Торговое помещение" },
      { value: "COMMERCIAL_WAREHOUSE", label: "Склад" },
      { value: "GARAGE", label: "Гараж" },
    ],
  },
  { key: "roomsTotal", label: "Комнат", type: "number", min: 0, max: 50 },
  { key: "areaTotal", label: "Общая площадь", type: "number", unit: "м²", min: 1, max: 100000, step: 0.1 },
  { key: "areaKitchen", label: "Площадь кухни", type: "number", unit: "м²", min: 1, max: 1000, step: 0.1 },
  { key: "floor", label: "Этаж", type: "number", min: -5, max: 200 },
  { key: "floorsTotal", label: "Этажей в доме", type: "number", min: 1, max: 200 },
  { key: "buildingYear", label: "Год постройки", type: "number", min: 1700, max: 2100 },
  { key: "plotArea", label: "Площадь участка", type: "number", unit: "сот.", min: 0, max: 1000000, step: 0.1 },
  {
    key: "renovation", label: "Ремонт", type: "select", options: [
      { value: "none", label: "Без ремонта" },
      { value: "cosmetic", label: "Косметический" },
      { value: "euro", label: "Евроремонт" },
      { value: "designer", label: "Дизайнерский" },
    ],
  },
  { key: "furniture", label: "Мебель", type: "select", options: yesNo },
  { key: "mortgagePossible", label: "Подходит под ипотеку", type: "select", options: yesNo },
];

export const AUTO_FIELDS: FieldDef[] = [
  { key: "brand", label: "Марка", type: "text", maxLength: 40, placeholder: "Toyota" },
  { key: "model", label: "Модель", type: "text", maxLength: 40, placeholder: "Camry" },
  { key: "year", label: "Год выпуска", type: "number", min: 1950, max: 2100 },
  { key: "mileageKm", label: "Пробег", type: "number", unit: "км", min: 0, max: 3000000 },
  {
    key: "bodyType", label: "Кузов", type: "select", options: [
      { value: "SEDAN", label: "Седан" },
      { value: "HATCHBACK", label: "Хэтчбек" },
      { value: "WAGON", label: "Универсал" },
      { value: "SUV", label: "Внедорожник" },
      { value: "CROSSOVER", label: "Кроссовер" },
      { value: "COUPE", label: "Купе" },
      { value: "CABRIOLET", label: "Кабриолет" },
      { value: "MINIVAN", label: "Минивэн" },
      { value: "PICKUP", label: "Пикап" },
      { value: "VAN", label: "Фургон" },
      { value: "BUS", label: "Автобус" },
      { value: "TRUCK", label: "Грузовик" },
      { value: "MOTORCYCLE", label: "Мотоцикл" },
    ],
  },
  {
    key: "fuelType", label: "Двигатель", type: "select", options: [
      { value: "PETROL", label: "Бензин" },
      { value: "DIESEL", label: "Дизель" },
      { value: "HYBRID", label: "Гибрид" },
      { value: "ELECTRIC", label: "Электро" },
      { value: "GAS", label: "Газ" },
      { value: "PETROL_GAS", label: "Бензин и газ" },
    ],
  },
  {
    key: "transmission", label: "Коробка", type: "select", options: [
      { value: "manual", label: "Механика" },
      { value: "automatic", label: "Автомат" },
      { value: "robot", label: "Робот" },
      { value: "cvt", label: "Вариатор" },
    ],
  },
  {
    key: "driveType", label: "Привод", type: "select", options: [
      { value: "FWD", label: "Передний" },
      { value: "RWD", label: "Задний" },
      { value: "AWD", label: "Полный" },
      { value: "AWD_LOCKABLE", label: "Полный подключаемый" },
    ],
  },
  { key: "enginePowerHp", label: "Мощность", type: "number", unit: "л. с.", min: 1, max: 3000 },
  { key: "ownersCount", label: "Владельцев по ПТС", type: "number", min: 1, max: 30 },
  {
    key: "pts", label: "ПТС", type: "select", options: [
      { value: "original", label: "Оригинал" },
      { value: "electronic", label: "Электронный" },
      { value: "duplicate", label: "Дубликат" },
      { value: "none", label: "Нет ПТС" },
    ],
  },
  { key: "accidents", label: "Был в ДТП", type: "select", options: yesNo },
  { key: "vin", label: "VIN", type: "text", maxLength: 17, placeholder: "17 символов", masked: true },
];

export const SERVICE_FIELDS: FieldDef[] = [
  { key: "serviceCategory", label: "Вид услуги", type: "text", maxLength: 80, placeholder: "Ремонт квартир" },
  { key: "experienceYears", label: "Опыт", type: "number", unit: "лет", min: 0, max: 70 },
  {
    key: "format", label: "Где", type: "select", options: [
      { value: "client", label: "Выезд к клиенту" },
      { value: "own", label: "У себя" },
      { value: "online", label: "Онлайн" },
    ],
  },
  {
    key: "prepayment", label: "Предоплата", type: "select", options: [
      { value: "none", label: "Без предоплаты" },
      { value: "partial", label: "Частичная" },
      { value: "full", label: "Полная" },
    ],
  },
  { key: "warranty", label: "Гарантия на работу", type: "select", options: yesNo },
];

/** Работа: одинаковые поля для вакансии и резюме, зарплата «от» в поле цены. */
export const JOB_FIELDS: FieldDef[] = [
  { key: "companyName", label: "Компания", type: "text", maxLength: 80, placeholder: "Для резюме можно не заполнять" },
  {
    key: "employment", label: "Занятость", type: "select", options: [
      { value: "full", label: "Полная" },
      { value: "part", label: "Частичная" },
      { value: "project", label: "Проектная работа" },
      { value: "internship", label: "Стажировка" },
      { value: "rotation", label: "Вахта" },
    ],
  },
  {
    key: "schedule", label: "График", type: "select", options: [
      { value: "5/2", label: "5/2" },
      { value: "2/2", label: "2/2" },
      { value: "shift", label: "Сменный" },
      { value: "flexible", label: "Гибкий" },
      { value: "night", label: "Ночные смены" },
    ],
  },
  {
    key: "workFormat", label: "Где работать", type: "select", options: [
      { value: "office", label: "На месте работодателя" },
      { value: "remote", label: "Удалённо" },
      { value: "hybrid", label: "Гибрид" },
      { value: "travel", label: "Разъездная работа" },
    ],
  },
  {
    key: "experience", label: "Опыт", type: "select", options: [
      { value: "none", label: "Без опыта" },
      { value: "1-3", label: "От 1 до 3 лет" },
      { value: "3-6", label: "От 3 до 6 лет" },
      { value: "6+", label: "Больше 6 лет" },
    ],
  },
  { key: "salaryTo", label: "Зарплата до", type: "number", unit: "₽", min: 0, max: 100000000 },
  {
    key: "salaryPeriod", label: "Зарплата за", type: "select", options: [
      { value: "month", label: "Месяц" },
      { value: "shift", label: "Смену" },
      { value: "hour", label: "Час" },
      { value: "piece", label: "Сдельно" },
    ],
  },
  {
    key: "salaryTax", label: "Сумма", type: "select", options: [
      { value: "net", label: "На руки" },
      { value: "gross", label: "До вычета налогов" },
    ],
  },
  {
    key: "contract", label: "Оформление", type: "select", options: [
      { value: "tk", label: "Трудовой договор (ТК РФ)" },
      { value: "gph", label: "Договор ГПХ" },
      { value: "self", label: "Для самозанятых" },
      { value: "none", label: "Без оформления" },
    ],
  },
  {
    key: "education", label: "Образование", type: "select", options: [
      { value: "any", label: "Не важно" },
      { value: "secondary", label: "Среднее" },
      { value: "vocational", label: "Среднее профессиональное" },
      { value: "higher", label: "Высшее" },
    ],
  },
];

export function fieldsFor(vertical: string): FieldDef[] {
  if (vertical === "REAL_ESTATE") return REAL_ESTATE_FIELDS;
  if (vertical === "AUTO") return AUTO_FIELDS;
  if (vertical === "SERVICE") return SERVICE_FIELDS;
  if (vertical === "JOB") return JOB_FIELDS;
  return [];
}

/** Имя поля формы для характеристики. */
export const ATTR_PREFIX = "attr_";

/**
 * Характеристики из присланной формы: только известные поля, числа в
 * допустимых пределах, значения списков из списка. Остальное отбрасывается.
 */
export function parseAttrs(vertical: string, get: (name: string) => unknown): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const f of fieldsFor(vertical)) {
    const raw = get(ATTR_PREFIX + f.key);
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (!value) continue;
    if (f.type === "number") {
      const n = Number(value.replace(",", "."));
      if (!Number.isFinite(n)) continue;
      if (f.min !== undefined && n < f.min) continue;
      if (f.max !== undefined && n > f.max) continue;
      out[f.key] = f.step ? Math.round(n * 10) / 10 : Math.round(n);
    } else if (f.type === "select") {
      if (f.options?.some((o) => o.value === value)) out[f.key] = value;
    } else {
      const text =
        f.key === "vin"
          ? value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, f.maxLength ?? 17)
          : value.replace(/\s+/g, " ").slice(0, f.maxLength ?? 100);
      if (text) out[f.key] = text;
    }
  }
  return out;
}

/** Характеристики для покупателя: русские подписи, единицы, VIN скрыт. */
export function describeAttrs(vertical: string, attrs: Record<string, unknown>): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  for (const f of fieldsFor(vertical)) {
    const v = attrs[f.key];
    if (v === undefined || v === null || v === "") continue;
    let value: string;
    if (f.type === "select") value = f.options?.find((o) => o.value === String(v))?.label ?? String(v);
    else if (f.type === "number" && typeof v === "number") value = v.toLocaleString("ru-RU");
    else value = String(v);
    if (f.masked && value.length >= 8) value = `${value.slice(0, 4)}${"•".repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
    rows.push({ label: f.label, value: f.unit ? `${value} ${f.unit}` : value });
  }
  return rows;
}

/** Подпись к цене по типу сделки. */
export function priceLabel(dealType: string): string {
  if (dealType === "LONG_RENT" || dealType === "RENT") return "Цена в месяц, ₽";
  if (dealType === "DAILY_RENT") return "Цена за сутки, ₽";
  if (dealType === "BUY_REQUEST") return "Бюджет, ₽";
  if (dealType === "VACANCY") return "Зарплата от, ₽";
  if (dealType === "RESUME") return "Желаемая зарплата, ₽";
  return "Цена, ₽";
}

/** Как показать цену в карточке: у аренды период, у вакансии зарплата «от». */
export function priceText(dealType: string, attrs: Record<string, unknown>, formatted: string): string {
  if (dealType === "LONG_RENT" || dealType === "RENT") return `${formatted} в месяц`;
  if (dealType === "DAILY_RENT") return `${formatted} за сутки`;
  if (dealType !== "VACANCY" && dealType !== "RESUME") return formatted;
  const period: Record<string, string> = { month: " в месяц", shift: " за смену", hour: " в час" };
  const salaryTo = attrs.salaryTo;
  const to = typeof salaryTo === "number" && salaryTo > 0 ? ` до ${salaryTo.toLocaleString("ru-RU")} ₽` : "";
  return `${dealType === "VACANCY" ? "от " : ""}${formatted}${to}${period[String(attrs.salaryPeriod)] ?? ""}`;
}

export const MAX_PHOTOS = 10;
/** Общий объём фото за одну отправку: ограничение платформы на размер запроса. */
export const MAX_PHOTOS_TOTAL_BYTES = 4 * 1024 * 1024;

/** Хэши содержимого из адресов фото (фото объявлений сохраняются под именем из SHA-256). */
export function photoDigests(urls: string[]): string[] {
  const out = new Set<string>();
  for (const u of urls) {
    const m = /[a-f0-9]{64}/.exec(u);
    if (m) out.add(m[0]);
  }
  return [...out];
}
