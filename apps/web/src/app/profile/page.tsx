import Link from "next/link";
import { requireUserServer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { timeAgo } from "@/lib/format";
import { isVkLive } from "@/lib/domains/vk";
import { isEsiaLive } from "@/lib/domains/esia";
import { telegramStatus } from "@/lib/domains/telegram-link";
import { TelegramConnect } from "@/components/TelegramConnect";
import { VerifyEmailButton } from "./verify-email-button";
import { LogoutAllButton } from "./logout-all-button";
import { ChangePasswordForm } from "./change-password-form";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const ctx = await requireUserServer();
  const user = await prisma.user.findUnique({
    where: { id: ctx.user.id },
    select: {
      email: true,
      emailVerifiedAt: true,
      name: true,
      role: true,
      avatarUrl: true,
      locale: true,
      createdAt: true,
      id: true,
      profile: { select: { displayName: true, phone: true, personalizationOn: true, analyticsOn: true, memoryOn: true } },
      integrationLinks: { select: { provider: true, status: true, linkedAt: true }, where: { status: "ACTIVE" } },
      _count: { select: { orders: true, favorites: true, reviews: true, wishlists: true } },
    },
  });

  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-ink-soft">Профиль не найден.</p>
      </main>
    );
  }

  const [openDisputes, telegram] = await Promise.all([
    prisma.dispute.count({
      where: { buyerId: user.id, status: { notIn: ["CLOSED", "RESOLVED_BUYER", "RESOLVED_SELLER"] } },
    }),
    telegramStatus(user.id).catch(() => ({ configured: false, linked: false, botUsername: null })),
  ]);
  const stats = [
    { label: "Заказов", value: user._count.orders, href: "/orders" },
    { label: "Избранное", value: user._count.favorites, href: "/favorites" },
    { label: "Отзывов", value: user._count.reviews, href: "/orders" },
    { label: "Списки желаний", value: user._count.wishlists, href: "/favorites" },
    { label: "Открытых споров", value: openDisputes, href: "/disputes" },
  ];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold text-ink">Мой профиль</h1>

      <section className="card mb-6 p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-svetlana-600 text-xl font-bold text-white">
            {(user.profile?.displayName ?? user.name ?? user.email)[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-ink">
              {user.profile?.displayName ?? user.name ?? "Без имени"}
            </h2>
            <p className="truncate text-sm text-ink-soft">{user.email}</p>
            <p className="mt-1 text-xs text-ink-soft">
              {user.role === "SELLER" ? "Продавец" : user.role === "ADMIN" ? "Администратор" : "Покупатель"} ·
              зарегистрирован {timeAgo(user.createdAt)}
            </p>
          </div>
        </div>
      </section>

      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="card p-4 transition hover:shadow-float">
            <div className="text-2xl font-bold text-svetlana-700">{s.value}</div>
            <div className="mt-1 text-xs text-ink-soft">{s.label}</div>
          </Link>
        ))}
      </section>

      <section className="card mb-6 p-6">
        <h2 className="mb-4 text-lg font-semibold text-ink">Личные данные</h2>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-soft">Имя</dt>
            <dd className="font-medium text-ink">{user.profile?.displayName ?? user.name ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-soft">Email</dt>
            <dd className="flex items-center gap-2 font-medium text-ink">
              {user.email}
              {user.emailVerifiedAt ? (
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                  Подтверждён
                </span>
              ) : (
                <VerifyEmailButton />
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-soft">Телефон</dt>
            <dd className="font-medium text-ink">{user.profile?.phone ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-soft">Язык</dt>
            <dd className="font-medium text-ink">{user.locale}</dd>
          </div>
        </dl>
        <p className="mt-4 rounded-lg bg-surface-muted p-3 text-xs text-ink-soft">
          Редактирование имени и телефона доступно в разделе «Конфиденциальность».
        </p>
      </section>

      {(telegram.configured || telegram.linked) && (
        <div className="mb-6">
          <TelegramConnect configured={telegram.configured} linked={telegram.linked} endpoint="/api/profile/telegram" audience="user" />
        </div>
      )}

      <SecuritySection />

      <section className="card mb-6 p-6">
        <h2 className="mb-2 text-lg font-semibold text-ink">Подключённые сервисы</h2>
        <p className="mb-4 text-xs text-ink-soft">
          Подключение происходит только через официальный OAuth. Платформа
          запрашивает минимально необходимые разрешения и никогда не хранит
          токены в открытом виде.
        </p>
        <ul className="space-y-3 text-sm">
          <IntegrationRow
            label="ВКонтакте"
            connected={user.integrationLinks.some((l) => l.provider === "vk")}
            live={isVkLive()}
            connectHref="/api/integrations/vk/connect"
            unavailableNote="VK-интеграция ожидает настройки (PENDING_EXTERNAL_ACCESS)"
          />
          <IntegrationRow
            label="ЕСИА / Госуслуги"
            connected={user.integrationLinks.some((l) => l.provider === "esia")}
            live={isEsiaLive()}
            connectHref="/api/integrations/esia/connect"
            unavailableNote="ЕСИА-интеграция ожидает настройки (PENDING_EXTERNAL_ACCESS)"
          />
        </ul>
      </section>

      <section className="card p-6">
        <h2 className="mb-4 text-lg font-semibold text-ink">Настройки AI</h2>
        <ul className="space-y-3 text-sm">
          <li className="flex items-center justify-between gap-4">
            <span className="text-ink-soft">Персонализация рекомендаций</span>
            <Toggle on={user.profile?.personalizationOn ?? false} />
          </li>
          <li className="flex items-center justify-between gap-4">
            <span className="text-ink-soft">Аналитика</span>
            <Toggle on={user.profile?.analyticsOn ?? false} />
          </li>
          <li className="flex items-center justify-between gap-4">
            <span className="text-ink-soft">Память Светланы</span>
            <Toggle on={user.profile?.memoryOn ?? false} />
          </li>
        </ul>
        <Link href="/privacy" className="btn btn-primary mt-5 inline-block px-4 py-2 text-sm">
          Управление конфиденциальностью
        </Link>
      </section>
    </main>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
        on ? "bg-svetlana-600" : "bg-surface-line"
      }`}
      aria-label={on ? "включено" : "выключено"}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
          on ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </span>
  );
}

function SecuritySection() {
  return (
    <section className="card mb-6 p-6">
      <h2 className="mb-2 text-lg font-semibold text-ink">Безопасность аккаунта</h2>
      <p className="mb-4 text-xs text-ink-soft">
        Пароль, сеансы и восстановление доступа.
      </p>
      <ul className="space-y-3 text-sm">
        <li className="flex flex-wrap items-center justify-between gap-x-4 rounded-lg bg-surface-muted px-4 py-3">
          <span className="font-medium text-ink">Сменить пароль</span>
          <ChangePasswordForm />
        </li>
        <li className="flex items-center justify-between gap-4 rounded-lg bg-surface-muted px-4 py-3">
          <span className="font-medium text-ink">Забыли пароль</span>
          <a href="/password-reset" className="text-xs font-medium text-svetlana-700 hover:underline">
            Восстановить
          </a>
        </li>
        <li className="flex items-center justify-between gap-4 rounded-lg bg-surface-muted px-4 py-3">
          <span className="font-medium text-ink">Выйти на всех устройствах</span>
          <LogoutAllButton />
        </li>
      </ul>
    </section>
  );
}

function IntegrationRow(params: {
  label: string;
  connected: boolean;
  live: boolean;
  connectHref: string;
  unavailableNote: string;
}) {
  if (params.connected) {
    return (
      <li className="flex items-center justify-between gap-4 rounded-lg bg-surface-muted px-4 py-3">
        <span className="font-medium text-ink">{params.label}</span>
        <span className="inline-flex items-center gap-2 text-xs text-green-700">
          <span className="h-2 w-2 rounded-full bg-green-600" /> подключено
        </span>
      </li>
    );
  }
  if (!params.live) {
    return (
      <li className="flex items-center justify-between gap-4 rounded-lg border border-dashed border-surface-line px-4 py-3">
        <span className="font-medium text-ink-soft">{params.label}</span>
        <span className="text-xs text-ink-soft" title={params.unavailableNote}>
          недоступно
        </span>
      </li>
    );
  }
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="font-medium text-ink">{params.label}</span>
      <a
        href={params.connectHref}
        className="btn btn-secondary px-3 py-1.5 text-xs"
      >
        Подключить
      </a>
    </li>
  );
}
