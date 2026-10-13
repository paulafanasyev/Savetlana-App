import { requireUserServer } from "@/lib/auth";
import { getMemory } from "@/lib/domains/memory";
import { integrationStatus, env } from "@/lib/env";
import { aiMode } from "@/lib/ai/gateway";
import { deliveryHistory, deliveryStatusLabel, NOTIFICATION_CHANNELS } from "@/lib/notification-delivery";

export const dynamic = "force-dynamic";

export const metadata = { title: "Конфиденциальность" };

export default async function PrivacyPage() {
  // The Privacy Center works even for anonymous visitors for the policy part.
  const session = await requireUserServer().catch(() => null);
  const memory = session ? await getMemory(session.user.id) : [];
  const deliveries = session ? await deliveryHistory(session.user.id, 20) : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-ink">Конфиденциальность</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Мы не собираем данные только потому, что это технически возможно. Всё, что
        Светлана помнит, вы можете увидеть, изменить или удалить.
      </p>

      {session ? (
        <section className="mt-8 card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-ink">Что Светлана знает обо мне</h2>
            <span className="chip">{memory.length} записей</span>
          </div>
          {memory.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">Пока ничего не сохранено.</p>
          ) : (
            <ul className="mt-3 divide-y divide-surface-line text-sm">
              {memory.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div>
                    <div className="font-medium text-ink">{m.key}</div>
                    <div className="text-ink-soft">{m.value}</div>
                    {m.type === "INFERENCE" && (
                      <div className="mt-0.5 text-xs text-ink-faint">
                        предположение, уверенность {Math.round((m.confidence ?? 0) * 100)}% ·
                        основание: {m.evidence ?? "—"}
                      </div>
                    )}
                    {m.type === "FACT" && <div className="mt-0.5 text-xs text-ink-faint">факт, указанный вами</div>}
                    {m.type === "PREFERENCE" && <div className="mt-0.5 text-xs text-ink-faint">предпочтение</div>}
                  </div>
                  <form
                    action={`/api/memory/${m.id}`}
                    method="POST"
                  >
                    <button className="btn btn-ghost px-2 py-1 text-xs text-bad" type="submit">
                      Забыть
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="mt-8 card p-5 text-sm text-ink-soft">
          Войдите в аккаунт, чтобы увидеть и управлять тем, что Светлана о вас помнит.
        </section>
      )}

      <section className="mt-8 card p-5">
        <h2 className="text-base font-bold text-ink">Каналы уведомлений</h2>
        <ul className="mt-3 divide-y divide-surface-line text-sm">
          {NOTIFICATION_CHANNELS.map((channel) => (
            <li key={channel.channel} className="flex justify-between py-2.5">
              <span className="text-ink">
                {channel.channel === "email" ? "Email" : "Push-уведомления"}
              </span>
              <span
                className={channel.configured() ? "font-medium text-ok" : "font-medium text-amber-700"}
              >
                {channel.configured() ? "подключено" : "пока не подключено"}
              </span>
            </li>
          ))}
        </ul>
        {session ? (
          deliveries.length > 0 ? (
            <>
              <h3 className="mt-5 text-sm font-bold text-ink">Что было отправлено</h3>
              <ul className="mt-2 divide-y divide-surface-line text-xs text-ink-soft">
                {deliveries.map((d) => (
                  <li key={d.id} className="flex justify-between gap-3 py-2">
                    <span>
                      {d.notification.title} → {d.channel} ({d.address})
                    </span>
                    <span className="shrink-0">{deliveryStatusLabel(d.status)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-3 text-xs text-ink-soft">
              Пока ни одно уведомление не отправлялось за пределы сайта.
            </p>
          )
        ) : null}
      </section>

      <section className="mt-8 card p-5">
        <h2 className="text-base font-bold text-ink">Готовность интеграций</h2>
        <p className="mt-2 text-xs text-ink-soft">
          Честный статус: интеграция считается рабочей, только когда настроены её
          учётные данные. Остальные явно отмечены как ожидающие внешнего доступа.
        </p>
        <ul className="mt-3 divide-y divide-surface-line text-sm">
          {Object.entries(integrationStatus).map(([key, status]) => (
            <li key={key} className="flex justify-between py-2.5">
              <span className="text-ink">{integrationLabel(key)}</span>
              <span className={status === "READY" ? "font-medium text-ok" : "font-medium text-amber-700"}>
                {status === "READY" ? "подключено" : "ожидает доступа"}
              </span>
            </li>
          ))}
          <li className="flex justify-between py-2.5">
            <span className="text-ink">Помощник Светлана</span>
            <span className="font-medium text-ink">{aiMode().mode === "LIVE" ? "работает" : "демо-режим"}</span>
          </li>
        </ul>
      </section>

      <section className="mt-8 card p-5">
        <h2 className="text-base font-bold text-ink">Политика данных</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-soft">
          <li>Секреты (ключи, токены, платёжные реквизиты) никогда не передаются в AI-модель.</li>
          <li>Перед каждым запросом к модели данные классифицируются и минимизируются.</li>
          <li>Память можно удалить — мы не используем её для обучения без отдельного процесса.</li>
          <li>Рекомендации можно отключить в любой момент.</li>
          <li>Комиссия платформы настраивается и не скрыта: сейчас {env.platformFeePercent}%.</li>
        </ul>
      </section>
    </div>
  );
}

function integrationLabel(key: string): string {
  const map: Record<string, string> = {
    externalAi: "Внешний AI-провайдер",
    payment: "Оплата картой и СБП",
    delivery: "Службы доставки",
    vk: "Вход через ВКонтакте",
    esia: "Госуслуги (ЕСИА)",
    alipay: "Alipay",
    internationalPayments: "Международные платежи",
    storage: "Хранилище фото и документов",
  };
  return map[key] ?? key;
}
