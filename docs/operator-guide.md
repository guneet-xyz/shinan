# Operator guide: running Shinan yourself

Status: **Proposed** (M1-7, [#59](https://github.com/guneet-xyz/shinan/issues/59)).
This guide describes the reference Compose file in
[`deploy/compose.yml`](../deploy/compose.yml), as built and tested. Shinan is
self-hostable by design ([D-012](decisions/D-012-self-hostable.md));
distribution waits on licensing ([D-013](decisions/D-013-business-model-deferred.md)),
so for now the image is published only to the owner's registry, as
`cr.guneet.dev/shinan/shinan`. That project is public, so the image can be
pulled without logging in ([D-054](decisions/D-054-public-image-registry-project.md));
building it yourself needs a checkout of this repository. [Architecture §12](architecture.md#12-self-hosting)
owns the rules this guide follows.

The owner's own installation, `shinan.guneet.dev`, follows the same layout,
adapted to Musashi's rules, in the `infra/musashi` repository's `shinan`
stack. Every deployment there needs the owner's approval
([D-016](decisions/D-016-musashi-and-deployment-approval.md)); that rule does
not apply to anyone else's installation.

## What you need

- Docker with Compose v2.
- A host name for the installation and an **HTTPS reverse proxy** in front of
  it (Caddy, nginx, Traefik). Shinan refuses an `http:` address in
  production and sets `Secure` cookies and HSTS.
- **AWS SES** to send email: a verified sending identity and a send-only IAM
  user's access key ([architecture §9](architecture.md#9-email-and-notifications)).
  Sign-in needs email, including the first start.
- Optionally, a GitHub App for GitHub sign-in (see [below](#github-sign-in)).
- Memory for the containers' limits: 2,432 MiB (about 2.4 GiB) while running
  (PostgreSQL 512 MiB, `web` 1,536 MiB with its [catalog worker](#catalog-workers),
  `worker` 384 MiB), and 2,688 MiB (about 2.6 GiB) while `migrate` (256 MiB)
  runs at each start.

## What runs

| Service    | Role                                                                                       | Networks            |
| ---------- | ------------------------------------------------------------------------------------------ | ------------------- |
| `postgres` | PostgreSQL 18; data in the `postgres` volume                                               | `backend`           |
| `migrate`  | Applies new database migrations and prepares the job queue, then exits; runs on every `up` | `backend`           |
| `web`      | Pages, API and sign-in; published on `127.0.0.1` only, for your proxy                      | `backend`, `egress` |
| `worker`   | Background jobs: sends email through SES                                                   | `backend`, `egress` |

`backend` has no internet access; `egress` gives `web` (GitHub sign-in) and
`worker` (SES) outgoing access. Every Shinan container runs as an unprivileged
user with a read-only file system, no Linux capabilities and
`no-new-privileges`. `web`'s health check (`/healthz`, `/readyz`) is served on
a separate listener inside the container (port 3001), which is never
published; Docker runs it with `shinan health`.

## Setting up

All files go in one directory, next to `compose.yml`.

1. **Get the image.** Use a published image pinned by digest, or build one
   from a checkout of this repository:

   ```sh
   docker build -f deploy/Dockerfile -t shinan:local .
   ```

   The image runs every role: `web` (the default), `worker`, `migrate`,
   `health` and the [recovery commands](#recovery-commands).

2. **Settings** that are not secret go in `.env`: copy
   [`deploy/.env.example`](../deploy/.env.example) and fill it in.

   | Setting                  | What to put                                                                                                                                                                                                         |
   | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `SHINAN_IMAGE`           | The image, pinned by digest (`…@sha256:…`), or `shinan:local`                                                                                                                                                       |
   | `SHINAN_URL`             | The address people open, such as `https://shinan.example.com`: HTTPS, no path. Every link Shinan sends starts with it. Agent tokens are bound to it: changing it stops every agent token, and members make new ones |
   | `SHINAN_OPERATORS`       | Installation operators' email addresses, separated by commas. They can sign in from the start and manage the email allowlist                                                                                        |
   | `SHINAN_TRUSTED_PROXIES` | Your proxy's address as Shinan sees it ([below](#reverse-proxy)); empty trusts nobody                                                                                                                               |
   | `SHINAN_PORT`            | Port on `127.0.0.1` for your proxy (default 3000)                                                                                                                                                                   |
   | `EMAIL_FROM`             | The address Shinan sends from, verified in SES                                                                                                                                                                      |
   | `SES_REGION`             | The SES region, such as `us-east-1`                                                                                                                                                                                 |
   | `SES_CONFIGURATION_SET`  | Optional SES configuration set                                                                                                                                                                                      |

   The [README's settings table](../README.md#developing-locally) lists every
   variable Shinan reads.

   **Changing `SHINAN_URL` later stops every agent token.** Each token
   records the address it was made for and works only there
   ([identity §7.4](identity.md#74-handling)), so after a change every
   member must make a new token for each of their agents (Your account,
   Your agents) and put it on the machine. Shinan also refuses every token
   if `SHINAN_URL` is not set.

3. **Secrets** are files in `secrets/`, one value per file. Compose mounts each
   only into the containers that need it. Keep the directory private: the
   files themselves must be readable by the containers' users, so protect
   them with the directory instead.

   ```sh
   install -d -m 0700 secrets
   umask 022
   password=$(openssl rand -hex 32)
   printf '%s' "$password" > secrets/postgres_password
   printf 'postgres://shinan:%s@postgres:5432/shinan' "$password" > secrets/database_url
   openssl rand -base64 48 > secrets/session_secret
   ```

   Then put the SES user's access key ID in `secrets/ses_access_key_id` and its
   secret key in `secrets/ses_secret_access_key`, typed or pasted into an
   editor rather than given as a command argument.

   | File                    | Used by                    | What it is                                                                    |
   | ----------------------- | -------------------------- | ----------------------------------------------------------------------------- |
   | `postgres_password`     | `postgres`                 | The database password; set once, when the database is first created           |
   | `database_url`          | `migrate`, `web`, `worker` | The connection string, with the same password                                 |
   | `session_secret`        | `web`                      | Signs sign-in cookies; at least 32 characters. Changing it signs everyone out |
   | `ses_access_key_id`     | `worker`                   | The SES user's access key ID                                                  |
   | `ses_secret_access_key` | `worker`                   | Its secret key                                                                |
   | `github_client_secret`  | `web`, only with GitHub    | The GitHub App's client secret                                                |

### Reverse proxy

Point your proxy at `http://127.0.0.1:3000` (or your `SHINAN_PORT`), with
HTTPS and a redirect from HTTP. Never route anything to port 3001. Route
every path: agents use `/mcp`, and OpenCode fetches the agent skill from
`/skills/` without signing in. That path serves only the skill's own files,
which are the same for every installation and hold no workspace data
([D-056](decisions/D-056-public-skill-path.md)). With Caddy:

```text
shinan.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

Shinan counts rate limits and records addresses in the security log by the
visitor's network address. Behind a proxy, every request comes from the proxy,
so tell Shinan which address that is with `SHINAN_TRUSTED_PROXIES`; it then
reads the visitor's address from `X-Forwarded-For`, which your proxy must
set (Caddy and nginx's usual settings do). Without it, every visitor shares
one address and one set of limits.

**Agents' requests at `/mcp`.** Don't buffer its answers, and don't time them
out in under a few minutes. A request in the 2025-11-25 form, which OpenCode
uses by default, is answered as a short event stream (`text/event-stream`)
that closes after the result; the 2026-07-28 form gets plain JSON. Either can
take minutes: a catalog proposal may wait in its workspace's queue, and for
the catalog to load after a restart. Caddy's `reverse_proxy` needs nothing
(it flushes event streams at once and sets no response timeout). With nginx,
set `proxy_buffering off` and `proxy_read_timeout 300s` for `/mcp`; its
default of 60 seconds would cut a slow answer off. Don't limit request bodies
below 512 KB: Shinan limits them itself, before reading them (64 KB on the
API, 512 KB on `/mcp` and catalog proposals), gives a client 30 seconds to
send a whole request, and answers 429 to more than a few `/mcp` requests in
flight at once from one token or address.

The address Shinan sees is not always `127.0.0.1`: a proxy on the host
reaching the published port arrives from the Docker network's gateway. Find it
with:

```sh
docker network inspect shinan_egress --format '{{(index .IPAM.Config 0).Gateway}}'
```

If your proxy runs in Docker instead, give it a network shared with `web` and
a fixed address on it (`ipv4_address`), and name that address. Give the
network an `ip_range` that leaves the fixed address out, so Docker never hands
it to another container while the proxy is stopped:

```yaml
networks:
  proxy:
    ipam:
      config:
        - subnet: 10.89.0.0/24
          ip_range: 10.89.0.128/25 # Docker's own choices; the proxy is 10.89.0.2
```

Name single addresses rather than wide ranges: anything you trust can claim to
be any visitor.

## First start

```sh
docker compose up -d
docker compose logs web
```

`migrate` prepares the database, then `web` and `worker` start. Until the
first operator account exists, `web` prints a **one-time setup link** to its
log (`https://…/setup#…`); nothing else shows it
([architecture §12](architecture.md#12-self-hosting)). Both this link and the
sign-in link use `SHINAN_URL`, so its DNS name and your proxy must already
work:

1. Open the link within 24 hours and type one of the `SHINAN_OPERATORS`
   addresses.
2. Open the sign-in link emailed to that address. That creates the first
   operator account and turns the setup link off for good.

Each start of `web` replaces the link, so a lost or expired link is replaced
by `docker compose restart web`. **Run one `web` container until the
installation is claimed:** with several, each prints its own link and only the
last one printed works.

After that, operators add people's addresses to the email allowlist (Your
account, Installation settings), anyone allowlisted signs in by email link, and
anyone signed in can create a workspace and invite others.

### GitHub sign-in

Optional. Register a GitHub App for your installation (a private app on your
account or organization is enough for sign-in):

- **Callback URL:** `https://<your host>/api/auth/callback/github`.
- **Request user authorization (OAuth) during installation:** off.
- **Webhook:** off for now.
- **Permissions:** none. Sign-in reads only the person's own profile.

Then, in `.env`, uncomment `COMPOSE_FILE=compose.yml:compose.github.yml` and
set `GITHUB_CLIENT_ID`; put the app's client secret in
`secrets/github_client_secret`; run `docker compose up -d`.
[`deploy/compose.github.yml`](../deploy/compose.github.yml) adds both to `web`.

## Upgrades

1. Read the release notes. They say from which version you can upgrade
   directly, and whether the release's migrations can be rolled back
   ([architecture §11.5](architecture.md#115-migrations-and-rollback)).
2. Take a database dump (see [backups](#backups-your-responsibility)).
3. Set `SHINAN_IMAGE` to the new digest and run `docker compose up -d`.
   `migrate` runs first; `web` and `worker` are recreated only if it succeeds.
4. Check `docker compose ps`: `migrate` exited 0, `web` is `healthy`, `worker`
   is running.

To roll back, set the previous digest and run `docker compose up -d`.
Migrations are written to work with the previous release, so this needs no
database change, unless the release notes say otherwise; then restore the dump
you took in step 2.

### Upgrading from 0.2 to 0.3 (the catalog)

0.3 adds the catalog (agent index, wiki, catalog proposals and review,
repair, purge), the agents' MCP endpoint, the agent skill and changing one's
own email address. The release notes list every change; for operators, before
you upgrade:

- **Memory.** `web` now runs a [catalog worker](#catalog-workers) thread. The
  reference Compose file raises its limit from 512 MiB to 1,536 MiB
  (`SHINAN_WEB_MEMORY`). If you copied the Compose file, raise `web`'s
  `mem_limit` the same way. If the host is short of memory, a smaller ceiling
  works with a smaller heap: `SHINAN_CATALOG_WORKER_HEAP_MB=640` and 1,280 MiB.
- **Settings.** `SHINAN_CATALOG_WORKERS` and `SHINAN_CATALOG_WORKER_HEAP_MB`
  are new and optional (defaults 1 and 768), and so is `SHINAN_WEB_MEMORY`
  in the reference Compose file. No new secrets.
- **Your proxy** must route every path: agents use `/mcp`, and OpenCode
  fetches `/skills/` without signing in. Don't buffer `/mcp` answers (some
  are short event streams) or time them out in under a few minutes, and
  don't limit request bodies below 512 KB ([reverse proxy](#reverse-proxy)).
  Caddy needs no change; nginx needs `proxy_buffering off` and a longer
  `proxy_read_timeout` for `/mcp`.
- **Limits** (all **proposed**, and may change): `/mcp` takes bodies up to
  512 KB and the catalog proposal routes 272 KiB; at most 8 requests in
  flight per agent token or signed-in person, and 16 per address, on `/mcp`
  and the proposal routes; 30 seconds to send a whole request; per agent,
  600 requests a minute, and 60 catalog proposals and 60 comments in 10
  minutes.
- **Migrations** `0005` to `0012` only add tables, columns, indexes and
  triggers; `0012` replaces the append-only triggers on events and revision
  text with ones that let a purge's own transaction change their text, and
  nothing else. 0.2's code
  runs on the upgraded database: rolling back is setting the previous digest
  again, and the catalog and agents stay in the database, unused, until you
  upgrade again. Until then, agents' requests to `/mcp` get 404. 0.2 does
  not revoke agent tokens when someone is removed from the allowlist and
  added back, or signs out everywhere: after upgrading again, revoke the
  tokens of anyone whose access changed in between. To drop 0.3's data
  instead, restore the dump into an empty database, as in
  [backups](#backups-your-responsibility); restoring over the upgraded
  database with `pg_restore --clean` leaves 0.3's tables behind. A failed
  `migrate` changes nothing: it applies all pending migrations in one
  transaction.
- **The agent index.** On every start the worker asks for a rebuild of any
  workspace whose index another release built or whose rebuild never
  finished. On the first 0.3 start the catalog is empty, so there is
  nothing to rebuild. From then on the worker checks the index every night
  ([the agent index](#the-agent-index)); a rebuild gives the event loop back
  every 50 ms, so email is not held up.

## Agents: the MCP endpoint, tokens and the skill

Coding agents reach Shinan at `https://<your host>/mcp`, with an agent token
in the `Authorization` header, and load the agent skill from
`https://<your host>/skills/`
([agent integrations](agent-integrations.md#mcp-server-and-tools)).

- **Tokens** are made by members, by hand, for their own agents (Your agents,
  then **Set up OpenCode** for the steps). Each is shown once and stored only
  as a hash. A token is read-only or full, works only in the workspace it was
  made for, and is bound to `SHINAN_URL`. Members revoke their own tokens;
  workspace owners can revoke any token in the workspace. Each new token
  emails its member, and is recorded in the workspace's security log.
- **`/mcp` refuses sign-in cookies**, a token in the address and requests
  from other sites, so a browser can't be used to call it. Requests are rate
  limited per address (300 a minute, shared with `/api` from that address;
  every agent session on one machine shares it) and per token (600 a minute);
  so are failed token uses per address. A rate-limited request gets 429 with
  `Retry-After` set to the seconds left in the minute. At
  most 8 requests may be in flight at once per token and 16 per address (an
  IPv6 address by its /64); more get 429 with `Retry-After: 1`, before their
  bodies are read.
  OpenCode (checked in its source, 2026-11-18) retries a 429 twice, after
  250 ms and 1 s, only while connecting and listing tools; a tool call that
  gets 429 fails at once, and the agent sees the error and can call again.
  Normal use, a few tool calls at a time, stays well below the cap.
  Agents' catalog proposals have their own limit (60 in 10 minutes).
- **`/skills/`** serves only the skill's own files, the same for every
  installation, with no workspace data
  ([D-056](decisions/D-056-public-skill-path.md)).

## Backups: your responsibility

Shinan has **no built-in backups**. The owner's own installation accepts that
risk for now ([D-038](decisions/D-038-no-built-in-backups.md),
[architecture §14](architecture.md#14-backups-accepted-risk)); for yours, it is
your decision. If you lose the `postgres` volume without a backup, you lose
everything in it: workspaces, the catalog, tasks, members and the security log.
Git host data comes back through reconciliation, nothing else does.

Back up:

- **The database**, for example nightly, kept somewhere other than this host.
  A dump holds everything, including email addresses and the security log,
  so write it readable only by you:

  ```sh
  (umask 077 && docker compose exec -T postgres pg_dump -U shinan -Fc shinan > shinan-$(date -u +%Y%m%dT%H%M%SZ).dump)
  ```

  To restore, replace the database with an empty one, restore into it and
  start again (`migrate` then brings it up to the running release):

  ```sh
  docker compose stop web worker
  docker compose exec -T postgres dropdb -U shinan --force shinan
  docker compose exec -T postgres createdb -U shinan shinan
  docker compose exec -T postgres pg_restore -U shinan -d shinan --exit-on-error < shinan-….dump
  docker compose up -d
  ```

- **The `secrets/` directory.** Git host credentials, once Shinan connects to
  git hosts, are to be encrypted with keys kept there
  ([architecture §10.3](architecture.md#103-secrets-and-credentials)); a
  database backup would be useless without them.

Test a restore now and then, on another machine.

## Logs and health

- `docker compose logs web`, `… worker`, `… migrate`. The reference file keeps
  50 MB per container (`json-file`, five files of 10 MB).
- Logs are plain text lines for now (structured JSON is planned,
  [architecture §13](architecture.md#13-observability)). They never contain
  tokens, cookies, sign-in links, request bodies or a failed query's values;
  unexpected errors are logged by name, code and stack frames only, at most
  once a minute each. The **setup link is the one exception**, printed on
  purpose; treat the `web` log as sensitive until the installation is claimed.
- `docker compose ps` shows `web` as `healthy` when its database answers and
  its migrations are current. For an outside uptime check, use
  `https://<your host>/api/status`, which answers the same whatever the state
  of the database.

## Recovery commands

For an operator whose account or mailbox is in trouble (identity §3.4). Each
is recorded in the security log:

```sh
docker compose run --rm --no-deps web account end-sessions <handle>
docker compose run --rm --no-deps web account change-email <handle> <new address>
```

People who can still sign in (with GitHub, for example) change their own
address from Your account instead: add their new address to the email
allowlist first, then they confirm it from a link sent there. Operators'
own addresses are changed only in `SHINAN_OPERATORS` and with the command.

## The agent index

The catalog's agent index is built from the stored catalog text and can be
rebuilt from it at any time
([architecture §5.2, §5.3](architecture.md#52-the-invariant)). The worker
rebuilds it by itself after a release that changes how catalog text is read,
and checks every night (03:40 UTC) that the stored index still matches the
text. A mismatch is logged by the worker (`Catalog index check: workspace …`)
by workspace and document IDs only. Operators see each workspace's index
state at `/api/installation/catalog-index`. To rebuild a workspace's index,
or to run the check now:

```sh
docker compose run --rm --no-deps web catalog-index rebuild <workspace-id>
docker compose run --rm --no-deps web catalog-index check [<workspace-id>]
```

While a rebuild runs, agents and the wiki keep reading the old index, marked
as behind.

## Catalog workers

The `web` process applies catalog proposals in worker threads, each keeping
one workspace's catalog parsed and validated in memory
([architecture §5.3](architecture.md#53-how-sync-works)). Two settings in
`.env`:

| Setting                         | Default | What it does                                                                                                                                          |
| ------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SHINAN_CATALOG_WORKERS`        | `1`     | Worker threads. With one, workspaces take turns, and switching workspaces reads the other catalog again; set 2 or more if several teams propose a lot |
| `SHINAN_CATALOG_WORKER_HEAP_MB` | `768`   | Each worker's heap limit in MiB, at least 640. A catalog at its size limits ran within 384 MiB in every shape measured                                |

Raise the `web` container's memory with them: `SHINAN_WEB_MEMORY` (default
`1536m`) should be at least 768 MiB more than workers × heap.

If a workspace's catalog no longer fits in its worker, or cannot be read in
time, every proposal there fails with `catalog-too-large` or
`catalog-unreadable`. The `web` log says so once an hour
(`Catalog worker: workspace …`), and the workspace's security log records
`catalog-worker.failed`. Catalog size limits are meant to make this
impossible; if it happens, raise `SHINAN_CATALOG_WORKER_HEAP_MB` (and the
container's memory) until proposals apply, have the workspace make room in
its catalog as [catalog §8.2](catalog.md#82-when-catalog-approval-is-needed) says (shorten
documents, remove facts no longer needed, fix the warnings it holds, such as
suspected secrets and keys outside their type's schema; a change that does not
grow the catalog always applies), then lower it again,
and report it.

## Catalog purge

Workspace owners purge text from their catalog themselves, in workspace
settings, Data ([catalog §9](catalog.md#9-history-and-purge)); operators
cannot. A purge changes what Shinan stores, and asks PostgreSQL to vacuum
the tables it changed, so a database dump no longer holds the text. It
cannot reach copies outside the live rows: your backups of the database
volume, PostgreSQL's write-ahead log, any PostgreSQL log that records
statement parameters (the reference setup does not turn that on), and the
bytes of deleted row versions, which stay in the database's files until
PostgreSQL reuses the space. If a purge was for a leaked secret, make sure
the secret was rotated, and treat those copies as holding it until they age
out. To clear the database's files too, run this at a quiet moment (it
locks the tables while it rewrites them):

```sh
docker compose exec -T postgres psql -U shinan -d shinan -c "vacuum full catalog_revision_documents, catalog_proposals, events, catalog_index_documents, catalog_index_facts, catalog_index_relations, catalog_index_discrepancies, catalog_index_sections, catalog_index_provenance"
```

Every `web` and `worker` process forgets parsed catalog text within a
minute of a purge; nothing needs restarting.

## Stopping and removing

`docker compose down` stops everything and keeps the data. `docker compose
down --volumes` **deletes the database**.
