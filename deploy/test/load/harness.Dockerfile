# The harness that runs GC-11's load scripts: Node (the image's version),
# the Docker CLI with Compose, Git, curl, jq and OpenSSL. See README.md.
FROM docker:28.0.4-cli AS cli
FROM node:26-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc
RUN apt-get update \
  && apt-get install -y --no-install-recommends git curl ca-certificates jq procps openssl tini \
  && rm -rf /var/lib/apt/lists/*
COPY --from=cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
ENV TMPDIR=/work/tmp
# tini reaps the Git clients the scripts leave behind.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sleep", "infinity"]
