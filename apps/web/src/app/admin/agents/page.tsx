import Link from "next/link";
import type { ReactNode } from "react";
import { getAgentEffectiveness } from "@/lib/domains/agent-effectiveness";

export const dynamic = "force-dynamic";

const rub = (k: number) => `${Math.round(k / 100).toLocaleString("ru-RU")} ₽`;
const pct = (v: number) => `${String(v).replace(".", ",")}%`;

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="text-xs uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="mt-1 text-2xl font-bold text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-soft">{hint}</div>}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="text-base font-bold text-ink">{title}</h2>
        <p className="text-xs text-ink-soft">{note}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

export default async function AdminAgentsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const s = await getAgentEffectiveness({ days });
  const n = s.negotiations;
  const q = s.quotes;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold text-ink">Эффективность агента B2B</h2>
        <nav className="flex gap-2 text-sm">
          {[7, 30, 90].map((d) => (
            <Link key={d} href={`/admin/agents?days=${d}`} className={d === days ? "font-semibold text-ink underline" : "text-ink-soft underline"}>
              {d} дн.
            </Link>
          ))}
        </nav>
      </div>

      <Section title="Торг агентов" note="Каждый запуск торга записан в журнал аудита: режим, итог, раунды, сколько продавцов спросили.">
        <Stat label="Торгов" value={n.total} hint={`из них запросов цены у нескольких продавцов: ${n.rfq}`} />
        <Stat label="Договорились" value={pct(n.agreementRate)} hint={`${n.agreed} из ${n.total}; без сделки ${n.noDeal}, нужен человек ${n.needsHuman}`} />
        <Stat label="Раундов в среднем" value={String(n.avgRounds).replace(".", ",")} hint="предложений и встречных без участия людей" />
        <Stat label="Продавцов опрошено" value={n.sellersAsked} />
      </Section>

      <Section title="КП и заказы" note="Человек в контуре: продавец подтверждает КП, покупатель сам оформляет заказ.">
        <Stat label="КП создано" value={q.total} hint={`ждут продавца ${q.awaiting}, истекли ${q.expired}`} />
        <Stat label="Продавцы приняли" value={pct(q.sellerAcceptRate)} hint={`отклонили ${q.declined}`} />
        <Stat label="КП → заказ" value={pct(q.orderConversion)} hint={`заказов по КП: ${q.ordered}`} />
        <Stat label="Ответ продавца" value={q.medianSellerResponseMin === null ? "нет данных" : `${q.medianSellerResponseMin} мин`} hint="медиана от КП до решения" />
      </Section>

      <Section title="Деньги" note="Только оформленные заказы по КП.">
        <Stat label="Оборот по КП" value={rub(s.money.orderedGmvKopecks)} />
        <Stat label="Экономия покупателей" value={rub(s.money.buyerSavingsKopecks)} hint="разница с ценой прайса × количество" />
        <Stat label="Средняя скидка" value={pct(q.avgDiscountPercent)} hint="по всем КП периода" />
      </Section>

      <Section title="Безопасность и контроль" note="Что агенты и проверки отбили за период.">
        <Stat label="Подмена цены заблокирована" value={s.safety.priceTamperBlocks} hint="правило R5 при оплате" />
        <Stat label="Подделанных КП" value={s.safety.quoteTampered} hint="не совпал отпечаток условий" />
        <Stat label="Команды в тексте проигнорированы" value={s.safety.injectionsIgnored} hint="попытки управлять агентом через комментарий" />
      </Section>

      <Section title="Модель" note="Вызовы AI за период (метаданные, без содержимого).">
        <Stat label="Вызовов" value={s.ai.calls} />
        <Stat label="Успешных" value={pct(s.ai.successRate)} />
        <Stat label="Средняя задержка" value={`${s.ai.avgLatencyMs} мс`} />
      </Section>
    </div>
  );
}
