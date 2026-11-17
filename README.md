# Shinan

Shinan (指南, "guidance") is a host-neutral home for the story of work across
repositories and git hosts, and for the shared, agent-maintained context that
people and coding agents rely on. It keeps a catalog of projects, machines and
services, tracks tasks and the work linked to them on GitHub and Forgejo, and
shows which agents are working on what. It is a private product exploration,
now in its build phase.

## Documents

- [High-level plan](docs/plan.md) and [product overview](docs/product-overview.md)
- [Build plan](docs/build-plan.md): milestones, code layout and how work is done
- [Architecture](docs/architecture.md) and the [roadmap](docs/roadmap.md)
- [Domain model and glossary](docs/domain-model.md)
- [Operator guide](docs/operator-guide.md): running Shinan yourself
- [Decision log](docs/decisions/README.md)
- [Agent instructions](AGENTS.md)

## Code layout

| Path                  | What it holds                                                                   |
| --------------------- | ------------------------------------------------------------------------------- |
| `apps/server`         | The Node.js program (Hono): the `web` and `worker` roles and `migrate` command  |
| `apps/web`            | The React single-page app (Vite), served by `apps/server` in production         |
| `packages/core`       | Application modules, permissions and rules                                      |
| `packages/db`         | Drizzle schema and migrations                                                   |
| `packages/email`      | The email sender interface, the SES sender and an SMTP sender for development   |
| `packages/api-client` | Typed client for the REST API                                                   |
| `deploy/`             | The production image, the reference Compose file and local development services |

The [build plan](docs/build-plan.md#2-code-layout-proposed) describes each part.

## Developing locally

You need Node.js 26 (see `.nvmrc`), pnpm (the version in `package.json`'s
`packageManager`; Node.js 26 no longer includes Corepack, so run
`npm install --global corepack` once, then `corepack enable` picks it up) and
Docker.

```sh
pnpm install
pnpm services:up   # PostgreSQL on localhost:5432 and Mailpit (http://localhost:8025)
export DATABASE_URL=postgres://shinan@localhost:5432/shinan
pnpm --filter @shinan/server migrate
export SHINAN_OPERATORS=you@example.com
pnpm dev           # API on http://localhost:3000, web app on http://localhost:5173
pnpm --filter @shinan/server worker   # in another terminal: sends email to Mailpit
```

On first start, the `web` role prints a one-time **setup link** to its log
(`http://localhost:5173/setup#…`). Open it, enter the address from
`SHINAN_OPERATORS`, and open the sign-in link that arrives in Mailpit: that
creates the first operator account ([architecture 12](docs/architecture.md#12-self-hosting)).
Create a workspace from the start page. Sign-in links open a confirm page
(`/sign-in/link#…`); the token is used only when you click.
After that, operators add addresses to the email allowlist under Your
account, Installation settings, and anyone allowlisted signs in with an email
link. GitHub sign-in appears only when `GITHUB_CLIENT_ID` and
`GITHUB_CLIENT_SECRET` are set. The placeholder person from before sign-in
existed (handle `dev`, with a "Development" workspace) may still be in an
older development database; reset it with `docker compose -f
deploy/compose.dev.yml down -v` if it gets in the way.

`pnpm services:down` stops the services. If a port is taken, set
`SHINAN_DB_PORT`, `SHINAN_SMTP_PORT` or `SHINAN_MAILPIT_PORT` before
`pnpm services:up`, then point `DATABASE_URL`, `SMTP_PORT` and (for tests)
`MAILPIT_URL` at the new ports.

The server reads its settings from environment variables. A secret can
instead be read from a file: set `NAME_FILE` to its path rather than `NAME`
(for example `DATABASE_URL_FILE`, `SES_SECRET_ACCESS_KEY_FILE`).

| Variable                       | Default                                              | Meaning                                                                                                 |
| ------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                 | none (tests use the local service)                   | PostgreSQL connection string (secret)                                                                   |
| `HOST`                         | `127.0.0.1`                                          | Address the `web` role listens on                                                                       |
| `PORT`                         | `3000`                                               | Port the `web` role listens on                                                                          |
| `INTERNAL_HOST`                | `127.0.0.1`                                          | Address of the internal listener for health checks (`/healthz`, `/readyz`); never route a proxy to it   |
| `INTERNAL_PORT`                | `3001`                                               | Port of the internal listener                                                                           |
| `SHINAN_TRUSTED_PROXIES`       | none                                                 | Reverse proxies (IP addresses or CIDR ranges) whose `X-Forwarded-For` gives the client's address        |
| `NODE_ENV`                     | unset (`development` in `pnpm dev`)                  | `production` serves the built web app and requires SES and the sign-in settings                         |
| `WEB_DIST_DIR`                 | `apps/web/dist` in production                        | Directory of the built web app to serve                                                                 |
| `EMAIL_TRANSPORT`              | `smtp`, except in production (none)                  | `ses`, or `smtp` for the local mail catcher (not in production)                                         |
| `EMAIL_FROM`                   | `shinan@localhost` for `smtp`                        | From address; required for `ses`                                                                        |
| `EMAIL_FROM_NAME`              | `Shinan`                                             | From display name                                                                                       |
| `SES_REGION`                   | none                                                 | AWS region of the SES identity, such as `us-east-1`                                                     |
| `SES_ACCESS_KEY_ID`            | none (the AWS SDK's default chain)                   | Access key of the send-only IAM user (secret)                                                           |
| `SES_SECRET_ACCESS_KEY`        | none (the AWS SDK's default chain)                   | Its secret key (secret)                                                                                 |
| `SES_CONFIGURATION_SET`        | none                                                 | SES configuration set, such as `guneet-dev`                                                             |
| `SMTP_HOST`                    | `127.0.0.1`                                          | Mail catcher host, for `smtp`                                                                           |
| `SMTP_PORT`                    | `1025`                                               | Mail catcher port, for `smtp`                                                                           |
| `SHINAN_URL`                   | `http://localhost:5173`, except in production (none) | The installation's public address (an origin, HTTPS in production): the base of every link Shinan sends |
| `SHINAN_OPERATORS`             | none (required in production)                        | Installation operators' email addresses, separated by commas; they seed the email allowlist             |
| `SHINAN_SESSION_SECRET`        | a fixed value only with `NODE_ENV=development`       | Signs sign-in cookies and encrypts sign-in state; at least 32 characters (secret)                       |
| `GITHUB_CLIENT_ID`             | none (no GitHub sign-in)                             | The GitHub App's client ID, for sign-in                                                                 |
| `GITHUB_CLIENT_SECRET`         | none                                                 | The GitHub App's client secret (secret)                                                                 |
| `SIGN_IN_SESSION_IDLE_MINUTES` | `60`                                                 | A sign-in session ends after this long without activity                                                 |
| `SIGN_IN_SESSION_MAX_HOURS`    | `24`                                                 | A sign-in session ends after this long in any case                                                      |

In development the worker sends email to Mailpit; open http://localhost:8025
to read it. Email is queued as a job in the same transaction as the change
that sends it, and the worker sends it, retrying temporary errors for up to
an hour ([architecture 9.2](docs/architecture.md#92-how-shinan-sends)). The
`email_deliveries` table records each email's outcome; the message itself is
removed once the email is sent or given up.

The server's commands, from `apps/server`:

```sh
export DATABASE_URL=postgres://shinan@localhost:5432/shinan
pnpm migrate   # prepare the database: migrations, job queue tables, installation record (overlapping runs take turns)
pnpm worker    # worker role: background jobs (pg-boss), including email; needs migrate first
pnpm dev       # web role, restarting on changes (needs DATABASE_URL)
```

Recovery for installation operators ([identity 3.4](docs/identity.md#34-recovery)),
recorded in the security log:

```sh
node dist/cli.js account end-sessions <handle>           # end all of a person's sign-in sessions
node dist/cli.js account change-email <handle> <email>   # change their address and allowlist it; remove the old one from the allowlist,
                                                         # withdraw invitations pending for it, end their sessions. For an address in
                                                         # SHINAN_OPERATORS, replace it there and restart first.
```

### Web app and API

The web app (`apps/web`) uses [React Router](https://reactrouter.com/) in
declarative mode for its pages and one plain stylesheet
(`apps/web/src/styles.css`, narrow screens first) with no CSS framework or
design system. It talks to the server only through `@shinan/api-client`,
which also defines the REST API's JSON shapes and error codes.

API handlers in `apps/server/src/api` only translate: they call one core
operation and map its errors (`NotFoundError` to 404, `ForbiddenError` to 403,
`ReauthenticationRequiredError` to 403 with `reauthentication-required`,
`InvalidInputError` to 422, other `RuleViolationError`s to 409). Who is signed
in comes from the `SignIn` interface in `apps/server/src/api/sign-in.ts`,
which `apps/server/src/sign-in` implements with
[Better Auth](https://www.better-auth.com/docs) (email magic links and
GitHub). Better Auth runs the protocols; every rule (the allowlist, creating
accounts, linking GitHub) is a core operation it calls through its hooks.
Only `/api/auth` routes the web app uses are served. Sign-in tests mock
GitHub's OAuth endpoints and never call GitHub.

To run the production build: `pnpm build`, then `pnpm start` (the `web` role
serving the API and the built web app on port 3000).

### Security baseline

The [security checklist](docs/security-checklist.md) lists the controls and
how each is tested. In short:

- Every API request with a method other than GET, HEAD or OPTIONS must come
  from the web app: any `Origin` must equal `SHINAN_URL`, any
  `Sec-Fetch-Site` must be `same-origin`, and at least one of them must be
  sent, as browsers do; others get 403 `cross-site`. Open the development
  app at the address in `SHINAN_URL` (`http://localhost:5173`), not
  `127.0.0.1`.
- Rate limits per client address are counted in the `rate_limits` table
  (core's `rateLimits`), shared by every `web` process; the worker prunes it
  hourly. Behind a reverse proxy, set `SHINAN_TRUSTED_PROXIES` to the
  proxy's address, or every visitor shares the proxy's address and limits.
  A refusal is 429 with `Retry-After` (seconds left in the window).
- Every answer carries security headers and a strict Content Security Policy
  (no inline scripts or styles; `apps/server/src/security.ts`).
- Health checks are only on the internal listener: `/healthz` (liveness) and
  `/readyz` (database reachable and migrated); the public listener answers
  404 to any spelling of those paths. `/api/status` is the public, minimal
  check: a constant answer that touches no database and is not rate limited.
- Errors are logged by name, database error code and stack frames only,
  never their message (a failed query's message quotes its values), and the
  same error at most once a minute. A lost database connection, idle or in
  use, is logged by code and the pool reconnects.

### Checks

CI runs these on every pull request and on `main`:

```sh
pnpm format:check   # pnpm format:write fixes formatting
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

Tests need PostgreSQL: start it with `pnpm services:up`. Each package with
database tests (`db`, `core` and `server`) gets a fresh database for each run
on the server in `DATABASE_URL` (default
`postgres://shinan@localhost:5432/shinan`), with the migrations applied, and
drops it afterwards. Tests connect to it with `connectTestDatabase()` from
`@shinan/db/testing`. Run one package's tests with, for example,
`pnpm test --project db`.

Email tests (`email` and `core`) also need Mailpit, which `pnpm services:up`
starts too; CI runs it as a service container. They send to `SMTP_HOST` and
`SMTP_PORT` and read what arrived through Mailpit's API at `MAILPIT_URL`
(default `http://127.0.0.1:8025`), using `@shinan/email/testing`. The SES
sender is tested with a mocked client; tests never call AWS.

Workspace packages are resolved to their TypeScript source during development,
type checking and tests (through the `@shinan/source` export condition), so
only production runs need `pnpm build`.

### Database migrations

Change the schema in `packages/db/src/schema.ts`, then run `pnpm db:generate`
in `packages/db` to write a migration to `packages/db/migrations`. SQL that
Drizzle does not model, such as triggers, goes in a custom migration:
`pnpm db:generate --custom --name <name>`. The `migrate` command applies them.

`packages/core` reaches the database only through `@shinan/db`, which also
re-exports the Drizzle query helpers (`eq`, `and` and so on), so there is one
copy of Drizzle.

## Releases

Commits and pull request titles use
[Conventional Commits](https://www.conventionalcommits.org/). release-please
keeps a release pull request open on `main`; merging it creates the `vX.Y.Z`
tag, the GitHub Release and `CHANGELOG.md`. Versions start at `0.1.0`, and a
breaking change before 1.0.0 bumps the minor version. Releasing does not deploy
anything.

A release then builds the image ([`deploy/Dockerfile`](deploy/Dockerfile))
for `linux/amd64` and `linux/arm64` and publishes it to the private `shinan`
project on `cr.guneet.dev`, once CI and the first-start test pass on the
release commit (`.github/workflows/release.yml`). To build and test the image
locally:

```sh
docker build -f deploy/Dockerfile -t shinan:local .
SHINAN_IMAGE=shinan:local node deploy/test/first-start.mjs
```

The test starts the [reference Compose file](deploy/compose.yml) from nothing
with a local mail catcher and an HTTPS proxy, claims the installation through
its setup link, and checks the containers' hardening. CI runs it on every pull
request. The [operator guide](docs/operator-guide.md) explains running it for
real.
