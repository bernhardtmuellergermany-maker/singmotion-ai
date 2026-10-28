FROM node:24.22.1-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24.22.1-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production DEMO_MODE=true GENERATIONS_ENABLED=false ADMIN_DEMO_ENABLED=false BYTEPLUS_LIVE_TEST_ENABLED=false STAGING_AUTH_ENABLED=true DATA_DIR=/app/.data
COPY --from=builder --chown=node:node /app /app
# Only this root-owned initializer executes before dropping privileges.
COPY --chmod=0444 scripts/container-entrypoint.mjs /usr/local/lib/singmotion-entrypoint.mjs
RUN mkdir -p /app/.data && chown node:node /app/.data && chown root:root /app
USER root
EXPOSE 3000
ENTRYPOINT ["node", "/usr/local/lib/singmotion-entrypoint.mjs"]
