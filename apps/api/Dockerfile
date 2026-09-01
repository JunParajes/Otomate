# Two stages, so the devDependencies needed to BUILD do not ship to production.
#
# The single-stage version installed everything and kept it: typescript, vitest,
# supertest, ts-node-dev and esbuild all rode along into a 987 MB image. That
# matters more than it looks. The server is a laptop on a home connection, and
# any change to pnpm-lock.yaml invalidates the install layer — so a deploy has to
# re-download it in full. On 2026-09-01 that took over 20 minutes and the deploy
# step was killed by its timeout.
#
# `prisma` is deliberately a production dependency, not a build tool: the deploy
# runs `prisma migrate deploy` inside this container, and the runtime stage below
# regenerates the client.
#
# The SEED is compiled instead. Dropping ts-node-dev naively broke the deploy —
# the image booted and served perfectly while every deploy failed at
# `prisma db seed` with `spawn ts-node-dev ENOENT`. Adding it back worked but
# left a watcher in production: on a seed error it waited forever instead of
# exiting, turning a readable failure into a stalled deploy.

# ─── builder ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN pnpm --filter @otomate/shared build
RUN pnpm --filter api exec prisma generate
RUN pnpm --filter api build
RUN pnpm --filter api build:seed

# ─── runtime ────────────────────────────────────────────────────────────────
FROM node:20-alpine

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

# Production dependencies only. This is the layer that gets re-downloaded
# whenever the lockfile changes, so what is not in it is what makes a deploy
# finish.
RUN pnpm install --frozen-lockfile --prod

# Compiled output from the builder — no sources, no tsconfig, no test files.
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# The schema and migrations: `prisma migrate deploy` runs against these on every
# deploy, and `prisma generate` below needs the schema.
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma

# The compiled seed, and a package.json pointing at it. Prisma reads the seed
# command from package.json#prisma.seed; locally that is ts-node-dev against the
# source, which is right for development and wrong for an image that should carry
# no compiler.
COPY --from=builder /app/apps/api/dist-seed/seed.js ./apps/api/prisma/seed.js
RUN node -e "const f='apps/api/package.json',p=require('./'+f);p.prisma={seed:'node prisma/seed.js'};require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')"


# Generate against the production install rather than copying the builder's
# client out of pnpm's symlinked store, which is fragile to lay out by hand.
RUN pnpm --filter api exec prisma generate

WORKDIR /app/apps/api

EXPOSE 3001

HEALTHCHECK --interval=5s --timeout=5s --start-period=15s \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
