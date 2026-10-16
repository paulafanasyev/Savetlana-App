import Link from "next/link";
import { requireUserServer } from "@/lib/auth";
import { loadPortfolio } from "@/lib/domains/portfolio";
import { portfolioBucket } from "@/lib/portfolio";
import { PortfolioEditor } from "./PortfolioEditor";

export const dynamic = "force-dynamic";

/** Редактор портфолио исполнителя: о себе, навыки, работы с фото. */
export default async function PortfolioPage() {
  const { user } = await requireUserServer();
  const portfolio = await loadPortfolio(user.id);
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Портфолио исполнителя</h1>
        <p className="text-sm text-ink-soft">
          Заказчики видят это в вашем профиле, когда выбирают исполнителя.{" "}
          <Link href={`/performers/${user.id}`} className="underline">Посмотреть, как видят заказчики</Link>
        </p>
        <p className="mt-1 text-xs text-ink-faint">Не добавляйте телефон, почту и номер карты: оплата идёт через безопасную сделку, а переписка в чате по заказу.</p>
      </div>
      <PortfolioEditor initial={portfolio} bucket={portfolioBucket(user.id)} />
    </main>
  );
}
