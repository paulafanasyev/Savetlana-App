import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

/** Поисковикам открыт каталог и карточки, закрыты кабинеты, корзина и служебные страницы. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
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
        ],
      },
    ],
    sitemap: siteUrl("/sitemap.xml"),
  };
}
