/**
 * Названия характеристик товара для покупателя. В базе ключи часто английские
 * (material, items, brand), а весь интерфейс должен быть на русском. Русские ключи продавца
 * показываем как есть (с большой буквы).
 */
const LABELS: Record<string, string> = {
  // общие
  brand: "Бренд",
  model: "Модель",
  material: "Материал",
  color: "Цвет",
  colour: "Цвет",
  size: "Размер",
  weight: "Вес",
  height: "Высота",
  width: "Ширина",
  length: "Длина",
  depth: "Глубина",
  thickness: "Толщина",
  volume: "Объём",
  capacity: "Вместимость",
  dimensions: "Размеры",
  type: "Тип",
  purpose: "Назначение",
  country: "Страна производства",
  warranty: "Гарантия",
  guarantee: "Гарантия",
  unit: "Единица продажи",
  pack: "В упаковке",
  packSize: "В упаковке",
  quantity: "Количество",
  items: "Предметов в наборе",
  minOrder: "Минимальный заказ",
  grade: "Класс",
  class: "Класс",
  standard: "Стандарт",
  gender: "Для кого",
  age: "Возраст",
  // техника
  diagonal: "Диагональ",
  screen: "Экран",
  ram: "Оперативная память",
  memory: "Память",
  storage: "Накопитель",
  ssd: "Накопитель SSD",
  hdd: "Жёсткий диск",
  cpu: "Процессор",
  gpu: "Видеокарта",
  battery: "Аккумулятор",
  batteries: "Аккумуляторов в комплекте",
  autonomy: "Время работы",
  anc: "Активное шумоподавление",
  power: "Мощность",
  ports: "Портов",
  tech: "Технология",
  voltage: "Напряжение",
  torque: "Крутящий момент",
  disc: "Диаметр диска",
  bits: "Бит в наборе",
  magnet: "Магнитный держатель",
  connection: "Подключение",
  os: "Операционная система",
  camera: "Камера",
  // дом, одежда, дети
  handle: "Рукоять",
  density: "Плотность",
  season: "Сезон",
  waterproof: "Водонепроницаемость",
  fit: "Фасон",
  details: "Деталей",
  composition: "Состав",
  // услуги
  format: "Формат",
  deliverables: "Что вы получите",
  terms: "Сроки",
  duration: "Длительность",
};

function normKey(key: string): string {
  return key.trim().replace(/[\s_-]+(\w)/g, (_, c: string) => c.toUpperCase());
}

/** Подпись для ключа характеристики. */
export function attrLabel(key: string): string {
  const k = normKey(key);
  const known = LABELS[k] ?? LABELS[k.toLowerCase()];
  if (known) return known;
  const s = key.trim().replace(/[_-]+/g, " ");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : key;
}

/** Значение для показа: переводим только частые служебные слова. */
export function attrValue(value: unknown): string {
  if (value === true) return "да";
  if (value === false) return "нет";
  if (Array.isArray(value)) return value.map(attrValue).join(", ");
  const s = String(value ?? "").trim();
  const lower = s.toLowerCase();
  if (lower === "yes" || lower === "true") return "да";
  if (lower === "no" || lower === "false") return "нет";
  return s;
}

/** Ряды таблицы «Характеристики»: пустые значения и служебные поля не показываем. */
export function attrRows(attrs: Record<string, unknown>): { key: string; label: string; value: string }[] {
  return Object.entries(attrs)
    .filter(([k, v]) => !k.startsWith("_") && k !== "demo" && v !== null && v !== undefined && typeof v !== "object" || Array.isArray(v))
    .map(([k, v]) => ({ key: k, label: attrLabel(k), value: attrValue(v) }))
    .filter((r) => r.value !== "");
}
