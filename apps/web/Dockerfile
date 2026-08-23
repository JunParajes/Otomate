# ── Stage 1: builder ──────────────────────────────────────────
FROM node:20-alpine AS builder

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

RUN pnpm --filter @otomate/shared build
RUN pnpm --filter web build

# ── Stage 2: runner ───────────────────────────────────────────
FROM nginx:alpine AS runner

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# React Router: serve index.html for all routes
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# nginx treats SIGTERM as a *fast* shutdown: it drops connections that are
# still being served. Docker sends SIGTERM by default, so removing the outgoing
# container during a rolling deploy cut whatever request was in flight —
# measured as one failed request per deploy. SIGQUIT is nginx's graceful
# shutdown: finish what is in progress, then exit.
STOPSIGNAL SIGQUIT

EXPOSE 80

HEALTHCHECK --interval=5s --timeout=5s --start-period=10s \
  CMD wget --spider -q http://127.0.0.1:80/ || exit 1
