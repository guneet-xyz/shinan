#!/usr/bin/env node
// Starts the reference Compose file (deploy/compose.yml) from nothing, as a
// self-hoster would, and checks the first start end to end (architecture
// §12): migrations run, the one-time setup link appears in the `web` log,
// the operator claims the installation through the email it sends, and the
// containers run as the reference file says. It also checks that the image's
// own files, Git's included, are not writable by the user it runs as, that
// the image has no shell, and that Git works inside it without one
// (deploy/test/git-in-image.mjs). Email goes to a local mail catcher and
// HTTPS comes from a proxy with a self-signed certificate
// (deploy/test/compose.test.yml).
//
//   docker build -f deploy/Dockerfile -t shinan:local .
//   SHINAN_IMAGE=shinan:local node deploy/test/first-start.mjs [--keep]
//
// Needs Docker with Compose 2.23.1 or later. Ports: TEST_HTTPS_PORT (18443),
// TEST_MAILPIT_PORT (18025) and SHINAN_PORT (13000) on 127.0.0.1. Everything
// it creates is removed at the end unless --keep is given.
import { execFileSync, spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs"
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
const gitServiceToken = randomBytes(32).toString("base64url")
writeSecret("git_service_token", gitServiceToken)
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

/**
 * The `git` client as an agent runs it, with GC-9's agent setup: a
 * credential helper that reads the token from `~/.config/shinan/token` and
 * gives it as the password (`token`: the token to put there; `null`: no
 * helper at all). Caddy's certificate is self-signed: only these runs skip
 * Git's check of it.
 */
const agentHome = join(dir, "agent-home")
function agentGit(args, { cwd = dir, token } = {}) {
  mkdirSync(join(agentHome, ".config", "shinan"), { recursive: true })
  if (token)
    writeFileSync(join(agentHome, ".config", "shinan", "token"), token, {
      mode: 0o600,
    })
  const helper =
    token === null
      ? []
      : [
          "-c",
          `credential.${installationUrl}.helper=`,
          "-c",
          `credential.${installationUrl}.helper=!f(){ test "$1" = get && printf "username=agent\\npassword=%s\\n" "$(cat ~/.config/shinan/token)"; }; f`,
        ]
  const result = spawnSync(
    "git",
    ["-c", "http.sslVerify=false", ...helper, ...args],
    {
      cwd,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: agentHome,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        LC_ALL: "C",
      },
    },
  )
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

/** As `agentGit`, without waiting: several agents at once, each with its own home. */
function agentGitAsync(args, { cwd, home, token }) {
  mkdirSync(join(home, ".config", "shinan"), { recursive: true })
  writeFileSync(join(home, ".config", "shinan", "token"), token, {
    mode: 0o600,
  })
  return new Promise((resolve) => {
    const child = spawn(
      "git",
      [
        "-c",
        "http.sslVerify=false",
        "-c",
        `credential.${installationUrl}.helper=`,
        "-c",
        `credential.${installationUrl}.helper=!f(){ test "$1" = get && printf "username=agent\\npassword=%s\\n" "$(cat ~/.config/shinan/token)"; }; f`,
        ...args,
      ],
      {
        cwd,
        env: {
          PATH: process.env.PATH,
          HOME: home,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
          LC_ALL: "C",
        },
      },
    )
    let stderr = ""
    child.stderr.on("data", (chunk) => (stderr += chunk))
    child.stdout.resume()
    child.on("close", (code) => resolve({ code, stderr }))
  })
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
  const jar = init.cookies ?? cookies
  const headers = {
    origin: installationUrl,
    "sec-fetch-site": "same-origin",
    "user-agent":
      "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/140.0",
    ...init.headers,
  }
  if (jar.size > 0) {
    headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ")
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
    jar.set(pair.slice(0, index), pair.slice(index + 1))
  }
  return response
}

/**
 * Walks /app and Git's files inside the image as its own user, on a
 * writable root file system and without a network, and lists what that
 * user could write and what is not owned by root or is writable by its
 * group or everyone. What it cannot read (a directory it cannot list, a
 * file it cannot open for reading) is listed too, so a broken image fails a
 * check. It also lists the programs that must run and cannot, and any
 * shell or interpreter besides Node.js that is present.
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
    const libraries = fs.readdirSync("/usr/lib").filter((d) => d.endsWith("-linux-gnu"))
      .flatMap((d) => fs.readdirSync("/usr/lib/" + d).filter((f) => f.startsWith("libpcre2-8.so.")).map((f) => "/usr/lib/" + d + "/" + f))
    for (const p of ["/app", "/usr/bin/git", "/usr/lib/git-core", ...libraries]) visit(p)
    const programs = ["/usr/bin/git", "/usr/lib/git-core/git", "/usr/lib/git-core/git-http-backend", "/app/packages/git/hooks/pre-receive"]
    const notRunnable = programs.filter((p) => { try { fs.accessSync(p, fs.constants.X_OK); return false } catch { return true } })
    const shells = ["/bin/sh", "/bin/bash", "/bin/dash", "/usr/bin/sh", "/usr/bin/bash", "/usr/bin/dash", "/bin/busybox", "/usr/bin/perl", "/usr/bin/python3"]
      .filter((p) => { try { fs.lstatSync(p); return true } catch { return false } })
    const c = fs.statSync("/var/lib/shinan/catalog")
    const catalog = c.uid + ":" + c.gid + " " + (c.mode & 0o7777).toString(8) + " " + fs.readdirSync("/var/lib/shinan/catalog").length
    console.log(JSON.stringify({ uid: process.getuid(), checked, writable, loose, unreadable, libraries, notRunnable, shells, catalog }))`
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

/**
 * Runs deploy/test/git-in-image.mjs inside the image, as the reference
 * Compose file runs a role: its own user, a read-only root file system with
 * a /tmp, no capabilities and no network.
 */
function gitInImage() {
  const script = readFileSync(
    fileURLToPath(new URL("git-in-image.mjs", import.meta.url)),
    "utf8",
  )
  return JSON.parse(
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--read-only",
        "--tmpfs",
        "/tmp",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--network",
        "none",
        "--entrypoint",
        "/nodejs/bin/node",
        image,
        "--input-type=module",
        "-e",
        script,
      ],
      { encoding: "utf8" },
    ),
  )
}

async function healthy() {
  return inspect("web", "{{.State.Health.Status}}") === "healthy"
}

/**
 * Asks the Git container from a container on `network`, as `worker` does:
 * Node.js in the Shinan image, with the given token (or none). Answers the
 * status and body, or the error's code when nothing answered.
 */
function askGit(network, path, token) {
  const script = `
    const headers = process.env.TOKEN ? { authorization: "Bearer " + process.env.TOKEN } : {}
    fetch("http://git:3000" + process.env.ASK, { headers, signal: AbortSignal.timeout(5000) })
      .then(async (r) => console.log(JSON.stringify({ status: r.status, body: await r.json() })))
      .catch((e) => console.log(JSON.stringify({ error: e.cause?.code ?? e.name })))`
  return JSON.parse(
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        `${project}_${network}`,
        "--env",
        `ASK=${path}`,
        "--env",
        `TOKEN=${token ?? ""}`,
        "--entrypoint",
        "/nodejs/bin/node",
        image,
        "-e",
        script,
      ],
      { encoding: "utf8" },
    ),
  )
}

/**
 * A request to the Git container that answers only a summary of what came
 * back, for answers too large to pass through a command's output.
 */
function askGitSummary(path, body) {
  const script = `
    fetch("http://git:3000" + process.env.ASK, {
      method: process.env.BODY ? "POST" : "GET",
      headers: { authorization: "Bearer " + process.env.TOKEN, "content-type": "application/json" },
      body: process.env.BODY || undefined,
      signal: AbortSignal.timeout(120000),
    })
      .then(async (r) => {
        const b = await r.json()
        const documents = b.documents ?? []
        const commits = b.commits ?? []
        console.log(JSON.stringify({
          status: r.status,
          read: documents.filter((d) => d.content).length,
          bytes: documents.reduce((n, d) => n + (d.content ? Buffer.from(d.content, "base64").length : 0), 0),
          deferred: documents.filter((d) => d.deferred).length,
          commits: commits.length,
          truncated: commits.filter((c) => c.truncated).length,
          longest: Math.max(0, ...commits.map((c) => Buffer.byteLength(c.message))),
          changesTruncated: commits.filter((c) => c.changesTruncated).length,
          mostChanges: Math.max(0, ...commits.map((c) => c.changes.length)),
          mostChanged: Math.max(0, ...commits.map((c) => c.changeCount)),
        }))
      })
      .catch((e) => console.log(JSON.stringify({ error: e.cause?.code ?? e.name })))`
  return JSON.parse(
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        `${project}_git`,
        "--env",
        `ASK=${path}`,
        "--env",
        `TOKEN=${gitServiceToken}`,
        "--env",
        `BODY=${body ? JSON.stringify(body) : ""}`,
        "--entrypoint",
        "/nodejs/bin/node",
        image,
        "-e",
        script,
      ],
      { encoding: "utf8" },
    ),
  )
}

/**
 * Inside the running `git` container, as its own user: a repository whose
 * commits are heavy to read but light to store, as an agent could push
 * them from GC-3 on. Its `main` has 1,000 paths to one 1 MiB blob, on top
 * of 70 commits with 15 MiB messages.
 */
function writeHeavyRepository(workspaceId) {
  const script = `
    const { randomBytes } = await import("node:crypto")
    const { createGit, writeCommit } = await import("/app/packages/git/dist/index.js")
    const git = createGit()
    const gitDir = "/var/lib/shinan/catalog/${workspaceId}.git"
    const identity = { name: "Test", email: "test@example.com" }
    let head = (await git.run(["rev-parse", "refs/heads/main"], { gitDir })).stdout.toString().trim()
    const message = "Long\\n\\n" + "x".repeat(15 * 1024 * 1024) + "\\n"
    for (let i = 0; i < 70; i++) {
      head = await writeCommit(git, gitDir, { files: [{ path: "README.md", content: "# Catalog\\n" }], message, identity, parents: [head], temporaryDir: gitDir })
    }
    const blob = (await git.run(["hash-object", "-w", "--stdin"], { gitDir, input: randomBytes(1024 * 1024) })).stdout.toString().trim()
    const env = { GIT_INDEX_FILE: gitDir + "/heavy-index" }
    const entries = Array.from({ length: 1000 }, (_, i) => "100644 " + blob + "\\tthing/" + i + ".md").join("\\n") + "\\n"
    await git.run(["update-index", "--add", "--index-info"], { gitDir, env, input: entries })
    const tree = (await git.run(["write-tree"], { gitDir, env })).stdout.toString().trim()
    head = (await git.run(["commit-tree", "-p", head, "-m", "Many", tree], { gitDir, env: { ...env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" } })).stdout.toString().trim()
    await git.run(["update-ref", "refs/heads/main", head], { gitDir })
    console.log(head)`
  const id = compose("ps", "--quiet", "git").trim()
  return execFileSync(
    "docker",
    ["exec", id, "/nodejs/bin/node", "--input-type=module", "-e", script],
    { encoding: "utf8" },
  ).trim()
}

/**
 * Inside the running `git` container: a branch off `main` whose tree holds
 * 250,000 paths (one blob, in 250 folders), as an agent's push could.
 * Answers its commit.
 */
function writeWideBranch(workspaceId, parent) {
  const script = `
    const { createGit } = await import("/app/packages/git/dist/index.js")
    const git = createGit({ timeoutMs: 600000 })
    const gitDir = "/var/lib/shinan/catalog/${workspaceId}.git"
    const blob = (await git.run(["hash-object", "-w", "--stdin"], { gitDir, input: "wide\\n" })).stdout.toString().trim()
    const env = { GIT_INDEX_FILE: gitDir + "/wide-index" }
    const lines = []
    for (let i = 0; i < 250000; i++) lines.push("100644 " + blob + "\\tf" + (i % 250) + "/p" + i + ".md")
    await git.run(["update-index", "--add", "--index-info"], { gitDir, env, input: lines.join("\\n") + "\\n" })
    const tree = (await git.run(["write-tree"], { gitDir, env })).stdout.toString().trim()
    const ident = { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" }
    const commit = (await git.run(["commit-tree", "-p", "${parent}", "-m", "Wide", tree], { gitDir, env: ident })).stdout.toString().trim()
    await git.run(["update-ref", "refs/heads/wide", commit], { gitDir })
    console.log(commit)`
  const id = compose("ps", "--quiet", "git").trim()
  return execFileSync(
    "docker",
    ["exec", id, "/nodejs/bin/node", "--input-type=module", "-e", script],
    { encoding: "utf8" },
  ).trim()
}

/**
 * Inside the running `git` container: a branch off `main` whose 50,001
 * files each have a path of about 4,040 characters (under 16 folders of 251
 * characters), near Git's own 4 KiB limit for a path. Built tree by tree,
 * so it is small to write. Answers its commit.
 */
function writeLongPathBranch(workspaceId, parent) {
  const script = `
    const { createGit } = await import("/app/packages/git/dist/index.js")
    const git = createGit({ timeoutMs: 600000 })
    const gitDir = "/var/lib/shinan/catalog/${workspaceId}.git"
    const text = async (args, input, env) => (await git.run(args, { gitDir, input, env })).stdout.toString().trim()
    const blob = await text(["hash-object", "-w", "--stdin"], "long\\n")
    const leaf = []
    for (let i = 0; i <= 50000; i++) leaf.push("100644 blob " + blob + "\\tf" + String(i).padStart(5, "0") + ".md")
    let tree = await text(["mktree"], leaf.join("\\n") + "\\n")
    for (let level = 0; level < 16; level++) {
      const name = "x".repeat(250) + String.fromCharCode(97 + level)
      tree = await text(["mktree"], "040000 tree " + tree + "\\t" + name + "\\n")
    }
    const ident = { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" }
    const commit = await text(["commit-tree", "-p", "${parent}", "-m", "Long paths", tree], undefined, ident)
    await git.run(["update-ref", "refs/heads/long", commit], { gitDir })
    console.log(commit)`
  const id = compose("ps", "--quiet", "git").trim()
  return execFileSync(
    "docker",
    ["exec", id, "/nodejs/bin/node", "--input-type=module", "-e", script],
    { encoding: "utf8" },
  ).trim()
}

/**
 * Inside the running `git` container: two commits on a branch off `main`
 * whose root trees each hold 500,000 entries (one blob, base-36 names,
 * about 16 MB per tree object, every name different between the two).
 * Answers both commits.
 */
function writeWideTrees(workspaceId, parent) {
  const script = `
    const { createGit } = await import("/app/packages/git/dist/index.js")
    const git = createGit({ timeoutMs: 600000 })
    const gitDir = "/var/lib/shinan/catalog/${workspaceId}.git"
    const text = async (args, input, env) => (await git.run(args, { gitDir, input, env })).stdout.toString().trim()
    const blob = await text(["hash-object", "-w", "--stdin"], "wide\\n")
    const ident = { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" }
    const commits = []
    let head = "${parent}"
    for (const prefix of ["a", "b"]) {
      const lines = []
      for (let i = 0; i < 500000; i++) lines.push("100644 blob " + blob + "\\t" + prefix + i.toString(36))
      const tree = await text(["mktree"], lines.join("\\n") + "\\n")
      head = await text(["commit-tree", "-p", head, "-m", "Wide " + prefix, tree], undefined, ident)
      commits.push(head)
    }
    await git.run(["update-ref", "refs/heads/wide-trees", head], { gitDir })
    console.log(commits.join(" "))`
  const id = compose("ps", "--quiet", "git").trim()
  return execFileSync(
    "docker",
    ["exec", id, "/nodejs/bin/node", "--input-type=module", "-e", script],
    { encoding: "utf8" },
  )
    .trim()
    .split(" ")
}

/**
 * Many requests to the Git container at once, from one container on its
 * network. Each reader waits `waitMs` after its answer starts before
 * reading it, as a slow client would. Answers a summary of each.
 */
function askGitCrowd(requests, waitMs = 0) {
  const script = `
    const requests = JSON.parse(process.env.REQUESTS)
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    Promise.all(requests.map(async ({ path, documents: count }) => {
      const body = count ? { paths: Array.from({ length: count }, (_, i) => "thing/" + i + ".md") } : undefined
      try {
        const r = await fetch("http://git:3000" + path, {
          method: body ? "POST" : "GET",
          headers: { authorization: "Bearer " + process.env.TOKEN, "content-type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(300000),
        })
        await sleep(Number(process.env.WAIT))
        const b = await r.json()
        const list = b.entries ?? b.changes ?? []
        const commits = b.commits?.length
        const documents = b.documents ?? []
        return {
          status: r.status,
          entries: list.length,
          truncated: b.truncated,
          commits,
          bytes: documents.reduce((n, d) => n + (d.content ? Buffer.from(d.content, "base64").length : 0), 0),
        }
      } catch (e) {
        return { error: e.cause?.code ?? e.name }
      }
    })).then((all) => console.log(JSON.stringify(all)))`
  return JSON.parse(
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        `${project}_git`,
        "--env",
        `TOKEN=${gitServiceToken}`,
        "--env",
        `WAIT=${waitMs}`,
        "--env",
        `REQUESTS=${JSON.stringify(requests)}`,
        "--entrypoint",
        "/nodejs/bin/node",
        image,
        "-e",
        script,
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    ),
  )
}

/** The `git` container's highest memory use so far, from its cgroup. */
function gitMemoryPeak() {
  const id = compose("ps", "--quiet", "git").trim()
  try {
    const bytes = Number(
      execFileSync(
        "docker",
        [
          "exec",
          id,
          "/nodejs/bin/node",
          "-e",
          'process.stdout.write(require("fs").readFileSync("/sys/fs/cgroup/memory.peak", "utf8"))',
        ],
        { encoding: "utf8" },
      ),
    )
    return `${Math.round(bytes / 1024 / 1024)} MiB`
  } catch {
    return "unknown"
  }
}

function psql(query) {
  return compose(
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "shinan",
    "-d",
    "shinan",
    "-Atc",
    query,
  ).trim()
}

async function run() {
  const files = writableAppFiles()
  check(
    files.unreadable.length === 0,
    "the image's user can list every directory and read every file under /app and of Git" +
      (files.unreadable.length
        ? ` (not: ${files.unreadable.slice(0, 5).join(", ")})`
        : ""),
  )
  check(
    files.uid === 65532 && files.checked > 1000 && files.writable.length === 0,
    `the image's ${files.checked} files and directories under /app and of Git are not writable by its user` +
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

  check(
    files.libraries.length > 0 && files.notRunnable.length === 0,
    "git, git http-backend and the hook are there and the image's user can run them" +
      (files.notRunnable.length
        ? ` (not: ${files.notRunnable.join(", ")})`
        : ""),
  )
  check(
    files.shells.length === 0,
    "the image has no shell and no interpreter but Node.js" +
      (files.shells.length ? ` (found: ${files.shells.join(", ")})` : ""),
  )

  check(
    files.catalog === "65532:65532 700 0",
    `the git role's volume folder is empty and the image's user's alone (${files.catalog})`,
  )

  const git = gitInImage()
  check(
    git.binary === "/usr/bin/git" &&
      /^git version 2\./.test(git.version) &&
      /^1:2\.[0-9.]+-/.test(git.debianVersion ?? ""),
    `@shinan/git runs the image's Git (${git.version}, Debian ${git.debianVersion})`,
  )
  check(
    git.tree.join(",") === "100644 README.md,100644 machine/musashi.md" &&
      git.diff.join(",") === "added machine/musashi.md" &&
      git.history.join(",") === "Second,First" &&
      git.newCommits.join(",") === "true" &&
      git.catFile === "musashi\n",
    "it lists a tree, diffs two trees, lists new commits and a history, and reads objects",
  )
  check(
    git.hook.exitCode === 1 &&
      git.hook.stderr ===
        "Shinan: this push could not be checked. Nothing was changed. Try again; tell your person if it happens again.",
    "Git starts the Node.js hook without a shell, and it refuses a push it cannot have checked",
  )
  check(
    git.advertisement.contentType ===
      "application/x-git-upload-pack-advertisement" &&
      git.advertisement.service &&
      git.advertisement.main &&
      git.fetch.nak &&
      git.fetch.pack,
    "git http-backend advertises refs and answers a fetch with a pack",
  )
  check(
    git.push.unpacked &&
      git.push.declined &&
      git.push.hookMessage &&
      git.push.mainUnchanged &&
      git.push.objectsDropped,
    "git http-backend takes a push to the hook, which refuses it: main is unchanged and the pushed objects are gone",
  )
  check(
    git.rewrite.firstKept &&
      git.rewrite.secondNew &&
      git.rewrite.objects > 0 &&
      !git.rewrite.holds,
    "a purge's history rewrite runs: fast-export into fast-import, repack and prune, with nothing of the old file left",
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

  await waitFor(
    "git to be healthy",
    () => inspect("git", "{{.State.Health.Status}}") === "healthy",
  )
  check(
    true,
    "git is healthy (its internal /readyz answers inside the container): its start checks passed",
  )

  for (const service of ["web", "worker", "migrate", "git"]) {
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
  check(publishedPorts("git").length === 0, "git publishes no port")
  const gitNetworks = Object.keys(
    JSON.parse(inspect("git", "{{json .NetworkSettings.Networks}}")),
  )
  const gitNetworkInternal = execFileSync(
    "docker",
    ["network", "inspect", "--format", "{{.Internal}}", `${project}_git`],
    { encoding: "utf8" },
  ).trim()
  check(
    gitNetworks.join(" ") === `${project}_git` && gitNetworkInternal === "true",
    "git is only on the internal git network",
  )
  check(
    inspect("git", "{{range .Config.Env}}{{println .}}{{end}}")
      .split("\n")
      .filter((v) => /DATABASE|SESSION|SES_|GITHUB/.test(v)).length === 0,
    "git has no database address and no secret but its service token",
  )
  check(
    askGit("git", "/journal").status === 401 &&
      askGit("git", "/journal", "x".repeat(43)).status === 401 &&
      askGit("git", "/journal", gitServiceToken).status === 200,
    "on its network, git answers 401 without the service token or with a wrong one, and 200 with it",
  )
  const outside = askGit("egress", "/journal", gitServiceToken)
  check(
    outside.error !== undefined,
    `from outside its network, git cannot be reached (${outside.error})`,
  )

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
  const skills = await request("/skills/index.json")
  const skill = (await skills.json()).skills?.[0]
  check(
    skills.status === 200 &&
      skill?.name === "shinan" &&
      (await request(`/skills/shinan/${skill.files[0]}`)).status === 200,
    "the skill is served at /skills/",
  )

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
  const { id: workspaceId } = await workspace.json()
  const firstCommit = await waitFor("the workspace's repository", () => {
    const commit = psql(
      `select first_commit from catalog_repositories where workspace_id = '${workspaceId}' and first_commit is not null`,
    )
    return commit || null
  })
  const repository = askGit(
    "git",
    `/repositories/${workspaceId}/tree?commit=main`,
    gitServiceToken,
  )
  check(
    repository.status === 200 &&
      repository.body.commit === firstCommit &&
      repository.body.entries.map((e) => e.path).join(",") === "README.md",
    "the worker had git create the workspace's repository, with a first commit holding README.md",
  )

  // Agents clone, fetch and push over HTTPS, through Caddy and `web` to
  // the Git container (GC-2), with tokens made in the web app.
  let fullAgentHandle = null
  const issue = async (machine, access) => {
    const response = await request(`/api/workspaces/${workspaceId}/agents`, {
      body: { codingTool: "opencode", machine, access },
    })
    if (response.status !== 201) return null
    const issued = await response.json()
    if (access === "full") fullAgentHandle = issued.agent.handle
    return issued.token
  }
  const fullToken = await issue("first-start", "full")
  const readOnlyToken = await issue("first-start-ro", "read-only")
  check(
    fullToken !== null && readOnlyToken !== null,
    "the operator makes a full and a read-only agent token",
  )
  const cloneUrl = `${installationUrl}/git/${workspaceId}.git`
  const clones = [0, 2].map((version) => {
    const folder = join(dir, `clone-v${version}`)
    const cloned = agentGit(
      [
        "-c",
        `protocol.version=${version}`,
        "clone",
        "--quiet",
        cloneUrl,
        folder,
      ],
      { token: fullToken },
    )
    const head = agentGit(["rev-parse", "HEAD"], { cwd: folder }).stdout?.trim()
    const fetched = agentGit(
      ["-c", `protocol.version=${version}`, "fetch", "--quiet"],
      { cwd: folder },
    )
    return { cloned, head, fetched, folder }
  })
  check(
    clones.every(
      (c) =>
        c.cloned.code === 0 && c.head === firstCommit && c.fetched.code === 0,
    ),
    `an agent clones and fetches its workspace's repository over HTTPS, with protocol v0 and v2 (${JSON.stringify(clones.map((c) => [c.cloned.code, c.cloned.stderr.slice(0, 200), c.fetched.code]))})`,
  )
  writeFileSync(join(clones[1].folder, "note.md"), "A note\n")
  agentGit(["add", "note.md"], { cwd: clones[1].folder })
  agentGit(
    [
      "-c",
      "user.name=Agent",
      "-c",
      "user.email=agent@example.com",
      "commit",
      "--quiet",
      "-m",
      "A note",
    ],
    { cwd: clones[1].folder },
  )
  // Pushes run the image's hooks, which call the git role's checks on
  // loopback (GC-3a): a branch push is accepted and logged; a secret is
  // refused with its place and fingerprint, never its value; `main` opens
  // with its own checks (GC-3b).
  const pushed = agentGit(["push", "origin", "HEAD:refs/heads/a-note"], {
    cwd: clones[1].folder,
  })
  // A page with a fact check naming the agent that pushes it (D-066), on
  // a branch of its own from main, pushed to main.
  agentGit(["checkout", "--quiet", "-b", "page", "origin/main"], {
    cwd: clones[1].folder,
  })
  mkdirSync(join(clones[1].folder, "machine"), { recursive: true })
  writeFileSync(
    join(clones[1].folder, "machine", "first-start.md"),
    `---
id: machine/first-start
type: machine
title: The first-start machine
summary: A page the first-start test pushes.
status: active
owner: unknown
facts:
  - checked: 2026-11-20T09:00:00Z
    by: ${account.person.handle} via ${fullAgentHandle}
    scope: Looked at it
    source: The first-start test
    observed:
      hostname: first-start
---

# The first-start machine
`,
  )
  agentGit(["add", "machine/first-start.md"], { cwd: clones[1].folder })
  agentGit(
    [
      "-c",
      "user.name=Agent",
      "-c",
      "user.email=agent@example.com",
      "commit",
      "--quiet",
      "-m",
      "A page",
    ],
    { cwd: clones[1].folder },
  )
  const toMain = agentGit(["push", "origin", "HEAD:refs/heads/main"], {
    cwd: clones[1].folder,
  })
  const token = `ghp_${"0123456789abcdefghij"}ABCDEFGHIJ012345`
  writeFileSync(join(clones[1].folder, "leak.md"), `token: ${token}\n`)
  agentGit(["add", "leak.md"], { cwd: clones[1].folder })
  agentGit(
    [
      "-c",
      "user.name=Agent",
      "-c",
      "user.email=agent@example.com",
      "commit",
      "--quiet",
      "-m",
      "A leak",
    ],
    { cwd: clones[1].folder },
  )
  const leaked = agentGit(["push", "origin", "HEAD:refs/heads/a-leak"], {
    cwd: clones[1].folder,
  })
  check(
    pushed.code === 0 &&
      toMain.code === 0 &&
      leaked.code !== 0 &&
      /remote: +leak\.md:1 +secret +.*fingerprint sha256:[0-9a-f]{64}/.test(
        leaked.stderr,
      ) &&
      !leaked.stderr.includes(token.slice(4)),
    `the image's hooks have the git role check each push: a branch and a valid page on main accepted (its checks in a worker thread), a secret refused without its value (${[
      pushed,
      toMain,
      leaked,
    ]
      .map(
        (p) =>
          `${p.code}: ${p.stderr
            .trim()
            .split("\n")
            .filter((l) => l.startsWith("remote:"))
            .join(" | ")}`,
      )
      .join(" / ")})`,
  )
  const readOnlyClone = join(dir, "clone-read-only")
  const readOnlyCloned = agentGit(
    ["clone", "--quiet", cloneUrl, readOnlyClone],
    {
      token: readOnlyToken,
    },
  )
  const readOnlyPush = agentGit(["push", "origin", "HEAD:refs/heads/x"], {
    cwd: readOnlyClone,
  })
  check(
    readOnlyCloned.code === 0 &&
      readOnlyPush.code !== 0 &&
      readOnlyPush.stderr.includes(
        "remote: Shinan: this agent's token is read-only, so it can't push.",
      ),
    "a read-only token clones, and its push is refused with 403",
  )
  const anonymous = agentGit(["ls-remote", cloneUrl], { token: null })
  const otherId = "9b9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d"
  const unknown = agentGit(
    ["ls-remote", `${installationUrl}/git/${otherId}.git`],
    { token: fullToken },
  )
  check(
    anonymous.code !== 0 &&
      anonymous.stderr.includes("could not read Username") &&
      unknown.code !== 0 &&
      unknown.stderr.includes(
        "remote: Shinan: no catalog here for this agent's token.",
      ),
    "without a token Git is asked for credentials; an unknown workspace is not found",
  )
  const pushLog = await waitFor("the push log", () => {
    const rows = psql(
      "select outcome || ':' || array_to_string(codes, ',') from catalog_pushes order by journal_entry",
    )
    return rows.split("\n").length >= 3 ? rows : null
  })
  check(
    pushLog === "accepted:\naccepted:\nrefused:secret" &&
      psql(
        "select count(*) from catalog_push_refs where ref = 'refs/heads/a-note' and confirmed",
      ) === "1" &&
      psql(
        "select pusher_kind || ':' || coalesce(ref, '') from catalog_commit_first_pushes order by first_pushed_at",
      ) === "shinan:\nagent:refs/heads/a-note\nagent:refs/heads/main" &&
      psql("select count(*) from events where kind = 'catalog.pushed'") ===
        "1" &&
      psql(
        "select count(*) from security_log where action = 'catalog.push-refused'",
      ) === "1",
    `web stored the push log from the git role's journal: pushes, confirmed refs, first pushers, the refused secret in the security log (${JSON.stringify(pushLog)})`,
  )
  check(
    Number(psql("select sum(fetch_count) from agent_tokens")) === 5,
    "each token's fetches are counted for the security log's hourly summary",
  )

  // A second person, invited to the workspace, with an agent of their own:
  // the agents of one person share a cap of 3 Git processes.
  const member = "member@example.com"
  const memberCookies = new Map()
  const latestMail = (to, subject) =>
    waitFor(`the email "${subject}" to ${to}`, async () => {
      const search = await fetch(
        `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${to} subject:"${subject}"`)}`,
      )
      const { messages } = await search.json()
      if (!messages?.length) return null
      const full = await fetch(`${mailpitUrl}/api/v1/message/${messages[0].ID}`)
      return (await full.json()).Text
    })
  const allowed = await request("/api/installation/allowlist", {
    body: { email: member },
  })
  const invited = await request(`/api/workspaces/${workspaceId}/invitations`, {
    body: { email: member, role: "contributor" },
  })
  const invitationText = await latestMail(member, "invit")
  await request("/api/auth/sign-in/magic-link", {
    body: { email: member, callbackURL: "/" },
    cookies: memberCookies,
  })
  const memberLink = new URL(
    (await latestMail(member, "Sign in")).match(/https:\/\/\S+/)[0],
  )
  const memberFragment = new URLSearchParams(memberLink.hash.slice(1))
  await request("/api/sign-in/link", {
    body: {
      token: memberFragment.get("token"),
      next: memberFragment.get("next"),
    },
    cookies: memberCookies,
  })
  const accepted = await request("/api/invitations/accept", {
    body: { token: /\/invitation#(\S+)/.exec(invitationText)?.[1] },
    cookies: memberCookies,
  })
  const memberAgent = await request(`/api/workspaces/${workspaceId}/agents`, {
    body: { codingTool: "opencode", machine: "member", access: "full" },
    cookies: memberCookies,
  })
  check(
    allowed.status === 204 &&
      invited.status === 201 &&
      accepted.status === 200 &&
      memberAgent.status === 201,
    `the operator invites a second person, who signs in, accepts and makes an agent token (${[allowed.status, invited.status, accepted.status, memberAgent.status]})`,
  )
  const memberToken = (await memberAgent.json()).token

  // A "zip bomb": one commit holding a 450 MiB file of zeros, which packs
  // to under 0.5 MiB. Four pushes of it at once, by three agents of two
  // people (the most four Git processes the caps allow): Git streams
  // objects past core.bigFileThreshold to disk instead of inflating them in
  // memory, so `git` stays up (review of GC-2).
  const secondToken = await issue("first-start-b", "full")
  const bomb = clones[0].folder
  // Sparse: no disk is used for the zeros.
  writeFileSync(join(bomb, "zeros.bin"), "")
  truncateSync(join(bomb, "zeros.bin"), 450 * 1024 * 1024)
  agentGit(["-c", "core.bigFileThreshold=1m", "add", "zeros.bin"], {
    cwd: bomb,
  })
  agentGit(
    [
      "-c",
      "user.name=Agent",
      "-c",
      "user.email=agent@example.com",
      "commit",
      "--quiet",
      "-m",
      "Zeros",
    ],
    { cwd: bomb },
  )
  rmSync(join(bomb, "zeros.bin"))
  const gitBefore = inspect("git", "{{.RestartCount}}")
  const bombs = await Promise.all(
    [fullToken, secondToken, memberToken, memberToken].map((token, i) =>
      agentGitAsync(["push", "origin", `HEAD:refs/heads/zeros-${i}`], {
        cwd: bomb,
        home: join(dir, `bomb-home-${i}`),
        token,
      }),
    ),
  )
  check(
    bombs.every(
      (p) =>
        p.code !== 0 &&
        p.stderr.includes("remote: Shinan") &&
        !/signal 9|died of signal|unpack-objects abnormal/.test(p.stderr),
    ) &&
      inspect("git", "{{.RestartCount}} {{.State.OOMKilled}}") ===
        `${gitBefore} false`,
    `4 pushes at once of a 450 MiB file of zeros (a pack of under 0.5 MiB) are refused by Shinan, and git stays up (peak ${gitMemoryPeak()}; ${JSON.stringify(bombs.map((p) => p.stderr.split("\n").filter((l) => l.startsWith("remote:"))[0] ?? p.stderr.slice(0, 120)))})`,
  )

  const addresses = psql(
    "select distinct host(network_address) from security_log where action = 'sign-in.succeeded'",
  ).split("\n")
  check(
    addresses.length === 1 &&
      addresses[0] !== "" &&
      addresses[0] !== proxyAddress,
    `the security log has the visitor's address (${addresses[0]}), not the proxy's`,
  )

  // The read API's limits keep one request inside the Git container's
  // memory limit (1,024 MiB here), however a repository's commits are made.
  const heavyId = "0f9c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d"
  check(
    askGit("git", `/repositories/${heavyId}`, gitServiceToken).status === 404,
    "a second repository does not exist yet",
  )
  const made = execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      `${project}_git`,
      "--entrypoint",
      "/nodejs/bin/node",
      image,
      "-e",
      `fetch("http://git:3000/repositories/${heavyId}", { method: "PUT", headers: { authorization: "Bearer ${gitServiceToken}", "content-type": "application/json" }, body: JSON.stringify({ message: "Start\\n", files: [{ path: "README.md", content: "Iw==" }] }) }).then((r) => console.log(r.status))`,
    ],
    { encoding: "utf8" },
  ).trim()
  const heavyMain = writeHeavyRepository(heavyId)
  const restartsBefore = inspect("git", "{{.RestartCount}}")
  const documents = askGitSummary(`/repositories/${heavyId}/documents`, {
    paths: Array.from({ length: 1000 }, (_, i) => `thing/${i}.md`),
  })
  check(
    made === "201" &&
      documents.status === 200 &&
      documents.read === 32 &&
      documents.bytes === 32 * 1024 * 1024 &&
      documents.deferred === 968,
    `a read of 1,000 documents of 1 MiB returns 32 MiB and defers the rest (${JSON.stringify(documents)})`,
  )
  const history = askGitSummary(`/repositories/${heavyId}/history?limit=100`)
  check(
    history.status === 200 &&
      history.commits === 72 &&
      history.truncated === 70 &&
      history.longest <= 256 * 1024 &&
      history.changesTruncated === 1 &&
      history.mostChanges === 50 &&
      history.mostChanged === 1001,
    `a page of 70 commits with 15 MiB messages returns them truncated to 256 KiB, and a commit's 1,001 changed paths as 50 (${JSON.stringify(history)})`,
  )
  // Many reads at once, of a branch with 250,000 paths (tiny on disk), and
  // of documents whose readers take their time: the reads take turns and
  // each holds its place until its answer is sent.
  const wide = writeWideBranch(heavyId, heavyMain)
  const crowd = askGitCrowd([
    ...Array.from({ length: 6 }, () => ({
      path: `/repositories/${heavyId}/tree?commit=${wide}`,
    })),
    ...Array.from({ length: 6 }, () => ({
      path: `/repositories/${heavyId}/diff?from=${heavyMain}&to=${wide}`,
    })),
  ])
  check(
    crowd.every(
      (r) => r.status === 200 && r.entries === 50_000 && r.truncated === true,
    ),
    `6 tree and 6 diff reads at once of 250,000 paths each return 50,000, truncated (${JSON.stringify(crowd.slice(0, 2))})`,
  )
  // Paths near Git's 4 KiB limit: the answers stop at 8 MiB of paths, not
  // at 50,000 entries (which would be about 200 MiB each).
  const long = writeLongPathBranch(heavyId, heavyMain)
  const longCrowd = askGitCrowd([
    ...Array.from({ length: 4 }, () => ({
      path: `/repositories/${heavyId}/tree?commit=${long}`,
    })),
    ...Array.from({ length: 4 }, () => ({
      path: `/repositories/${heavyId}/diff?from=${heavyMain}&to=${long}`,
    })),
  ])
  check(
    longCrowd.every(
      (r) =>
        r.status === 200 &&
        r.truncated === true &&
        // 8 MiB is about 2,075 such paths; the diffs also hold the 1,000
        // short deletions of main's files, which sort first.
        r.entries > 2000 &&
        r.entries < 3200,
    ),
    `4 tree and 4 diff reads at once of 50,001 paths of 4,040 characters stop at 8 MiB of paths, truncated (${JSON.stringify(longCrowd.map((r) => r.entries))})`,
  )
  // Two tree objects of 500,000 entries each, every entry different: the
  // walk reads entries from each object's bytes as it goes, so four diffs
  // and four history pages at once fit.
  const [wideA, wideB] = writeWideTrees(heavyId, heavyMain)
  const wideCrowd = askGitCrowd([
    ...Array.from({ length: 4 }, () => ({
      path: `/repositories/${heavyId}/diff?from=${wideA}&to=${wideB}`,
    })),
    ...Array.from({ length: 4 }, () => ({
      path: `/repositories/${heavyId}/history?commit=${wideB}&limit=2`,
    })),
  ])
  check(
    wideCrowd.every((r) => r.status === 200) &&
      wideCrowd
        .slice(0, 4)
        .every((r) => r.entries === 50_000 && r.truncated === true) &&
      wideCrowd.slice(4).every((r) => r.commits === 2),
    `4 diffs and 4 history pages at once of two trees of 500,000 entries each answer (${JSON.stringify(wideCrowd.map((r) => [r.status, r.entries, r.commits]))})`,
  )
  const slow = askGitCrowd(
    Array.from({ length: 40 }, () => ({
      path: `/repositories/${heavyId}/documents`,
      documents: 1000,
    })),
    3000,
  )
  check(
    slow.length === 40 &&
      slow.every((r) => r.status === 200 && r.bytes === 32 * 1024 * 1024),
    `40 document reads at once whose readers wait 3 s before reading each get 32 MiB (${JSON.stringify(slow.slice(0, 2))})`,
  )
  check(
    inspect(
      "git",
      "{{.RestartCount}} {{.State.OOMKilled}} {{.State.Status}}",
    ) === `${restartsBefore} false running`,
    `git stayed up within its memory limit through all these reads (peak ${gitMemoryPeak()})`,
  )

  compose("restart", "git")
  await sleep(2000)
  await waitFor(
    "git to be healthy again",
    () => inspect("git", "{{.State.Health.Status}}") === "healthy",
  )
  const kept = askGit("git", `/repositories/${workspaceId}`, gitServiceToken)
  check(
    kept.status === 200 &&
      kept.body.main ===
        psql(
          "select new_commit from catalog_push_refs where ref = 'refs/heads/main' and confirmed",
        ),
    "after a restart, git still has the repository on its volume, at the main an agent pushed",
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

  // The journal drains: the entry about the heavy repository, which has no
  // workspace in PostgreSQL, is set aside rather than holding back the
  // entries after it, such as this refused push's (review of GC-3a).
  const pushesBefore = Number(psql("select count(*) from catalog_pushes"))
  const late = agentGit(["push", "origin", "HEAD:refs/heads/after-heavy"], {
    cwd: clones[1].folder,
  })
  const drained = await waitFor(
    "the worker to store the whole Git journal",
    () => {
      const journal = askGit("git", "/journal?after=0", gitServiceToken)
      return journal.status === 200 && journal.body.entries.length === 0
        ? journal
        : null
    },
    150,
  )
  check(
    late.code !== 0 &&
      drained.body.entries.length === 0 &&
      Number(psql("select count(*) from catalog_pushes")) ===
        pushesBefore + 1 &&
      psql(
        `select details->>'reason' from security_log where action = 'catalog.journal-set-aside' and details->>'workspaceId' = '${heavyId}'`,
      ) === "workspace-unknown",
    "the Git journal drains: an entry for a workspace PostgreSQL does not have is set aside once, and later pushes are stored",
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
