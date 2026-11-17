# Match the Railway Postgres SSL image major version exactly.
# Only pg_dump and its libpq runtime library cross into the app container.
FROM postgres:18-bookworm AS pgclient
RUN mkdir -p /opt/singmotion-pg-client && \
    install -m 0755 /usr/lib/postgresql/18/bin/pg_dump /opt/singmotion-pg-client/pg_dump && \
    install -m 0644 /usr/lib/x86_64-linux-gnu/libpq.so.5 /opt/singmotion-pg-client/libpq.so.5

FROM node:24.22.1-bookworm-slim AS builder
# End-to-end MP4 validation tests require ffmpeg/ffprobe during build.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates chromium && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
# The pinned local security patch must exist before npm resolves dependencies.
COPY vendor/deepmerge ./vendor/deepmerge
RUN npm ci
COPY . .
RUN npm run build
# Run actual local HTTP + Chromium buyer journey inside the disposable build stage.
# It uses temp SQLite/media and offline Stripe/BytePlus fixtures; Chromium is NOT copied to runtime.
RUN PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:customer:browser

# CI builds this exact stage separately; a missing PG18 runtime dependency
# makes the image build fail before any Production deployment can start.
FROM node:24.22.1-bookworm-slim AS runtime-base
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates libldap-2.5-0 libgssapi-krb5-2 liblz4-1 libzstd1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=pgclient --chmod=0555 /opt/singmotion-pg-client/pg_dump /usr/local/bin/pg_dump
COPY --from=pgclient --chmod=0444 /opt/singmotion-pg-client/libpq.so.5 /usr/local/lib/libpq.so.5
ENV LD_LIBRARY_PATH=/usr/local/lib
RUN set -eu; pg_dump --version | grep -E '^pg_dump \\(PostgreSQL\\) 18\\.'; \
    if ldd /usr/local/bin/pg_dump | grep -q 'not found'; then exit 1; fi

FROM runtime-base AS runtime
WORKDIR /app
ENV NODE_ENV=production DEMO_MODE=true GENERATIONS_ENABLED=false ADMIN_DEMO_ENABLED=false BYTEPLUS_LIVE_TEST_ENABLED=false STAGING_AUTH_ENABLED=true DATA_DIR=/app/.data
COPY --from=builder --chown=node:node /app /app
# Only this root-owned initializer executes before dropping privileges.
COPY --chmod=0444 scripts/container-entrypoint.mjs /usr/local/lib/singmotion-entrypoint.mjs
RUN mkdir -p /app/.data && chown node:node /app/.data && chown root:root /app
USER root
EXPOSE 3000
ENTRYPOINT ["node", "/usr/local/lib/singmotion-entrypoint.mjs"]
