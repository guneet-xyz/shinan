# Security checklist

Status: **Proposed** checklist, results recorded on 2026-11-16 against
`feat/58-security` (M1-6, [#58](https://github.com/guneet-xyz/shinan/issues/58)).

[Architecture §10.1](architecture.md#101-threats-and-controls) requires a
written security checklist that must pass before the first public deployment
of `shinan.guneet.dev`, and again before the `workspace` repository's catalog
moves over. This is that checklist. It covers the threats and controls in
[architecture §10](architecture.md#10-security), the observability rules in
[§13](architecture.md#13-observability) that affect exposure, and the
protections for a public installation in
[identity §10](identity.md#10-protections-for-a-public-installation). Those
documents own the rules; this one only checks them.

## How to use it

- Each item says how it is checked: a test (which runs in CI on every pull
  request), a command, or a reading of the code or configuration.
- Results:
  - **Pass**: true of the code today.
  - **Fail**: not true today; the item says what is needed and who does it.
  - **Deployment**: depends on how Shinan is deployed; checked when the
    deployment is prepared ([M1-7](https://github.com/guneet-xyz/shinan/issues/59))
    and again at the deployment approval.
  - **Later**: the feature is not built yet. The package that builds it adds
    the check, and the item must pass before that feature is deployed.
- Before the first public deployment, every item must be **Pass**, or
  **Deployment** with the deployment's evidence, or **Later**. Before the
  catalog moves over, run the whole list again, including the **Later** items
  built by then.
- When a change alters a result, the same pull request updates this document.

## 1. Web hardening

| #    | Item                                                                                                                                                                                                         | How it is checked                                                                                                                                                                                 | Result     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1.1  | HTTPS only: the installation's address must be HTTPS in production                                                                                                                                           | `readWebConfig` refuses an `http:` `SHINAN_URL` with `NODE_ENV=production` (`config.test.ts`)                                                                                                     | Pass       |
| 1.2  | HSTS on every answer of an HTTPS installation (two years, subdomains)                                                                                                                                        | `security.test.ts`, "security headers"                                                                                                                                                            | Pass       |
| 1.3  | Plain HTTP is redirected to HTTPS before it reaches Shinan                                                                                                                                                   | Public Caddy does this for every site; checked at deployment                                                                                                                                      | Deployment |
| 1.4  | Content Security Policy on every answer, with no inline scripts or styles, no `unsafe-*` sources, `default-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`                                          | `security.test.ts`, "security headers"                                                                                                                                                            | Pass       |
| 1.5  | The web app works under that policy: its page loads only files from its own origin and it writes no raw HTML                                                                                                 | `apps/web/src/csp.test.ts`; the built `index.html` (`pnpm build`) has only `<script src>` and `<link rel="stylesheet">`                                                                           | Pass       |
| 1.6  | No framing: `frame-ancestors 'none'` and `X-Frame-Options: DENY`                                                                                                                                             | `security.test.ts`                                                                                                                                                                                | Pass       |
| 1.7  | Strict `Referrer-Policy` (`no-referrer`), `X-Content-Type-Options: nosniff`, `Permissions-Policy` turning off unused features, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy` `same-origin` | `security.test.ts`                                                                                                                                                                                | Pass       |
| 1.8  | API answers are never cached (`Cache-Control: no-store`)                                                                                                                                                     | `security.test.ts`                                                                                                                                                                                | Pass       |
| 1.9  | No sensitive data in addresses: sign-in, setup and invitation tokens travel in the address fragment and request bodies, never in a path or query                                                             | Sign-in tests (`sign-in.test.ts`: links carry the token after `#`); API reads tokens only from bodies (`routes.ts`). GitHub's one-time OAuth `code` is in its callback's query, as OAuth requires | Pass       |
| 1.10 | Uniform, generic errors; no stack traces or internal details to clients                                                                                                                                      | `routes.test.ts`, "unexpected errors" and "errors from the sign-in layer"                                                                                                                         | Pass       |
| 1.11 | Request size limit on the API (64 KB), applied before a body is read                                                                                                                                         | `routes.test.ts`, "request bodies"                                                                                                                                                                | Pass       |
| 1.12 | Nothing is served without sign-in except the sign-in, setup and invitation pages and their routes, the installation's name, and a minimal status answer (`/api/status`)                                      | `routes.test.ts`, "without sign-in"; the public routes are listed in [architecture §10.2](architecture.md#102-web-hardening)                                                                      | Pass       |

## 2. Cross-site request forgery

| #   | Item                                                                                                                                                                                                            | How it is checked                                                                                                               | Result |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2.1 | Every state-changing API request (any method but GET, HEAD and OPTIONS), including the sign-in routes, is refused unless its `Origin` is the installation's and its `Sec-Fetch-Site`, if sent, is `same-origin` | `security.test.ts`, "cross-site request forgery protection": every POST, PUT, PATCH and DELETE route the API registers is tried | Pass   |
| 2.2 | Sites under the same domain cannot forge requests (`Sec-Fetch-Site: same-site` is refused)                                                                                                                      | `security.test.ts`                                                                                                              | Pass   |
| 2.3 | With real sign-in, another site cannot ask for a sign-in link, open one, sign out or end sessions                                                                                                               | `security.test.ts`, "with sign-in"                                                                                              | Pass   |
| 2.4 | No GET request changes state, except GitHub's OAuth callback, which Better Auth protects with its `state` value bound to the browser                                                                            | Reading `routes.ts` and the served sign-in routes (`better-auth.ts`); GitHub sign-in tests                                      | Pass   |

## 3. Sign-in, sessions and accounts

| #    | Item                                                                                                                    | How it is checked                                                                                                       | Result |
| ---- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------ |
| 3.1  | No passwords: sign-in by email magic link or GitHub only                                                                | Only the magic-link and GitHub routes are served (`sign-in.test.ts`, "serves only the sign-in routes the web app uses") | Pass   |
| 3.2  | Sign-in cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, host-only, with `__Secure-`/`__Host-` prefixes on HTTPS       | `security.test.ts`, "sign-in cookies on an HTTPS installation"                                                          | Pass   |
| 3.3  | Magic links are short-lived (15 minutes) and work once                                                                  | `sign-in.test.ts`, "works once", "expires after 15 minutes"                                                             | Pass   |
| 3.4  | Magic links only go to allowlisted addresses, with the same answer whether or not the address is allowlisted            | `sign-in.test.ts`, "answers the same for an address that is not allowlisted"                                            | Pass   |
| 3.5  | Session, magic-link and setup tokens are stored only as hashes; no GitHub token is stored, and the database refuses one | `sign-in.test.ts`, "stores session and link tokens only as hashes"; the `sign_in_accounts_no_credentials` check         | Pass   |
| 3.6  | Sign-in sessions end after an hour idle and 24 hours in any case; sensitive actions need a recent sign-in               | Sign-in session tests in `sign-in.test.ts`; core's re-authentication rules (`permissions.test.ts`)                      | Pass   |
| 3.7  | Security emails on new-browser sign-ins and sign-in method changes                                                      | `sign-in.test.ts`, "email the person when a new browser signs in"; core account tests                                   | Pass   |
| 3.8  | Security emails on new agent tokens                                                                                     | Agent tokens are built in M2                                                                                            | Later  |
| 3.9  | The first-start setup link is printed once, single-use, expires in 24 hours, and needs an operator's mailbox too        | `first-start.test.ts`                                                                                                   | Pass   |
| 3.10 | No extra sign-in layer in front of the pages (owner, O-68)                                                              | Decided; nothing to check                                                                                               | Pass   |

## 4. Abuse, floods and the client's address

| #   | Item                                                                                                                                                                                                                     | How it is checked                                                                                                                | Result     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 4.1 | Rate limits per network address are counted in PostgreSQL, so they hold across every `web` process; Better Auth's in-memory limiter is off                                                                               | `rate-limits.test.ts` (core), including concurrent requests; `security.test.ts`, "are shared by every web process"               | Pass       |
| 4.2 | Sign-in throttling: asking for links, opening links, GitHub sign-in and the first start; invitation token use                                                                                                            | `security.test.ts`, "rate limits"; limits listed in core's `rateLimits`                                                          | Pass       |
| 4.3 | Email throttling per recipient and per network address, so Shinan cannot flood a mailbox                                                                                                                                 | Core email tests (`email.test.ts`)                                                                                               | Pass       |
| 4.4 | A ceiling on all API requests per address                                                                                                                                                                                | `security.test.ts`, "put a ceiling on every API request"                                                                         | Pass       |
| 4.5 | Throttled sign-ins and token use are recorded in the security log, once per address and window so a flood cannot fill the log                                                                                            | `rate-limits.test.ts`, `security.test.ts`                                                                                        | Pass       |
| 4.6 | The client's address is the socket's, unless the socket is a configured trusted proxy (`SHINAN_TRUSTED_PROXIES`); then the rightmost address in `X-Forwarded-For` no trusted proxy vouches for                           | `client-address.test.ts`; `security.test.ts`, "the client's address behind a proxy" (security log, session and email throttling) | Pass       |
| 4.7 | On `shinan.guneet.dev`, `SHINAN_TRUSTED_PROXIES` names public Caddy's address on `caddy-public-shinan` (and nothing wider), and Caddy is the only way in. Without it every visitor shares Caddy's address and its limits | Stack configuration, checked at deployment                                                                                       | Deployment |
| 4.8 | Per-token rate limits                                                                                                                                                                                                    | Agent tokens are built in M2                                                                                                     | Later      |

## 5. Secrets, credentials and logs

| #   | Item                                                                                                                                                | How it is checked                                                                                                                                                                                                                               | Result     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 5.1 | Installation secrets come from environment variables or `*_FILE` files, never from the repository                                                   | `config.test.ts`, "reads secrets from files"                                                                                                                                                                                                    | Pass       |
| 5.2 | On Musashi, every secret comes from Obscuro and the owner types it                                                                                  | Stack configuration                                                                                                                                                                                                                             | Deployment |
| 5.3 | The session secret is required (at least 32 characters) outside development                                                                         | `config.test.ts`                                                                                                                                                                                                                                | Pass       |
| 5.4 | Logs never contain tokens, cookies, magic links, request bodies or `Authorization` headers; the setup link is the one exception, printed on purpose | No request logging; sign-in layer messages cut short (`sign-in.test.ts`, "never lets a request write its own lines into the log"); email and job errors by code only (`jobs.test.ts`, "logs failures by delivery ID and code"; `email.test.ts`) | Pass       |
| 5.5 | Database connection errors are logged by code only, and a lost connection does not crash `web` or `worker`                                          | `packages/db/src/index.test.ts`, "connection pool" (kills a connection); job queue errors by code only (`jobs.ts`)                                                                                                                              | Pass       |
| 5.6 | Git host credentials and webhook secrets are encrypted, and only the worker can use git host credentials                                            | Built in M3                                                                                                                                                                                                                                     | Later      |
| 5.7 | Agent tokens are stored as hashes, have a recognizable prefix, are never logged and are accepted only in a header                                   | Built in M2                                                                                                                                                                                                                                     | Later      |

## 6. Data isolation and audit

| #   | Item                                                                                    | How it is checked                                 | Result |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------- | ------ |
| 6.1 | Every workspace read and write goes through core's check and is scoped to one workspace | `isolation.test.ts`, `permissions.test.ts` (core) | Pass   |
| 6.2 | The security log is append-only; the database refuses updates and deletes               | `schema.test.ts` (db), "refuses updates"          | Pass   |
| 6.3 | Sign-ins, failures, allowlist changes, account and membership changes are recorded      | Core identity tests and `sign-in.test.ts`         | Pass   |

## 7. Health checks and exposure

| #   | Item                                                                                                                                   | How it is checked                                                           | Result     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------- |
| 7.1 | Health checks (`/healthz`, `/readyz`) are served only on the internal listener, not on the public one                                  | `app.test.ts`, "does not serve health checks publicly", "createInternalApp" | Pass       |
| 7.2 | The internal listener is not routed by Caddy and not published on the host; it binds to `127.0.0.1` unless the stack chooses otherwise | Stack configuration                                                         | Deployment |
| 7.3 | Metrics, when built, are served on the internal listener only                                                                          | Metrics are not built yet                                                   | Later      |

## 8. Dependencies and supply chain

| #   | Item                                                                                             | How it is checked                                                                                                                                                                                            | Result     |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 8.1 | Dependencies are pinned by a lockfile, and CI installs with `--frozen-lockfile`                  | `pnpm-lock.yaml`; `.github/workflows/ci.yml`                                                                                                                                                                 | Pass       |
| 8.2 | No known critical or high advisories                                                             | `pnpm audit --audit-level high` passes. Two moderate advisories, both in `esbuild`'s development server, reached only through development tools (`drizzle-kit`); Shinan never runs that server in production | Pass       |
| 8.3 | Automated dependency update pull requests, and critical advisories patched within 7 days         | No update automation or advisory alerts are set up for this repository yet. Needs the owner's choice (Dependabot alerts are a repository setting; who reviews update pull requests is a process choice)      | **Fail**   |
| 8.4 | Images rebuilt on base image updates; releases carry checksums and build provenance attestations | Release workflow and image build (M1-7)                                                                                                                                                                      | Deployment |
| 8.5 | GitHub Actions are pinned by commit                                                              | `.github/workflows/*.yml`                                                                                                                                                                                    | Pass       |

## 9. Containers and the host

| #   | Item                                                                                                       | How it is checked                                              | Result     |
| --- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------- |
| 9.1 | Non-root, read-only root filesystem, `cap_drop: ALL`, `no-new-privileges`, no Docker socket, no host ports | Dockerfile and stack (M1-7)                                    | Deployment |
| 9.2 | The database is only on the internal `shinan-backend` network, with no internet access                     | Stack ([architecture §11.2](architecture.md#112-shinan-stack)) | Deployment |
| 9.3 | Residual risk accepted: `monitoring-agent` and `mon-private-agent` have root-equivalent access on Musashi  | Accepted in architecture §10.1                                 | Pass       |

## 10. Features not built yet

Each must pass before the feature is deployed; the package that builds it adds
its tests here.

| #    | Item                                                                                                                                 | Result |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 10.1 | Webhooks: HMAC verified before parsing, unique delivery IDs, size limits ([architecture §6.1](architecture.md#61-webhook-intake))    | Later  |
| 10.2 | Outbound requests to Forgejo addresses refuse private, loopback and link-local ranges, checked on every request and redirect (D-048) | Later  |
| 10.3 | Wiki and catalog Markdown: raw HTML stripped or sanitized                                                                            | Later  |
| 10.4 | Outside text is never an instruction: no nudges from outside text, trust labels in MCP answers, triage before agents claim           | Later  |
| 10.5 | Read-only token scopes; bulk reads recorded in the security log                                                                      | Later  |
| 10.6 | Workspace export: owners only, recorded, no credentials                                                                              | Later  |
| 10.7 | MCP and plugin endpoints accept only tokens, never sign-in cookies, so cross-site requests cannot use them                           | Later  |

## Open items before the first public deployment

- **8.3** (Fail): the owner chooses how dependency advisories and update pull
  requests are handled, for example turning on Dependabot alerts and security
  updates for this repository.
- Every **Deployment** item is checked by M1-7 and at the deployment approval.
