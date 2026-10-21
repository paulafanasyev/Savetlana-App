export const dynamic = "force-dynamic";

import { SvetlanaChat } from "@/components/SvetlanaChat";

export const metadata = { title: "Светлана, ИИ-помощник" };

const BUYER = {
  intro: "Ваш персональный ИИ-помощник по покупкам. Задайте вопрос обычными словами: она найдёт, сравнит, проверит продавца и поможет оформить заказ.",
  skills: ["🔍 Искать по естественному описанию", "⚖️ Сравнивать товары и цены", "🎁 Подбирать подарки", "📦 Проверять заказы и доставки", "💬 Показывать ответы продавцов"],
  examples: ["«Найди ноутбук до 100 тысяч для учёбы»", "«Что подарить маме до 10 000 рублей?»", "«Где мой заказ?»", "«Наушники дешевле 5000»"],
};

const SELLER = {
  intro: "Ваш ИИ-помощник по продажам. Пишите обычными словами: она разберёт продажи, подскажет цену, запустит скидку и покажет, кто из покупателей ждёт ответа.",
  skills: ["📊 Разбирать продажи и причины спада", "💰 Советовать цену по рынку", "🏷️ Запускать и снимать скидки", "👥 Показывать постоянных покупателей", "💬 Напоминать о сообщениях покупателей", "📝 Готовить карточки товаров"],
  examples: ["«Почему упали продажи?»", "«Сделай скидку 15% на кроссовки»", "«Есть новые сообщения?»", "«Кто мои постоянные покупатели?»", "«Создай карточку товара чайник за 1990»"],
};

export default async function SvetlanaPage({ searchParams }: { searchParams: Promise<{ side?: string }> }) {
  const { side } = await searchParams;
  const seller = side === "seller";
  const copy = seller ? SELLER : BUYER;
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold text-ink">Светлана</h1>
            <p className="mt-1 text-sm text-ink-soft">{copy.intro}</p>
          </div>
          <SvetlanaChat side={seller ? "seller" : "buyer"} className="min-h-[520px]" />
        </div>
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink">Что Светлана умеет</h2>
            <ul className="mt-3 space-y-2 text-sm text-ink-soft">
              {copy.skills.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink">Примеры запросов</h2>
            <ul className="mt-3 space-y-2 text-sm text-ink-soft">
              {copy.examples.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
          <div className="card bg-surface-muted p-5">
            <h2 className="text-sm font-bold text-ink">Честность ответов</h2>
            <p className="mt-2 text-xs leading-relaxed text-ink-soft">
              Светлана никогда не утверждает, что действие выполнено, пока не получит
              реальный результат. Чувствительные действия: оплата, публикация, изменение
              цены, скидки, подтверждение наличия, требуют вашего явного подтверждения.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
