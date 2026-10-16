/**
 * Демо-продавцы для B2B: три оптовика с пересекающимся ассортиментом (СИЗ,
 * канцтовары, упаковка), чтобы на демо было видно реверсивный аукцион, торг
 * в пределах правил продавца и проверку контрагента.
 *
 * Реквизиты условные: ИНН и ОГРН с верной контрольной суммой, но с кодом
 * региона 00, которого не существует, поэтому настоящую компанию они не
 * задевают. В ЕГРЮЛ их нет, и проверка контрагента это честно покажет.
 * Грузятся вместе с демо-каталогом (кнопка в админке) и убираются с ним же.
 */
import type { DemoProduct, DemoSeller } from "./demo-catalog";

export const B2B_CATEGORIES: { slug: string; name: string; parent?: string }[] = [
  { slug: "b2b", name: "Опт для бизнеса" },
  { slug: "ppe", name: "СИЗ и спецодежда", parent: "b2b" },
  { slug: "office", name: "Канцтовары", parent: "b2b" },
  { slug: "packaging", name: "Упаковка", parent: "b2b" },
];

export const B2B_SELLERS: DemoSeller[] = [
  { slug: "demo-b2b-siz", name: "Демо-опт ЗащитаПро", description: "Демо: средства защиты оптом, отгрузка от 50 штук. Реквизиты условные.", sellerType: "COMPANY", inn: "0099001018", ogrn: "1009900101012" },
  { slug: "demo-b2b-snab", name: "Демо-опт СнабЦентр", description: "Демо: снабжение офисов и объектов: СИЗ, бумага, упаковка. Реквизиты условные.", sellerType: "COMPANY", inn: "0099002029", ogrn: "1009900202025" },
  { slug: "demo-b2b-pack", name: "Демо-опт УпакСервис", description: "Демо: упаковка и расходники, цена только по прайсу. Реквизиты условные.", sellerType: "IP", inn: "009900303068", ogrn: "300990030303032" },
];

/** Правила торга демо-продавцов: разные, чтобы торг давал разный результат. */
export const B2B_POLICIES: Record<string, Record<string, unknown>> = {
  "demo-b2b-siz": { enabled: true, maxDiscountPercent: 15, negotiablePercent: 5, minOrderQty: 50, volumeTiers: [{ minQty: 100, discountPercent: 5 }, { minQty: 500, discountPercent: 10 }] },
  "demo-b2b-snab": { enabled: true, maxDiscountPercent: 10, negotiablePercent: 3, minOrderQty: 20, volumeTiers: [{ minQty: 50, discountPercent: 3 }, { minQty: 300, discountPercent: 7 }] },
  // Торг выключен: в аукционе видно, что агент не уступает сверх прайса.
  "demo-b2b-pack": { enabled: false, maxDiscountPercent: 0, negotiablePercent: 0, minOrderQty: 1, volumeTiers: [] },
};

const img = (name: string) => `/images/products/${name}.svg`;

export const B2B_PRODUCTS: DemoProduct[] = [
  { sku: "DEMO-B2B-GL-1", seller: "demo-b2b-siz", category: "ppe", title: "Перчатки рабочие ХБ с ПВХ, пара", description: "Трикотажные перчатки с точечным ПВХ-покрытием для склада и стройки.", price: 52, image: img("gloves"), quantity: 20000, rating: 4.7, attributes: { material: "хлопок + ПВХ", unit: "пара" }, keywords: ["перчатки", "рабочие", "хб", "сиз", "опт"] },
  { sku: "DEMO-B2B-HL-1", seller: "demo-b2b-siz", category: "ppe", title: "Каска защитная строительная, белая", description: "Каска с храповым механизмом регулировки, ГОСТ EN 397.", price: 420, image: img("helmet"), quantity: 3000, rating: 4.8, attributes: { standard: "EN 397", color: "белая" }, keywords: ["каска", "защитная", "строительная", "сиз", "опт"] },
  { sku: "DEMO-B2B-RS-1", seller: "demo-b2b-siz", category: "ppe", title: "Респиратор FFP2 с клапаном", description: "Защита от пыли и аэрозолей, класс FFP2.", price: 110, image: img("respirator"), quantity: 10000, rating: 4.6, attributes: { class: "FFP2", valve: "да" }, keywords: ["респиратор", "ffp2", "маска", "сиз", "опт"] },
  { sku: "DEMO-B2B-GL-2", seller: "demo-b2b-snab", category: "ppe", title: "Перчатки рабочие ХБ с ПВХ, 10 класс, пара", description: "Плотная вязка 10 класса, ПВХ-точка на ладони.", price: 48, image: img("gloves"), quantity: 15000, rating: 4.5, attributes: { material: "хлопок + ПВХ", unit: "пара" }, keywords: ["перчатки", "рабочие", "хб", "сиз", "опт"] },
  { sku: "DEMO-B2B-HL-2", seller: "demo-b2b-snab", category: "ppe", title: "Каска защитная строительная с подбородочным ремнём", description: "Каска из ABS-пластика, ремень в комплекте.", price: 450, image: img("helmet"), quantity: 2000, rating: 4.6, attributes: { material: "ABS", strap: "да" }, keywords: ["каска", "защитная", "строительная", "сиз", "опт"] },
  { sku: "DEMO-B2B-RS-2", seller: "demo-b2b-snab", category: "ppe", title: "Респиратор FFP2 без клапана", description: "Складной респиратор для пыльных работ.", price: 95, image: img("respirator"), quantity: 8000, rating: 4.4, attributes: { class: "FFP2", valve: "нет" }, keywords: ["респиратор", "ffp2", "маска", "сиз", "опт"] },
  { sku: "DEMO-B2B-PA-2", seller: "demo-b2b-snab", category: "office", title: "Бумага офисная А4, 80 г/м², 500 листов", description: "Белая бумага класса C для принтеров и копиров.", price: 449, image: img("paper"), quantity: 4000, rating: 4.7, attributes: { format: "А4", density: "80 г/м²" }, keywords: ["бумага", "офисная", "а4", "канцтовары", "опт"] },
  { sku: "DEMO-B2B-BX-2", seller: "demo-b2b-snab", category: "packaging", title: "Коробка картонная 40×30×30 см, гофрокартон", description: "Трёхслойный гофрокартон, для переезда и отгрузок.", price: 85, image: img("box"), quantity: 6000, rating: 4.5, attributes: { size: "40×30×30 см", layers: "3" }, keywords: ["коробка", "картонная", "упаковка", "гофрокартон", "опт"] },
  { sku: "DEMO-B2B-BX-3", seller: "demo-b2b-pack", category: "packaging", title: "Коробка картонная 40×30×30 см, бурая", description: "Гофрокоробка для склада и маркетплейсов.", price: 72, image: img("box"), quantity: 10000, rating: 4.6, attributes: { size: "40×30×30 см", layers: "3" }, keywords: ["коробка", "картонная", "упаковка", "гофрокартон", "опт"] },
  { sku: "DEMO-B2B-ST-3", seller: "demo-b2b-pack", category: "packaging", title: "Стретч-плёнка 500 мм, 20 мкм, 1,8 кг", description: "Ручная стретч-плёнка для паллет.", price: 520, image: img("stretch"), quantity: 2500, rating: 4.7, attributes: { width: "500 мм", thickness: "20 мкм" }, keywords: ["стретч", "плёнка", "упаковка", "паллета", "опт"] },
  { sku: "DEMO-B2B-PA-3", seller: "demo-b2b-pack", category: "office", title: "Бумага офисная А4, 80 г/м², 500 листов, класс B", description: "Бумага повышенной белизны для документов.", price: 465, image: img("paper"), quantity: 3000, rating: 4.8, attributes: { format: "А4", density: "80 г/м²" }, keywords: ["бумага", "офисная", "а4", "канцтовары", "опт"] },
  { sku: "DEMO-B2B-GL-3", seller: "demo-b2b-pack", category: "ppe", title: "Перчатки рабочие ХБ с ПВХ, пара, эконом", description: "Перчатки для разовых работ и упаковки.", price: 55, image: img("gloves"), quantity: 12000, rating: 4.3, attributes: { material: "хлопок + ПВХ", unit: "пара" }, keywords: ["перчатки", "рабочие", "хб", "сиз", "опт"] },
];
