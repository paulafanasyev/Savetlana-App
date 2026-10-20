/** @type {import('next').NextConfig} */
const path = require("node:path");
const fs = require("node:fs");

// Docker/VPS builds set NEXT_OUTPUT=standalone; Vercel builds keep the default.
const standalone = process.env.NEXT_OUTPUT === "standalone";

// Книга чек-поинта (/checkpoint/aiko-book.html) читает подробное описание из docs.
// Копируем его в public при сборке, чтобы источник был один (docs/checkpoint-rlt).
try {
  const src = path.join(__dirname, "../../docs/checkpoint-rlt/AIKO_checkpoint.md");
  const dst = path.join(__dirname, "public/checkpoint/aiko-checkpoint.md");
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
} catch {
  // не мешаем сборке: книга покажет ссылку на документ вместо текста
}

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(standalone
    ? { output: "standalone", outputFileTracingRoot: path.join(__dirname, "../../") }
    : {}),
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.svetlana.example" },
      { protocol: "https", hostname: "cdn.svetlana.example" },
      { protocol: "https", hostname: "avatars.svetlana.example" },
      // Публичные фото из Vercel Blob (товары, объявления, портфолио).
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
  async rewrites() {
    // Фото Светланы лежит в этом репо (public/images/avatar). Старый адрес
    // оставлен как синоним, чтобы ничего не сломалось.
    return [
      {
        source: "/images/svetlana.jpg",
        destination: "/images/avatar/svetlana-master.jpg",
      },
    ];
  },
  async headers() {
    // Next.js App Router передаёт данные страницы встроенными <script>. Если их
    // запретить, страница видна при загрузке и сразу пропадает (пустой экран).
    // Встраивать страницы во фрейм можно только с нашего же сайта (живые экраны на
    // страницах /checkpoint); чужие сайты по-прежнему блокируются (защита от clickjacking).
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src 'self'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
