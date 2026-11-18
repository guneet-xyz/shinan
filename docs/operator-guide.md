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
- Memory for the containers' limits: 1,408 MiB (about 1.4 GiB) while running
  (PostgreSQL 512 MiB, `web` 512 MiB, `worker` 384 MiB), and 1,664 MiB (about
  1.6 GiB) while `migrate` (256 MiB) runs at each start.

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
HTTPS and a redirect from HTTP. Never route anything to port 3001. With Caddy:

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

## Stopping and removing

`docker compose down` stops everything and keeps the data. `docker compose
down --volumes` **deletes the database**.
