import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { SvetlanaDock } from "@/components/SvetlanaDock";
import { GuestCartSync } from "@/components/GuestCartSync";

// The whole app is auth-gated and interactive, so pages render per request.
// Setting this at the root propagates to every route and synthesized page.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "Светлана — AI-платформа",
    template: "%s · Светлана",
  },
  description:
    "Светлана — AI-платформа, где ИИ-помощник помогает найти товар, выбрать подарок, продавать и анализировать продажи.",
  metadataBase: new URL("https://svetlana.marketplace"),
  alternates: { canonical: "/" },
  openGraph: {
    title: "Светлана — AI-платформа",
    description: "Покупки и продажи с интеллектуальным помощником",
    locale: "ru_RU",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-surface-line bg-white px-4 py-8 text-center text-xs text-ink-soft">
          <div className="mx-auto max-w-6xl space-y-2">
            <div className="font-semibold text-ink">Светлана AI Commerce</div>
            <div>Платформа с интеллектуальным помощником. Покупки и продажи в одном месте.</div>
            <div className="flex flex-wrap justify-center gap-4 pt-2">
              <a href="/privacy" className="hover:text-svetlana-700">Конфиденциальность</a>
              <a href="/svetlana" className="hover:text-svetlana-700">Светлана</a>
              <a href="/favorites" className="hover:text-svetlana-700">Избранное</a>
              <a href="/seller" className="hover:text-svetlana-700">Кабинет продавца</a>
            </div>
            <div className="flex flex-wrap justify-center gap-4">
              <a href="/legal/payment-delivery" className="hover:text-svetlana-700">Оплата и доставка</a>
              <a href="/legal/returns" className="hover:text-svetlana-700">Возврат и обмен</a>
              <a href="/legal/offer" className="hover:text-svetlana-700">Оферта</a>
              <a href="/contacts" className="hover:text-svetlana-700">Контакты и реквизиты</a>
            </div>
          </div>
        </footer>
        <SvetlanaDock />
        <GuestCartSync />
      </body>
    </html>
  );
}
