# Evidence: GC-11's run for v0.4.0 (2026-11-28)

The output of [`deploy/test/load/`](../../../deploy/test/load/README.md) that the
security checklist's [v0.4.0 rerun](../../security-checklist.md#v040-rerun-2026-11-21)
cites. Nothing here holds a secret. Tokens and the service token stayed in
files under the harness's `/work/op`, and the logs give environment
variable names only.

**What ran:**

- **Where:** a `docker:28.0.4-dind` container on Daedalus (arm64, 2 cores, like Musashi).
- **The stack:** the reference Compose file with its test additions: Caddy 2.11.2 with HTTPS in front, as on Musashi, and Mailpit.
- **v0.3.0:** the published image, `cr.guneet.dev/shinan/shinan:v0.3.0@sha256:4819f0872bcb4f2c702438646277f995b81ecde15bbd1adf62f13eb4184ef6f7`.
- **v0.4.0:** a candidate built with `deploy/Dockerfile` from `656ab50`, which is `main` at `91c2b02` plus [#208](https://github.com/guneet-xyz/shinan/pull/208).
- **The scripts:** those of this commit.

| Log                   | What it shows                                                                                                                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1-upgrade.log`       | The upgrade from v0.3.0, step by step as the operator guide gives it: `migrate`'s report, `docker compose ps`, the index rebuilds, the catalog as the signed-in owner reads it                                                                                                     |
| `2-post-checks.log`   | The Git container's hardening, network, members and environment names; the service token; the Git endpoint through Caddy; the first commit against the dump (17 of 17 identical); a push with secrets refused                                                                      |
| `3-idle.log`          | Memory at rest (`mem-idle.log`)                                                                                                                                                                                                                                                    |
| `4-load.log`          | `bigpush`, `clones`, `pushes`, `worst`, `reads`, `slowclone`, `prune`, with their `mem-<scenario>.log`. Its `realistic` section ran into the per-address rate limit and its agents stopped at the first refusal, so that scenario was rerun with longer pauses: `4b-realistic.log` |
| `4b-realistic.log`    | Three agents and a reader on one address (`mem-realistic.log`)                                                                                                                                                                                                                     |
| `5-long-history.log`  | 1,000,000 commits on `main`: the pruner's failure at the start and its wait, history reads, 12 History reads at once (`mem-prune1m.log`, `mem-history12.log`), and the wait holding after a deleted branch and a restart                                                           |
| `6-rollback.log`      | The rollback to v0.3.0 as the guide gives it, v0.3.0's state afterwards, and the upgrade again from an empty volume                                                                                                                                                                |
| `7-volume-backup.log` | The backup of the database and the `catalog` volume, a change after it, the restore, and the state afterwards                                                                                                                                                                      |
| `mem-<scenario>.log`  | One line a second: seconds since the start, then per container `memory.current` and anonymous memory in MiB, sampled every 200 ms. At the end: the peaks and `memory.events`                                                                                                       |

`5-long-history.log` is the third run of that script. The first two found
mistakes in the script itself: its memory watch started before the Git
container did, and it reused a workspace's name. They did not find
problems in Shinan.

In `5-long-history.log`, the start's pruning lines include one for
workspace `3fad7362-…` from 14:21:58. That was the second run's repository:
the container keeps its log across restarts. This run's start, at
14:37:47, logged its own failure (`89f1418c-…`, the repository it made)
but did not try `3fad7362-…` again. That shows the wait outlasting a
restart a second time. The committed script reads only the lines since
its start (`--since`); it was changed that way after this run.
