import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

/**
 * Сборщики данных для обучения ИИ и программы-зеркала: сайт целиком закрыт
 * (защита от копирования контента). На обычные поисковики не влияет.
 */
const AI_TRAINING_AND_MIRROR_BOTS = [
  "GPTBot",
  "CCBot",
  "ClaudeBot",
  "anthropic-ai",
  "Claude-Web",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "meta-externalagent",
  "FacebookBot",
  "cohere-ai",
  "Diffbot",
  "Omgilibot",
  "ImagesiftBot",
  "Amazonbot",
  "HTTrack",
  "WebCopier",
  "Offline Explorer",
  "Teleport",
  "WebZIP",
  "SiteSucker",
  "wget",
];

/**
 * Поисковые роботы ИИ-сервисов: они не учат модели, а отвечают людям со ссылкой на
 * источник («где купить ножи» → ссылка на АИКО). Им открыто то же, что обычным
 * поисковикам. Робот с отдельной группой правил не читает общую группу «*», поэтому
 * запреты кабинетов повторены для них явно.
 */
export const AI_SEARCH_BOTS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "Claude-SearchBot",
  "Claude-User",
  "YouBot",
];

/** Закрыто для всех поисковиков: кабинеты, корзина, переписка и служебные страницы. */
const PRIVATE_PATHS = [
  "/api/",
  "/admin",
  "/admin-recovery",
  "/seller",
  "/cart",
  "/checkout",
  "/profile",
  "/orders",
  "/messages",
  "/notifications",
  "/favorites",
  "/disputes",
  "/gifts",
  "/recommendations",
  "/login",
  "/register",
  "/password-reset",
  "/reset-password",
  "/verify-email",
  "/search",
  "/promote",
  "/checkpoint/",
  "/classifieds/new",
  "/classifieds/my",
  "/classifieds/*/chat",
  "/classifieds/*/replies",
];

/** Поисковикам открыт каталог и карточки, закрыты кабинеты, корзина, переписка и служебные страницы. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: AI_TRAINING_AND_MIRROR_BOTS, disallow: "/" },
      { userAgent: AI_SEARCH_BOTS, allow: "/", disallow: PRIVATE_PATHS },
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
    ],
    sitemap: siteUrl("/sitemap.xml"),
  };
}
