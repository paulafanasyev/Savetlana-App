import { SvetlanaChat } from "@/components/SvetlanaChat";

export const metadata = { title: "Светлана — AI-помощник" };

export default function SvetlanaPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold text-ink">Светлана</h1>
            <p className="mt-1 text-sm text-ink-soft">
              Ваш персональный AI-помощник по покупкам. Задайте вопрос обычными словами —
              она найдёт, сравнит, проверит продавца и поможет оформить заказ.
            </p>
          </div>
          <SvetlanaChat side="buyer" className="min-h-[520px]" />
        </div>
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink">Что Светлана умеет</h2>
            <ul className="mt-3 space-y-2 text-sm text-ink-soft">
              <li>🔍 Искать по естественному описанию</li>
              <li>⚖️ Сравнивать товары и цены</li>
              <li>🎁 Подбирать подарки</li>
              <li>📦 Проверять заказы и доставки</li>
              <li>✅ Подтверждать наличие (для продавцов)</li>
              <li>📊 Анализировать продажи</li>
            </ul>
          </div>
          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink">Примеры запросов</h2>
            <ul className="mt-3 space-y-2 text-sm text-ink-soft">
              <li>«Найди ноутбук до 100 тысяч для учёбы»</li>
              <li>«Что подарить маме до 10 000 рублей?»</li>
              <li>«Где мой заказ?»</li>
              <li>«Сравни наушники до 15 тысяч»</li>
            </ul>
          </div>
          <div className="card bg-surface-muted p-5">
            <h2 className="text-sm font-bold text-ink">Честность ответов</h2>
            <p className="mt-2 text-xs leading-relaxed text-ink-soft">
              Светлана никогда не утверждает, что действие выполнено, пока не получит
              реальный результат от backend. Чувствительные действия — оплата, публикация,
              изменение цены, подтверждение наличия — требуют вашего явного подтверждения.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
