import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

/**
 * Сборщики данных для обучения ИИ и программы-зеркала: сайт целиком закрыт
 * (защита от копирования контента). На обычные поисковики не влияет.
 */
const AI_AND_MIRROR_BOTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "CCBot",
  "ClaudeBot",
  "anthropic-ai",
  "Claude-Web",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "PerplexityBot",
  "meta-externalagent",
  "FacebookBot",
  "cohere-ai",
  "Diffbot",
  "Omgilibot",
  "ImagesiftBot",
  "Amazonbot",
  "YouBot",
  "HTTrack",
  "WebCopier",
  "Offline Explorer",
  "Teleport",
  "WebZIP",
  "SiteSucker",
  "wget",
];

/** Поисковикам открыт каталог и карточки, закрыты кабинеты, корзина, переписка и служебные страницы. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: AI_AND_MIRROR_BOTS, disallow: "/" },
      {
        userAgent: "*",
        allow: "/",
        disallow: [
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
        ],
      },
    ],
    sitemap: siteUrl("/sitemap.xml"),
  };
}
