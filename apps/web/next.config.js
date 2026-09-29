/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Server-side only: API route handlers must never be bundled for the client.
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
  images: {
    // P0 fix (audit §24): a wildcard hostname allowed any HTTPS image host to
    // be proxied through us. Restricted to the hosts the platform actually
    // uses; product photos and avatars are served from these CDNs.
    remotePatterns: [
      { protocol: "https", hostname: "images.svetlana.example" },
      { protocol: "https", hostname: "cdn.svetlana.example" },
      { protocol: "https", hostname: "avatars.svetlana.example" },
    ],
  },
  // Security headers applied to every response.
  async headers() {
    // Content-Security-Policy (P0 fix, audit §24). 'unsafe-inline' is scoped to
    // style only — React inline styles need it; scripts are hash/nonce-free
    // because the app ships no inline <script> with logic.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
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
