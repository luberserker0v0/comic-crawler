FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/shared ./shared
COPY --from=deps /app/backend ./backend
COPY --from=deps /app/frontend ./frontend
COPY . ./

ENV NODE_ENV=production
RUN npm run build:shared && npm run build:backend && npm run build:frontend
RUN npm prune --omit=dev

FROM base AS runner
ENV NODE_ENV=production
ENV COMICCRAWLER_HOST=0.0.0.0
ENV COMICCRAWLER_PORT=4100
ENV COMICCRAWLER_DATA_PATH=/app/data
ENV STATIC_DIR=/app/static

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 app

COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/src/adapter/sites ./backend/src/adapter/sites
COPY --from=builder /app/frontend/dist ./static
COPY --from=builder /app/docs ./docs
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/backend/package.json ./backend/

RUN mkdir -p /app/data /app/downloads && chown -R app:nodejs /app

USER app
WORKDIR /app

EXPOSE 4100

CMD ["node", "backend/dist/main.js"]
