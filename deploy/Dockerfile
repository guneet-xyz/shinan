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
# dependencies are plain JavaScript, which the `production` stage checks,
# and while the `git` stage only downloads and unpacks the target's
# programs.
#
# Base images are pinned by digest; Dependabot proposes updates.

FROM --platform=$BUILDPLATFORM node:26-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS pnpm
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /src
# Corepack installs the pnpm version in package.json's packageManager.
# Node.js 25 and later no longer include Corepack, so it comes from npm.
COPY package.json ./
RUN npm install --global corepack@0.36.0 && corepack enable && pnpm --version

# Debian 13's `git` and `git http-backend` for the target architecture, and
# the one library they need that the runtime image lacks (PCRE2; zlib and
# the C library are there). Downloaded with apt, which checks them against
# Debian's signed package lists, and unpacked here without running anything
# built for the target (build plan §2.3). Only these programs are kept: no
# shell scripts, Perl or remote helpers, so Git cannot start a shell, and
# hooks are Node.js scripts (`#!/nodejs/bin/node`). Each package's
# copyright file is kept, and a dpkg status entry so that image scanners
# and the SBOM see the packages and their versions, as the distroless image
# does for its own.
FROM --platform=$BUILDPLATFORM node:26-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS git
ARG TARGETARCH
WORKDIR /debs
RUN chown _apt /debs \
 && dpkg --add-architecture "$TARGETARCH" \
 && apt-get update -qq \
 && apt-get download -qq "git:$TARGETARCH" "libpcre2-8-0:$TARGETARCH" \
 && for deb in ./*.deb; do dpkg-deb -x "$deb" /unpacked; done \
 && mkdir -p /out/usr/bin /out/usr/lib/git-core /out/var/lib/dpkg/status.d \
 && cp -a /unpacked/usr/bin/git /out/usr/bin/git \
 && cp -a /unpacked/usr/lib/git-core/git-http-backend /out/usr/lib/git-core/ \
 && ln -s ../../bin/git /out/usr/lib/git-core/git \
 && lib="$(dirname /unpacked/usr/lib/*/libpcre2-8.so.0)" \
 && mkdir -p "/out${lib#/unpacked}" \
 && cp -a "$lib"/libpcre2-8.so.0* "/out${lib#/unpacked}/" \
 && for deb in ./*.deb; do \
      package="$(dpkg-deb -f "$deb" Package)"; \
      mkdir -p "/out/usr/share/doc/$package"; \
      cp "/unpacked/usr/share/doc/$package/copyright" "/out/usr/share/doc/$package/"; \
      dpkg-deb -f "$deb" Package Version Architecture Maintainer Source Homepage \
        > "/out/var/lib/dpkg/status.d/$package"; \
      sed -i '1a Status: install ok installed' "/out/var/lib/dpkg/status.d/$package"; \
    done \
 && chown -R 0:0 /out && chmod -R u=rwX,go=rX /out \
 && find /out -ls

# Everything, built: the server, the packages it uses and the web app.
# BuildKit runs this stage and `production` at the same time; the store's
# cache mount is locked so that only one pnpm writes it at a time.
FROM pnpm AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=shinan-pnpm,target=/pnpm/store,sharing=locked \
    pnpm fetch --store-dir /pnpm/store
COPY . .
RUN --mount=type=cache,id=shinan-pnpm,target=/pnpm/store,sharing=locked \
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
COPY packages/git/package.json packages/git/
COPY packages/markdown/package.json packages/markdown/
COPY packages/skill/package.json packages/skill/
RUN --mount=type=cache,id=shinan-pnpm,target=/pnpm/store,sharing=locked \
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
COPY --from=build /src/packages/git/dist packages/git/dist
# Git's hooks, which repositories point `core.hooksPath` at.
COPY --from=build /src/packages/git/hooks packages/git/hooks
COPY --from=build /src/packages/markdown/dist packages/markdown/dist
COPY --from=build /src/packages/skill/dist packages/skill/dist
# The skill's Markdown, read when the web role starts (`/skills/`).
COPY --from=build /src/packages/skill/skill packages/skill/skill
# Every owner and mode set here rather than kept from whatever pnpm, the
# build context's checkout or a cached layer left: root, directories 755,
# files 644 or 755 if executable. Done here because the runtime stage has
# no shell, and not with `COPY --chmod`, whose `X` older builders (BuildKit
# before v0.21, as in Docker Engine before 28.1) ignore without an error.
RUN chown -R 0:0 /src && chmod -R u=rwX,go=rX /src

# Distroless: Node.js and nothing else, no shell or package manager. Runs as
# the unprivileged `nonroot` user (65532). /app and everything in it is owned
# by root and not writable by that user, so the server cannot change its own
# code even where the root file system is writable. The base image already
# runs as `nonroot`, and WORKDIR would create /app as that user, so COPY
# creates it first (as root) and keeps the owners and modes the `production`
# stage set. The first-start test checks this.
FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:1d736cf8b5716c07a245301f92717143215d248fd55771ee1936ef4b3302e531
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    INTERNAL_HOST=127.0.0.1 \
    INTERNAL_PORT=3001
COPY --from=production /src /app
COPY --from=git /out /
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
