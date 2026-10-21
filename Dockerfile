# Use an official Node runtime as the base image
FROM node:24-slim AS base
WORKDIR /usr/src/app
RUN npm install --global --ignore-scripts pnpm@11.1.0

# Build stage - install ALL dependencies and build
FROM base AS build
ENV HUSKY=0
# pnpm refreshes the workspace after package manifests are copied; CI mode
# keeps that reinstall non-interactive inside Docker.
ENV CI=true
# Copy the pnpm lockfile and workspace manifests first for better caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/engine/package.json ./packages/engine/
COPY packages/engine-api/package.json ./packages/engine-api/
COPY packages/engine-lib/package.json ./packages/engine-lib/
COPY packages/shared/package.json ./packages/shared/
COPY packages/zbin/package.json ./packages/zbin/
COPY packages/db/package.json ./packages/db/
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --store-dir=/pnpm/store

# Copy only what's needed for build
COPY tsconfig.json tsconfig.base.json ./
COPY vite.config.ts ./
COPY eslint.config.js ./
COPY index.html ./
COPY client-api.json ./
COPY resources ./resources
COPY src ./src
COPY packages ./packages
# build-prod runs scripts/buildAssetHashes.ts after vite, to emit
# static/asset-hashes.json and static/core-version.txt. Without this the
# image build fails at that step with
# ERR_MODULE_NOT_FOUND -- the unit suite cannot catch it, because only the
# container build runs build-prod from a copied tree.
COPY scripts ./scripts

ARG GIT_COMMIT=unknown
ENV GIT_COMMIT="$GIT_COMMIT"
RUN pnpm run build-prod

# Production dependencies stage - separate from build
FROM base AS prod-deps
ENV HUSKY=0
ENV NPM_CONFIG_IGNORE_SCRIPTS=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/engine/package.json ./packages/engine/
COPY packages/engine-api/package.json ./packages/engine-api/
COPY packages/engine-lib/package.json ./packages/engine-lib/
COPY packages/shared/package.json ./packages/shared/
COPY packages/zbin/package.json ./packages/zbin/
COPY packages/db/package.json ./packages/db/
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --ignore-scripts --store-dir=/pnpm/store

# Final production image
FROM base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    nginx \
    curl \
    wget \
    supervisor \
    apache2-utils \
    && rm -rf /var/lib/apt/lists/*

# Update worker_connections in nginx.conf
RUN sed -i 's/worker_connections [0-9]*/worker_connections 8192/' /etc/nginx/nginx.conf

# Setup supervisor configuration
RUN mkdir -p /var/log/supervisor
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Copy Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN rm -f /etc/nginx/sites-enabled/default

# Script that generates the create-game worker upstream at container start.
COPY generate-nginx-upstream.sh /usr/local/bin/generate-nginx-upstream.sh
RUN chmod +x /usr/local/bin/generate-nginx-upstream.sh

# Copy production node_modules from prod-deps stage (cached separately from build)
COPY --from=prod-deps /usr/src/app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy built artifacts from build stage
COPY --from=build /usr/src/app/static ./static

COPY resources ./resources

# Remove maps because they are not used by the server.
RUN rm -rf ./resources/maps
COPY tsconfig.json tsconfig.base.json ./
COPY client-api.json ./
COPY src ./src
# node_modules/@openfront/* are symlinks into packages/; without this copy
# they dangle and the server dies at boot.
COPY packages ./packages


ARG GIT_COMMIT=unknown
RUN echo "$GIT_COMMIT" > static/commit.txt

ENV GIT_COMMIT="$GIT_COMMIT"

RUN <<'EOF' tee /usr/local/bin/start.sh
#!/bin/sh
# Generate the create-game nginx upstream from NUM_WORKERS before nginx starts.
/usr/local/bin/generate-nginx-upstream.sh
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
EOF
RUN chmod +x /usr/local/bin/start.sh
ENTRYPOINT ["/usr/local/bin/start.sh"]
