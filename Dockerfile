FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production DEMO_MODE=true GENERATIONS_ENABLED=false ADMIN_DEMO_ENABLED=false BYTEPLUS_LIVE_TEST_ENABLED=false STAGING_AUTH_ENABLED=true DATA_DIR=/app/.data
COPY --from=builder --chown=node:node /app /app
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
EXPOSE 3000
CMD ["node", "scripts/serve.mjs"]
