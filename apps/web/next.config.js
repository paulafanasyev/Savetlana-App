/** @type {import('next').NextConfig} */
const path = require("node:path");

// Docker/VPS builds set NEXT_OUTPUT=standalone; Vercel builds keep the default.
const standalone = process.env.NEXT_OUTPUT === "standalone";

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
    ],
  },
  async rewrites() {
    return [
      {
        source: "/images/svetlana.jpg",
        destination: "https://raw.githubusercontent.com/paulafanasyev/Svetlana-2.0/svetlana-2.0-core-development-0416c/public/images/avatar/svetlana-master.jpg",
      },
    ];
  },
  async headers() {
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
