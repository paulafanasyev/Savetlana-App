import { prisma } from "../prisma";

const BASE_CATEGORIES = [
  ["electronics", "Электроника"],
  ["clothing-shoes", "Одежда и обувь"],
  ["home-garden", "Дом и сад"],
  ["beauty-health", "Красота и здоровье"],
  ["children", "Детские товары"],
  ["sport-leisure", "Спорт и отдых"],
  ["auto", "Авто"],
  ["books", "Книги"],
  ["hobby-creativity", "Хобби и творчество"],
  ["food", "Продукты"],
  ["pets", "Зоотовары"],
  ["gifts", "Подарки"],
] as const;

const CHILD_CATEGORIES: Record<string, readonly [string, string][]> = {
  electronics: [["phones", "Телефоны и планшеты"], ["computers", "Компьютеры"], ["audio", "Аудио"]],
  "clothing-shoes": [["women-clothing", "Женская одежда"], ["men-clothing", "Мужская одежда"], ["shoes", "Обувь"]],
  "home-garden": [["furniture", "Мебель"], ["kitchen", "Кухня"], ["garden", "Сад"]],
  "beauty-health": [["cosmetics", "Косметика"], ["care", "Уход"], ["health", "Здоровье"]],
  children: [["toys", "Игрушки"], ["kids-clothing", "Одежда для детей"]],
  "sport-leisure": [["fitness", "Фитнес"], ["outdoor", "Туризм и отдых"]],
  auto: [["parts", "Запчасти"], ["accessories", "Аксессуары для авто"]],
  books: [["fiction", "Художественная литература"], ["education-books", "Учебная литература"]],
  "hobby-creativity": [["handmade", "Рукоделие"], ["collecting", "Коллекционирование"]],
  food: [["groceries", "Бакалея"], ["farm", "Фермерские продукты"]],
  pets: [["pet-food", "Корма"], ["pet-care", "Уход за животными"]],
  gifts: [["souvenirs", "Сувениры"], ["gift-sets", "Подарочные наборы"]],
};

/** Создаёт базовое дерево только на пустой базе. Повторный вызов безопасен. */
export async function ensureBaseCategories() {
  if ((await prisma.category.count()) > 0) {
    return prisma.category.findMany({ orderBy: [{ parentId: "asc" }, { name: "asc" }] });
  }

  const parents = new Map<string, string>();
  for (const [slug, name] of BASE_CATEGORIES) {
    const category = await prisma.category.upsert({
      where: { slug },
      create: { slug, name },
      update: { name },
    });
    parents.set(slug, category.id);
  }
  for (const [parentSlug, children] of Object.entries(CHILD_CATEGORIES)) {
    const parentId = parents.get(parentSlug);
    if (!parentId) continue;
    for (const [slug, name] of children) {
      await prisma.category.upsert({
        where: { slug },
        create: { slug, name, parentId },
        update: { name, parentId },
      });
    }
  }
  return prisma.category.findMany({ orderBy: [{ parentId: "asc" }, { name: "asc" }] });
}
