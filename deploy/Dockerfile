FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
WORKDIR /app
COPY package*.json ./
COPY packages/core/package.json packages/core/package.json
COPY apps/mcp/package.json apps/mcp/package.json
COPY apps/review/package.json apps/review/package.json
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS scanner
ARG TARGETARCH=amd64
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN case "$TARGETARCH" in amd64) arch=x64;; arm64) arch=arm64;; *) exit 1;; esac; \
    curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_${arch}.tar.gz" -o /tmp/gitleaks.tar.gz && \
    curl -fsSL 'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_checksums.txt' -o /tmp/checksums.txt && \
    grep " gitleaks_8.30.1_linux_${arch}.tar.gz$" /tmp/checksums.txt | sed 's@  .*@  /tmp/gitleaks.tar.gz@' | sha256sum -c - && \
    tar -xzf /tmp/gitleaks.tar.gz -C /usr/local/bin gitleaks

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY --from=build --chown=node:node /app/config ./config
COPY --from=build --chown=node:node /app/apps/review/src/styles.css ./apps/review/src/styles.css
COPY --from=scanner /usr/local/bin/gitleaks /usr/local/bin/gitleaks
USER node
CMD ["node","dist/apps/mcp/src/index.js"]
