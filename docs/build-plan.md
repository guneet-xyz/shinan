# Shinan: build plan for phase 1a

Status: **approved by the owner on 2026-11-16** ([issue #51](https://github.com/guneet-xyz/shinan/issues/51)).

This plan turns the approved documents into working software. It does not
change any decision; where it proposes something the documents leave open, it
says so. The milestones, scope and cut line come from the
[roadmap](roadmap.md#33-build-milestones); the technology and system design come
from [architecture](architecture.md).

## 1. What gets built

Phase 1a is built in four milestones. Each is deployed to `shinan.guneet.dev`
(with the owner's approval) before the next starts, and the owner reviews scope
at the end of each ([roadmap 3.3](roadmap.md#33-build-milestones)).

| Milestone                   | Contents                                                                                                                                                                          | Trial use                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **M1. Empty installation**  | Sign-in (email magic link, GitHub), email sending through SES, one workspace, members and roles, first start, security log, deployment on Musashi, uptime monitoring              | None; security checks     |
| **M2. Catalog**             | Catalog entities and facts, catalog proposals and approval, wiki, start here, agent index, agent registration, MCP read and propose, skill                                        | Catalog part of the trial |
| **M3. Tasks and git hosts** | Tasks and subtasks, work links, calculated status, flags, GitHub App and Forgejo connections, webhooks and reconciliation, outside issues, timeline, Now screen, readiness report | Task part of the trial    |
| **M4. Presence**            | OpenCode plugin, agent sessions and presence, attaching sessions to tasks, agents view                                                                                            | Trial fully running       |

The CLI and the workspace export can slip to G2; everything else in phase 1 may
not ([roadmap 3.2](roadmap.md#32-cut-line)).

## 2. Code layout (proposed)

One repository (this one), one pnpm workspace. Reason: one maintainer, shared
types between server, web app, plugin and CLI, one CI.

| Path                                       | What it holds                                                                                                                                                                                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server`                              | The single Node.js program (Hono, pg-boss): `web` and `worker` roles and the `migrate` command ([architecture 3.2](architecture.md#32-process-model)). HTTP routes, MCP endpoint, webhook intake and SSE live here.                                                    |
| `apps/web`                                 | The React single-page app (Vite), served as static files by `apps/server`. Styled with Tailwind CSS and shadcn/ui components ([D-055](decisions/D-055-tailwind-and-shadcn.md)).                                                                                        |
| `packages/core`                            | The application layer: modules for identity, catalog, tasks, git hosts, agents, events and email. All permissions and rules live here; it imports no web framework ([architecture 2.1](architecture.md#21-decided-stack)).                                             |
| `packages/db`                              | Drizzle schema and migrations.                                                                                                                                                                                                                                         |
| `packages/email`                           | The email sender interface ([architecture 9.2](architecture.md#92-how-shinan-sends)), the AWS SES sender, and an SMTP sender used only for the local mail catcher in development and tests. Core defines what is sent, queues and records it; this package only sends. |
| `packages/api-client`                      | Typed client for the REST API, shared by the web app, CLI and plugin.                                                                                                                                                                                                  |
| `packages/cli`, `packages/opencode-plugin` | Built in M2/M4 (CLI may slip to G2).                                                                                                                                                                                                                                   |
| `deploy/`                                  | The development Compose file (`compose.dev.yml`: PostgreSQL and a local mail catcher, M1-1); the Dockerfile, the reference Compose file (PostgreSQL, migrate, web, worker) and its first-start test (M1-7). The operator guide is `docs/operator-guide.md`.            |

## 3. Tooling (proposed)

- **Node.js 24 LTS**, **pnpm**, **TypeScript** in strict mode.
- **Prettier** exactly as the owner's
  [Prettier decision](https://git.guneet.dev/guneet/workspace/src/branch/main/decisions/prettier-configuration.md)
  sets out; **ESLint** for code rules.
- **Vitest** for tests; database tests run against a real PostgreSQL (a
  service container in CI, the development Compose file locally), and the test
  setup creates a fresh database for each run. Reason: no test touches
  development data, and tests do not depend on Docker being reachable from
  the test process.
- **GitHub Actions** on every PR: format, lint, type check, tests with
  PostgreSQL. Image builds come in M1's deployment package.
- **Releases** with release-please and Conventional Commits, starting at
  `0.1.0`, as the owner's
  [release decision](https://git.guneet.dev/guneet/workspace/src/branch/main/decisions/release-versioning.md)
  requires. Merging the release PR is the approval to release; it does not
  deploy anything.

Library choices left open by architecture are settled in
[section 8](#8-owner-answers).

## 4. How the work is done (proposed)

- **Work packages.** Each milestone is split into work packages, one GitHub
  issue each, with one owning build agent. Packages that do not depend on each
  other run in parallel, each in its own worktree and branch.
- **Pull requests.** Every change lands through a PR with tests. Commit and PR
  titles use Conventional Commits.
- **Review.** A separate reviewer agent reviews every PR against the documents
  it implements (correctness, permissions, tests, scope). A PR merges when CI
  passes and the reviewer approves. The owner does not review every code PR.
- **Owner checkpoints.** The owner reviews each milestone as a whole: a short
  demo note, what was built against the roadmap, anything cut, and any decision
  that came up. The owner also approves every deployment (D-016, D-039) and
  every credential step (people type secrets; agents never handle them).
- **Decisions found while building.** If code needs a choice the documents do
  not make, the build agent proposes it in its PR; anything that changes a
  decision record goes to the owner before merge and gets a new record.
- **Documents stay true.** A PR that changes behaviour the documents describe
  updates the owning document in the same PR.

## 5. M1 work packages

| #    | Package                                  | Contents                                                                                                                                                                                                                                                                                                                                                                                         | Depends on                     |
| ---- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| M1-1 | **Repository scaffold and CI**           | pnpm workspace, TypeScript, Prettier, ESLint, Vitest, the folder layout above, GitHub Actions CI with PostgreSQL, development Compose file (PostgreSQL, mail catcher), updated README                                                                                                                                                                                                            | —                              |
| M1-2 | **Core and database foundations**        | Installation, people, workspaces, members and roles (owner, contributor), the application-layer pattern with permission checks, append-only events, the security log (never purged, D-049), migrations and the `migrate` command, `web`/`worker` roles and the job queue                                                                                                                         | M1-1                           |
| M1-3 | **Email**                                | The email sender behind a small interface, the AWS SES SDK implementation, the local mail catcher in development, throttling, retries and failure records ([architecture 9](architecture.md#9-email-and-notifications))                                                                                                                                                                          | M1-2                           |
| M1-4 | **Sign-in and accounts**                 | Email allowlist, email magic link, GitHub sign-in, first start through the one-time setup link ([identity 3.2](identity.md#32-who-can-have-an-account)), re-authentication, sign-in sessions, security alert emails, invitations to the one workspace                                                                                                                                            | M1-2, M1-3                     |
| M1-5 | **Web app shell**                        | React app, sign-in pages, your account, workspace settings (members, roles, invitations, general settings), security log view                                                                                                                                                                                                                                                                    | M1-2; screens finish with M1-4 |
| M1-6 | **Security baseline**                    | Web hardening (headers, CSRF, cookies, rate limits), the security checklist that must pass before the first public deployment ([architecture 10](architecture.md#10-security))                                                                                                                                                                                                                   | M1-4, M1-5                     |
| M1-7 | **Packaging and deployment preparation** | Dockerfile and multi-architecture image, the reference Compose file and operator guide for self-hosting ([architecture 12](architecture.md#12-self-hosting)), release workflow pushing to the public registry project, the `infra/musashi` stack PR, the DNS PR in `guneet/terraform`, the mon uptime tile PR. **These PRs prepare a deployment; nothing is deployed until the owner approves.** | M1-1; finishes after M1-6      |
| M1-8 | **Tailwind CSS and shadcn/ui**           | Tailwind CSS and shadcn/ui in `apps/web` ([D-055](decisions/D-055-tailwind-and-shadcn.md)), light and dark themes, every M1 screen redesigned with the components, `prettier-plugin-tailwindcss`, the strict Content Security Policy kept and checked in a browser ([#75](https://github.com/guneet-xyz/shinan/issues/75))                                                                       | M1-5, M1-6                     |

M1-1 starts first. M1-2 follows; then M1-3, M1-4 and M1-5 run in parallel, then
M1-6 and M1-7. M1-8 was added after the first deployment, at the owner's
request, so the owner's M1 review sees the redesigned screens. M2 to M4 get
their own package lists at each milestone review.

## 6. Owner actions for M1

These need the owner because they involve credentials or a deployment; agents
prepare the exact steps ([roadmap 3.4](roadmap.md#34-owner-actions-needed-in-phase-1),
[architecture 11.6](architecture.md#116-what-needs-deployment-approval)):

1. Create the public `shinan` project on `cr.guneet.dev` with a push key (in
   this repository's GitHub secrets); Musashi pulls without a key
   ([D-054](decisions/D-054-public-image-registry-project.md)).
2. Register the private GitHub App owned by `guneet-xyz`, with sign-in only
   for now ([identity](identity.md), [git hosts](git-hosts.md)).
3. Create the SES send-only IAM user (`mail-shinan`) for `auth@guneet.dev` and put its key in
   Obscuro.
4. Approve the first deployment: the stack, the Caddy route and bridge, the
   internal backend network, the DNS record and the mon tile.

## 7. What this plan does not do

- No code is written until the owner approves this plan.
- No deployment, DNS change or credential is created by agents.
- The trial itself, and the note in the `workspace` repository's collaboration
  rules, start at M2 as the roadmap says.

## 8. Owner answers

Decided by the owner on 2026-11-16 ([issue #51](https://github.com/guneet-xyz/shinan/issues/51)):

1. **HTTP framework:** Hono.
2. **Job queue:** pg-boss.
3. **Code review gate:** a reviewer agent plus green CI merges code PRs; the
   owner reviews each milestone as a whole and approves every deployment.
4. **GitHub sign-in credentials:** reuse the private GitHub App planned for git
   host connections. It is registered in M1 with sign-in only; repository
   permissions are added in M3.
