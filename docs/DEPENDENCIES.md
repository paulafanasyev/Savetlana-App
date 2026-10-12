# Зависимости АИКО

- Уязвимости ловит CI (`npm audit --audit-level=high --omit=dev`) и Dependabot security updates.
- Dependabot (`.github/dependabot.yml`) раз в неделю присылает только minor/patch-обновления.
- Мажорные версии (Prisma, Next.js, ESLint, Vitest) — только вручную отдельным PR с прогоном всех тестов и сборки.
- Ничего не вливается без зелёного Release gate.

История: 2026-10-13 — source-map-js 1.2.1 → 1.2.2 (GHSA-68fv-2mgg-jv7q, high).
