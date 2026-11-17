# syntax=docker/dockerfile:1

# Shinan's one image for every role (architecture §11.2, §12). Build from the
# repository root: docker build -f deploy/Dockerfile .
#
#   docker run <image> web       pages, API and the built web app
#   docker run <image> worker    background jobs and email
#   docker run <image> migrate   prepare the database, then exit
#   docker run <image> health    container health check of the web role
#
# The build stages run on the machine's own architecture and the runtime
# stage only copies files, so one machine builds both linux/amd64 and
# linux/arm64 without emulation. That holds only while production
# dependencies are plain JavaScript, which the `production` stage checks.
#
# Base images are pinned by digest; Dependabot proposes updates.

FROM --platform=$BUILDPLATFORM node:24-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0 AS pnpm
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /src
# Corepack installs the pnpm version in package.json's packageManager.
COPY package.json ./
RUN corepack enable && pnpm --version

# Everything, built: the server, the packages it uses and the web app.
FROM pnpm AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=shinan-pnpm,target=/pnpm/store \
    pnpm fetch --store-dir /pnpm/store
COPY . .
RUN --mount=type=cache,id=shinan-pnpm,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --store-dir /pnpm/store
RUN pnpm build

# Only what the server needs at run time. Optional dependencies are left
# out: they are platform-specific binaries (esbuild, through Better Auth's
# optional peers) or alternatives Shinan does not use (pg-cloudflare).
FROM pnpm AS production
ARG BUILDPLATFORM
ARG TARGETPLATFORM
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
# Every workspace package's manifest, so the frozen lockfile matches. Add
# new packages here.
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/api-client/package.json packages/api-client/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/email/package.json packages/email/
RUN --mount=type=cache,id=shinan-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --no-optional \
      --filter "@shinan/server..." --store-dir /pnpm/store
# Native code built here would be for the build machine, not the target.
RUN native="$(find -L node_modules -name '*.node' -print)"; \
    if [ "$BUILDPLATFORM" != "$TARGETPLATFORM" ] && [ -n "$native" ]; then \
      printf 'Native code in production dependencies; build on a %s machine:\n%s\n' \
        "$TARGETPLATFORM" "$native" >&2; \
      exit 1; \
    fi
COPY --from=build /src/apps/server/dist apps/server/dist
COPY --from=build /src/apps/web/dist apps/web/dist
COPY --from=build /src/packages/api-client/dist packages/api-client/dist
COPY --from=build /src/packages/core/dist packages/core/dist
COPY --from=build /src/packages/db/dist packages/db/dist
COPY --from=build /src/packages/db/migrations packages/db/migrations
COPY --from=build /src/packages/email/dist packages/email/dist

# Distroless: Node.js and nothing else, no shell or package manager. Runs as
# the unprivileged `nonroot` user (65532). /app and everything in it is owned
# by root and not writable by that user, so the server cannot change its own
# code even where the root file system is writable. The base image already
# runs as `nonroot`, and WORKDIR would create /app as that user, so COPY
# creates it first (as root). The first-start test checks this.
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:6abfcb367ebc291572c774c1592a986be2ab26a2486f73093401327495a5962a
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    INTERNAL_HOST=127.0.0.1 \
    INTERNAL_PORT=3001
COPY --from=production /src /app
WORKDIR /app
USER nonroot
EXPOSE 3000
# The web role's internal listener, from inside the container: it is never
# published or routed (architecture §13). Other roles turn this off in
# Compose (`healthcheck: disable: true`).
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD ["/nodejs/bin/node", "/app/apps/server/dist/cli.js", "health"]
ENTRYPOINT ["/nodejs/bin/node", "/app/apps/server/dist/cli.js"]
CMD ["web"]
