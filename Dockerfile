# Base stage with pnpm setup
FROM node:22.22.0-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# Production dependencies stage
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
# Install only production dependencies
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile --ignore-scripts

# Build stage - install all dependencies and build
FROM base AS build
COPY package.json pnpm-lock.yaml ./
# Install all dependencies (including dev dependencies)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm run build

# Shared runner base
FROM node:22.22.0-alpine AS runner
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node

# Worker target — ENTRYPOINT/CMD split so args are overridable
FROM runner AS worker
ENTRYPOINT ["node", "dist/fee-collector/worker.js"]
CMD ["--chain", "polygon"]

# API target (default when no --target is specified)
FROM runner AS api
EXPOSE 8080
CMD ["node", "dist/index.js"]
