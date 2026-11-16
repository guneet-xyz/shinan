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
- [Decision log](docs/decisions/README.md)
- [Agent instructions](AGENTS.md)

## Code layout

| Path                  | What it holds                                                                  |
| --------------------- | ------------------------------------------------------------------------------ |
| `apps/server`         | The Node.js program (Hono): the `web` and `worker` roles and `migrate` command |
| `apps/web`            | The React single-page app (Vite), served by `apps/server` in production        |
| `packages/core`       | Application modules, permissions and rules                                     |
| `packages/db`         | Drizzle schema and migrations                                                  |
| `packages/api-client` | Typed client for the REST API                                                  |
| `deploy/`             | Local development services; later the image and reference Compose file         |

The [build plan](docs/build-plan.md#2-code-layout-proposed) describes each part.

## Developing locally

You need Node.js 24 (see `.nvmrc`), pnpm (the version in `package.json`'s
`packageManager`; `corepack enable` picks it up) and Docker.

```sh
pnpm install
pnpm services:up   # PostgreSQL on localhost:5432 and Mailpit (http://localhost:8025)
pnpm dev           # API on http://localhost:3000, web app on http://localhost:5173
```

`pnpm services:down` stops the services. If a port is taken, set
`SHINAN_DB_PORT`, `SHINAN_SMTP_PORT` or `SHINAN_MAILPIT_PORT` before
`pnpm services:up`, and point `DATABASE_URL` at the new port.

The server reads its settings from environment variables:

| Variable       | Default                            | Meaning                                 |
| -------------- | ---------------------------------- | --------------------------------------- |
| `DATABASE_URL` | none (tests use the local service) | PostgreSQL connection string            |
| `HOST`         | `127.0.0.1`                        | Address the `web` role listens on       |
| `PORT`         | `3000`                             | Port the `web` role listens on          |
| `NODE_ENV`     | unset                              | `production` serves the built web app   |
| `WEB_DIST_DIR` | `apps/web/dist` in production      | Directory of the built web app to serve |

The server's commands, from `apps/server`:

```sh
export DATABASE_URL=postgres://shinan@localhost:5432/shinan
pnpm migrate   # prepare the database: migrations, job queue tables, installation record (overlapping runs take turns)
pnpm worker    # worker role: background jobs (pg-boss); needs migrate first
pnpm dev       # web role, restarting on changes
```

To run the production build: `pnpm build`, then `pnpm start` (the `web` role
serving the API and the built web app on port 3000).

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
