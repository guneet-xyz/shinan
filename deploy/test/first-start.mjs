#!/usr/bin/env node
// Starts the reference Compose file (deploy/compose.yml) from nothing, as a
// self-hoster would, and checks the first start end to end (architecture
// §12): migrations run, the one-time setup link appears in the `web` log,
// the operator claims the installation through the email it sends, and the
// containers run as the reference file says. It also checks that the image's
// own files are not writable by the user it runs as. Email goes to a local mail
// catcher and HTTPS comes from a proxy with a self-signed certificate
// (deploy/test/compose.test.yml).
//
//   docker build -f deploy/Dockerfile -t shinan:local .
//   SHINAN_IMAGE=shinan:local node deploy/test/first-start.mjs [--keep]
//
// Needs Docker with Compose 2.23.1 or later. Ports: TEST_HTTPS_PORT (18443),
// TEST_MAILPIT_PORT (18025) and SHINAN_PORT (13000) on 127.0.0.1. Everything
// it creates is removed at the end unless --keep is given.
import { execFileSync, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const image = process.env.SHINAN_IMAGE
if (!image) {
  console.error("Set SHINAN_IMAGE to the image to test")
  process.exit(2)
}
const keep = process.argv.includes("--keep")

const httpsPort = process.env.TEST_HTTPS_PORT ?? "18443"
const mailpitPort = process.env.TEST_MAILPIT_PORT ?? "18025"
const installationUrl = `https://localhost:${httpsPort}`
const mailpitUrl = `http://127.0.0.1:${mailpitPort}`
const proxyAddress = "10.247.247.10"
const operator = "operator@example.com"

// Caddy's certificate is self-signed; only this test process skips the check.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
process.removeAllListeners("warning")

const project = `shinan-first-start-${randomBytes(3).toString("hex")}`
const dir = mkdtempSync(join(tmpdir(), "shinan-first-start-"))
const deploy = fileURLToPath(new URL("..", import.meta.url))

function writeSecret(name, value) {
  writeFileSync(join(dir, "secrets", name), value, { mode: 0o644 })
}

// The operator's files, as the operator guide describes them.
mkdirSync(join(dir, "secrets"), { mode: 0o700 })
const postgresPassword = randomBytes(24).toString("hex")
writeSecret("postgres_password", postgresPassword)
writeSecret(
  "database_url",
  `postgres://shinan:${postgresPassword}@postgres:5432/shinan`,
)
writeSecret("session_secret", randomBytes(32).toString("base64url"))
writeSecret("ses_access_key_id", "unused-in-this-test")
writeSecret("ses_secret_access_key", "unused-in-this-test")
writeFileSync(
  join(dir, ".env"),
  [
    `SHINAN_IMAGE=${image}`,
    `SHINAN_URL=${installationUrl}`,
    `SHINAN_OPERATORS=${operator}`,
    `SHINAN_TRUSTED_PROXIES=${proxyAddress}`,
    `SHINAN_PORT=${process.env.SHINAN_PORT ?? "13000"}`,
    "EMAIL_FROM=shinan@example.com",
    "SES_REGION=us-east-1",
    `TEST_HTTPS_PORT=${httpsPort}`,
    `TEST_MAILPIT_PORT=${mailpitPort}`,
    "TEST_PROXY_SUBNET=10.247.247.0/24",
    `TEST_PROXY_ADDRESS=${proxyAddress}`,
    ...(process.env.TEST_CADDY_IMAGE
      ? [`TEST_CADDY_IMAGE=${process.env.TEST_CADDY_IMAGE}`]
      : []),
    "",
  ].join("\n"),
)

const composeArgs = [
  "compose",
  "--project-name",
  project,
  "--project-directory",
  dir,
  "-f",
  join(deploy, "compose.yml"),
  "-f",
  join(deploy, "test", "compose.test.yml"),
]

function compose(...args) {
  return execFileSync("docker", [...composeArgs, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function inspect(service, format) {
  const id = compose("ps", "--all", "--quiet", service).trim()
  return execFileSync("docker", ["inspect", "--format", format, id], {
    encoding: "utf8",
  }).trim()
}

/**
 * The container ports a service publishes on the host: those with a host
 * binding. Docker may leave an unpublished port out or list it without one;
 * for this file's PostgreSQL, Docker 28 shows `{}` and Docker 29
 * `{"5432/tcp":null}`.
 */
function publishedPorts(service) {
  const ports = JSON.parse(inspect(service, "{{json .NetworkSettings.Ports}}"))
  return Object.entries(ports ?? {})
    .filter(([, bindings]) => bindings?.length > 0)
    .map(([port]) => port)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(what, check, seconds = 120) {
  for (let i = 0; i < seconds; i++) {
    const value = await check()
    if (value) return value
    await sleep(1000)
  }
  throw new Error(`Timed out waiting for ${what}`)
}

let passed = 0
function check(condition, description) {
  if (!condition) throw new Error(`Check failed: ${description}`)
  passed++
  console.info(`ok ${passed} - ${description}`)
}

/** A browser: keeps cookies and sends what browsers send to the site. */
const cookies = new Map()
async function request(path, init = {}) {
  const headers = {
    origin: installationUrl,
    "sec-fetch-site": "same-origin",
    "user-agent":
      "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/140.0",
    ...init.headers,
  }
  if (cookies.size > 0) {
    headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ")
  }
  if (init.body !== undefined) headers["content-type"] = "application/json"
  const response = await fetch(new URL(path, installationUrl), {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    redirect: "manual",
  })
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(";")
    const index = pair.indexOf("=")
    cookies.set(pair.slice(0, index), pair.slice(index + 1))
  }
  return response
}

/**
 * Walks /app inside the image as its own user, on a writable root file
 * system and without a network, and lists what that user could write and
 * what is not owned by root or is writable by its group or everyone. What
 * it cannot read (a directory it cannot list, a file it cannot open for
 * reading) is listed too, so a broken image fails a check.
 */
function writableAppFiles() {
  const walk = `
    const fs = require("node:fs"), path = require("node:path")
    let checked = 0
    const writable = [], loose = [], unreadable = []
    const visit = (p) => {
      let stat, entries = []
      try {
        stat = fs.lstatSync(p)
        if (stat.isSymbolicLink()) return
        if (stat.isDirectory()) entries = fs.readdirSync(p)
        else if (stat.isFile()) fs.closeSync(fs.openSync(p, "r"))
      } catch (e) {
        unreadable.push(p + " " + e.code)
        if (!stat) return
      }
      checked++
      try { fs.accessSync(p, fs.constants.W_OK); writable.push(p) } catch {}
      if (stat.uid !== 0 || stat.gid !== 0 || stat.mode & 0o022)
        loose.push(p + " " + stat.uid + ":" + stat.gid + " " + (stat.mode & 0o7777).toString(8))
      for (const e of entries) visit(path.join(p, e))
    }
    visit("/app")
    console.log(JSON.stringify({ uid: process.getuid(), checked, writable, loose, unreadable }))`
  return JSON.parse(
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "none",
        "--entrypoint",
        "/nodejs/bin/node",
        image,
        "-e",
        walk,
      ],
      { encoding: "utf8" },
    ),
  )
}

async function healthy() {
  return inspect("web", "{{.State.Health.Status}}") === "healthy"
}

async function run() {
  const files = writableAppFiles()
  check(
    files.unreadable.length === 0,
    "the image's user can list every directory and read every file under /app" +
      (files.unreadable.length
        ? ` (not: ${files.unreadable.slice(0, 5).join(", ")})`
        : ""),
  )
  check(
    files.uid === 65532 && files.checked > 1000 && files.writable.length === 0,
    `the image's ${files.checked} files and directories under /app are not writable by its user` +
      (files.writable.length
        ? ` (writable: ${files.writable.slice(0, 5).join(", ")})`
        : ""),
  )
  check(
    files.loose.length === 0,
    "they are owned by root and not writable by their group or everyone" +
      (files.loose.length
        ? ` (not: ${files.loose.slice(0, 5).join(", ")})`
        : ""),
  )

  console.info(`Starting ${project} in ${dir}`)
  compose("up", "--detach", "--quiet-pull")

  await waitFor("web to be healthy", healthy)
  check(
    inspect("migrate", "{{.State.Status}} {{.State.ExitCode}}") === "exited 0",
    "migrate ran and exited 0",
  )
  check(
    inspect("worker", "{{.State.Status}}") === "running",
    "worker is running",
  )
  check(
    inspect("web", "{{.State.Health.Status}}") === "healthy",
    "web is healthy (its internal /readyz answers inside the container)",
  )

  for (const service of ["web", "worker", "migrate"]) {
    check(
      inspect(
        service,
        "{{.Config.User}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.SecurityOpt}}",
      ) === "nonroot true [ALL] [no-new-privileges:true]",
      `${service} runs as nonroot, read-only, without capabilities or new privileges`,
    )
  }
  check(
    publishedPorts("web").join(" ") === "3000/tcp",
    "web publishes only port 3000, not the internal listener",
  )
  check(publishedPorts("postgres").length === 0, "PostgreSQL publishes no port")

  const log = compose("logs", "--no-color", "web")
  const links = [...log.matchAll(/(https:\/\/\S+\/setup)#(\S+)/g)]
  check(links.length === 1, "web printed one setup link to its log")
  const [, setupPage, setupToken] = links[0]
  check(
    setupPage === `${installationUrl}/setup`,
    "the setup link uses SHINAN_URL",
  )

  const page = await request("/")
  check(
    page.status === 200 &&
      (page.headers.get("content-type") ?? "").includes("text/html"),
    "the web app's page is served",
  )
  check(
    (page.headers.get("strict-transport-security") ?? "").includes(
      "max-age=",
    ) &&
      (page.headers.get("content-security-policy") ?? "").includes(
        "default-src 'none'",
      ),
    "pages carry HSTS and the Content Security Policy",
  )
  check(
    (await request("/healthz")).status === 404 &&
      (await request("/readyz")).status === 404,
    "health checks are not served through the proxy",
  )
  check((await request("/api/status")).status === 200, "/api/status answers")

  const setup = await request("/api/setup", {
    body: { token: setupToken, email: operator },
  })
  check(setup.status === 204, "the setup link accepts the operator's address")

  const message = await waitFor("the sign-in email in Mailpit", async () => {
    const search = await fetch(
      `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${operator}`)}`,
    )
    const { messages } = await search.json()
    if (!messages?.length) return null
    const full = await fetch(`${mailpitUrl}/api/v1/message/${messages[0].ID}`)
    return full.json()
  })
  check(true, "the worker sent the sign-in email")
  const link = message.Text.match(/https:\/\/\S+/)?.[0]
  check(
    link?.startsWith(`${installationUrl}/sign-in/link#`),
    "the email holds a sign-in link to the installation",
  )
  const fragment = new URLSearchParams(new URL(link).hash.slice(1))
  const opened = await request("/api/sign-in/link", {
    body: { token: fragment.get("token"), next: fragment.get("next") },
  })
  const { location } = await opened.json()
  check(opened.status === 200 && location === "/", "opening the link signs in")

  const account = await (await request("/api/account")).json()
  check(account.operator === true, "the first account is an operator")

  const workspace = await request("/api/workspaces", {
    body: { name: "First workspace" },
  })
  check(workspace.status === 201, "the operator creates a workspace")

  const addresses = compose(
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "shinan",
    "-d",
    "shinan",
    "-Atc",
    "select distinct host(network_address) from security_log where action = 'sign-in.succeeded'",
  )
    .trim()
    .split("\n")
  check(
    addresses.length === 1 &&
      addresses[0] !== "" &&
      addresses[0] !== proxyAddress,
    `the security log has the visitor's address (${addresses[0]}), not the proxy's`,
  )

  compose("restart", "web")
  await sleep(2000)
  await waitFor("web to be healthy again", healthy)
  const again = compose("logs", "--no-color", "web")
  check(
    [...again.matchAll(/\/setup#/g)].length === 1,
    "after a restart, a claimed installation prints no setup link",
  )
  const firstRun = inspect("migrate", "{{.State.StartedAt}}")
  compose("up", "--detach", "--quiet-pull")
  await waitFor("migrate to run and finish again", () =>
    inspect("migrate", "{{.State.Status}}") === "exited" &&
    inspect("migrate", "{{.State.StartedAt}}") !== firstRun
      ? true
      : null,
  )
  check(
    inspect("migrate", "{{.State.ExitCode}}") === "0",
    "migrate runs again on the next up and exits 0",
  )

  console.info(`All ${passed} checks passed`)
}

let failed = false
try {
  await run()
} catch (error) {
  failed = true
  console.error(String(error))
  const logs = spawnSync("docker", [...composeArgs, "logs", "--no-color"], {
    encoding: "utf8",
  })
  console.error(logs.stdout, logs.stderr)
} finally {
  if (keep) {
    console.info(`Kept ${project}; its files are in ${dir}`)
  } else {
    spawnSync("docker", [...composeArgs, "down", "--volumes"], {
      stdio: "ignore",
    })
    rmSync(dir, { recursive: true, force: true })
  }
}
process.exitCode = failed ? 1 : 0
