# GC-11's load scripts and rehearsals

The scripts behind the measurements, limit checks and rehearsals of the
security checklist's [v0.4.0 rerun](../../../docs/security-checklist.md#v040-rerun-2026-11-21).
Their output, from the run the checklist cites, is in
[docs/evidence/v0.4.0](../../../docs/evidence/v0.4.0/README.md).

They are not run in CI: a run takes about an hour and needs a temporary
Docker daemon. Never point them at a real installation. They make test
agents by writing token hashes straight into the database. They delete
and restore its database, and they fill it with test workspaces.

## What runs

`run-all.sh` runs these in order, each one's output in `$OUT/<step>.log`
and each scenario's memory in `$OUT/mem-<scenario>.log`:

| Step              | Script                 | What                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1-upgrade`       | `rehearse-upgrade.sh`  | v0.3.0's reference stack with `v0.3.0-dataset.sql`, one more proposal through v0.3.0's MCP, then the operator guide's "Upgrading from 0.3 to 0.4" step by step, and the catalog read as the signed-in owner                                                                                                                                                                                          |
| `2-post-checks`   | `post-checks.sh`       | The Git container's hardening, networks and environment (names only), the service token, the Git endpoint through Caddy, the first commit against the dump byte for byte (`compare.sql`), and a push with secrets in it                                                                                                                                                                              |
| `3-idle`          | (inline)               | Memory at rest                                                                                                                                                                                                                                                                                                                                                                                       |
| `4-load`          | `load.sh`              | `realistic` (three agents and a reader), `bigpush` (20,000 pages to `main`, `mkbig.mjs`), `clones` (12 at once and heavy reads), `pushes` (four 62 MiB pushes at once, then one over 64 MiB), `worst` (20,000 pages beside three 62 MiB pushes by two people), `reads` (`web-hostile.mjs`), `slowclone` (50 KB/s through Caddy, `slowproxy.mjs`), `prune` (fetches while a deleted branch is pruned) |
| `5-long-history`  | `long-history.sh`      | 1,000,000 commits on `main` (`mklong.mjs`): deep history reads, 12 History reads at once, and the pruner's failure, its wait and that wait after a restart                                                                                                                                                                                                                                           |
| `6-rollback`      | `rehearse-rollback.sh` | The guide's rollback with the step 1 dump, v0.3.0 again, then the upgrade again from an empty volume                                                                                                                                                                                                                                                                                                 |
| `7-volume-backup` | `volume-backup.sh`     | The guide's backup of the database and the `catalog` volume, a change after it, and the guide's restore                                                                                                                                                                                                                                                                                              |

`memwatch.sh` reads each container's cgroup every 200 ms. It writes one
line a second: `memory.current` (what the limit counts, page cache
included) and anonymous memory, in MiB. At the end it adds the peaks and
`memory.events`. `lib.sh` holds what the scripts share. `web.mjs`,
`sign-in.mjs`, `mkws.mjs`, `check-catalog.mjs` and `mcp.mjs` act as the
owner in the browser, or as v0.3.0's agent.

## Running them

On a host with Docker, keeping everything on a data disk (`/mnt` here):

```sh
# A temporary daemon in its own container, never a second dockerd on the host.
mkdir -p /mnt/tmp/load/dind /mnt/tmp/load/work/v03 /mnt/tmp/load/work/src
docker run -d --name load-dind --privileged -e DOCKER_TLS_CERTDIR= \
  -v /mnt/tmp/load/dind:/var/lib/docker -v /mnt/tmp/load/work:/work \
  -p 127.0.0.1:23751:2375 docker:28.0.4-dind --host=tcp://0.0.0.0:2375
export DOCKER_HOST=tcp://127.0.0.1:23751

# v0.3.0's Compose files, this checkout's deploy/, and the images.
git show v0.3.0:deploy/compose.yml > /mnt/tmp/load/work/v03/compose.yml
git show v0.3.0:deploy/test/compose.test.yml > /mnt/tmp/load/work/v03/compose.test.yml
cp -a deploy /mnt/tmp/load/work/src/
docker pull cr.guneet.dev/shinan/shinan:v0.3.0@sha256:4819f0872bcb4f2c702438646277f995b81ecde15bbd1adf62f13eb4184ef6f7
docker tag cr.guneet.dev/shinan/shinan:v0.3.0@sha256:4819f0872bcb4f2c702438646277f995b81ecde15bbd1adf62f13eb4184ef6f7 shinan:v0.3.0
docker build -f deploy/Dockerfile -t shinan:candidate .   # or pull the v0.4.0 release

# The harness, on the daemon's network, with its socket and cgroups.
docker build -t load-harness -f deploy/test/load/harness.Dockerfile deploy/test/load
docker run -d --name load-h --network host -v /var/run/docker.sock:/var/run/docker.sock \
  -v /work:/work -v /work/src:/src:ro -v /sys/fs/cgroup:/dind-cgroup:ro load-harness
docker exec -e CANDIDATE=shinan:candidate load-h /src/deploy/test/load/run-all.sh
```

The logs are in `/mnt/tmp/load/work/evidence`. They hold no secret. The
service token and agent tokens stay in files under `/work/op`, which is
not part of the evidence. Afterwards, remove the daemon's container
(`docker rm -f load-dind`) and `/mnt/tmp/load`.
