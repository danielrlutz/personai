FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/agent-debug/package.json apps/agent-debug/package.json
RUN pnpm install --filter @personai/agent-debug... --frozen-lockfile=false
COPY apps/agent-debug ./apps/agent-debug
WORKDIR /app/apps/agent-debug
RUN pnpm build
WORKDIR /app
RUN pnpm --filter @personai/agent-debug deploy --prod /deploy \
  && cp -r apps/agent-debug/dist /deploy/dist \
  && mkdir -p /deploy/public \
  && cp -r apps/agent-debug/public/. /deploy/public/

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8790
ENV HOST=0.0.0.0
ENV DATA_DIR=/app/data/agent-debug
COPY --from=build /deploy ./
# Static UI is served from dist/public (build copies it); keep a sibling copy too.
RUN mkdir -p /app/data/agent-debug \
  && if [ -d /app/public ] && [ ! -d /app/dist/public ]; then cp -r /app/public /app/dist/public; fi
EXPOSE 8790
CMD ["node", "dist/index.js"]
