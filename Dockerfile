# syntax=docker/dockerfile:1.7
# Svetlana AI Commerce: production image for a self-hosted VPS.
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone NODE_ENV=production
RUN npm run db:generate:production --workspace=apps/web && cd apps/web && npx next build

# tools: prisma CLI + tsx for migrations and one-off scripts
FROM build AS tools
WORKDIR /repo/apps/web
CMD ["npx", "prisma", "migrate", "deploy", "--schema=prisma-postgres/schema.prisma"]

FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 STORAGE_PROVIDER=local STORAGE_LOCAL_DIR=/data/uploads
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /repo/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=node:node /repo/node_modules/@prisma ./node_modules/@prisma
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health?mode=liveness').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
