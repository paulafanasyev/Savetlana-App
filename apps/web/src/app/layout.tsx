import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { Header } from "@/components/Header";
import { SvetlanaDock } from "@/components/SvetlanaDock";
import { GuestCartSync } from "@/components/GuestCartSync";
import { ConsentGateServer } from "@/components/ConsentGateServer";
import { WeatherWidget } from "@/components/WeatherWidget";
import { PromoLayout } from "@/components/PromoRail";
import { ViewToggle } from "@/components/ViewToggle";
import { env } from "@/lib/env";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/seo";
import { VIEW_COOKIE, isDesktopView, parseViewPref, viewportFor } from "@/lib/viewport";

// The whole app is auth-gated and interactive, so pages render per request.
// Setting this at the root propagates to every route and synthesized page.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: `${SITE_NAME}: ${SITE_TAGLINE.toLowerCase()}`,
    template: `%s · ${SITE_NAME}`,
  },
  description:
    "АИКО: маркетплейс, где ИИ-помощник Светлана помогает найти товар, выбрать подарок, оформить заказ, а продавцам продавать и разбирать продажи.",
  applicationName: SITE_NAME,
  authors: [{ name: "Афанасьев Павел Петрович" }],
  creator: "Афанасьев Павел Петрович",
  metadataBase: new URL(env.publicAppUrl),
  alternates: { canonical: "/" },
  openGraph: {
    title: `${SITE_NAME}: ${SITE_TAGLINE.toLowerCase()}`,
    description: "Покупки и продажи с ИИ-помощником Светланой",
    siteName: SITE_NAME,
    locale: "ru_RU",
    type: "website",
  },
};

async function viewState() {
  const ua = (await headers()).get("user-agent");
  const pref = parseViewPref((await cookies()).get(VIEW_COOKIE)?.value);
  return { ua, pref };
}

/** «Полная версия»: кнопка в подвале или настройка браузера телефона (lib/viewport.ts). */
export async function generateViewport(): Promise<Viewport> {
  const { ua, pref } = await viewState();
  return viewportFor(ua, pref);
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { ua, pref } = await viewState();
  const desktop = isDesktopView(ua, pref);
  return (
    <html lang="ru">
      <body className="min-h-screen flex flex-col">
        {/* Тонкая полоска над шапкой: мой город и погода в нём. */}
        <div className="border-b border-surface-line bg-surface-muted">
          <div className="mx-auto flex min-h-7 max-w-6xl items-center justify-end px-4">
            <WeatherWidget />
          </div>
        </div>
        <Header />
        {/* На широком экране справа колонка продвижения, на телефоне лента под страницей. */}
        <PromoLayout>{children}</PromoLayout>
        <footer className="border-t border-surface-line bg-white px-4 py-8 text-center text-xs text-ink-soft">
          <div className="mx-auto max-w-6xl space-y-2">
            <div className="font-semibold text-ink">{SITE_NAME}</div>
            <div>Маркетплейс с ИИ-помощником Светланой. Покупки и продажи в одном месте.</div>
            <div className="flex flex-wrap justify-center gap-4 pt-2">
              <a href="/privacy" className="hover:text-svetlana-700">Конфиденциальность</a>
              <a href="/svetlana" className="hover:text-svetlana-700">Светлана</a>
              <a href="/favorites" className="hover:text-svetlana-700">Избранное</a>
              <a href="/sell" className="font-medium text-svetlana-700 hover:underline">Продавать на АИКО</a>
              <a href="/seller" className="hover:text-svetlana-700">Кабинет продавца</a>
              <a href="/city" className="hover:text-svetlana-700">Мой город и погода</a>
              <a href="/promote" className="hover:text-svetlana-700">Продвижение от 5 ₽</a>
            </div>
            <div className="flex flex-wrap justify-center gap-4">
              <a href="/legal/payment-delivery" className="hover:text-svetlana-700">Оплата и доставка</a>
              <a href="/legal/returns" className="hover:text-svetlana-700">Возврат и обмен</a>
              <a href="/legal/offer" className="hover:text-svetlana-700">Оферта</a>
              <a href="/contacts" className="hover:text-svetlana-700">Контакты и реквизиты</a>
            </div>
            <div className="pt-2">
              <ViewToggle desktop={desktop} />
            </div>
            <div className="pt-2">
              © 2026 Афанасьев Павел Петрович. Все права защищены. Копирование материалов сайта без письменного разрешения запрещено.
            </div>
          </div>
        </footer>
        <SvetlanaDock />
        <GuestCartSync />
        <ConsentGateServer />
        {/* Защита от копирования: источник к скопированному тексту, картинки не сохраняются (public/copy-guard.js). */}
        <Script src="/copy-guard.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
