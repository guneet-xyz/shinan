#!/usr/bin/env node
// The upgrade from Shinan v0.3.0 to this release, end to end (Git-based
// catalog plan §4, GC-6): the reference Compose file started on the
// database v0.3.0 leaves (deploy/test/v0.3.0-dataset.sql, made by
// v0.3.0-dataset.mjs), as an operator's upgrade does. It checks that
// `migrate` moves every workspace's catalog into its Git repository byte
// for byte, in one first commit by Shinan, reports the proposals left
// waiting without applying them, drops M2's tables only then, and changes
// nothing when it runs again; that the worker indexes the moved catalogs
// and records their first commits as first pushed by shinan; and that the
// v0.3.0 agent's token, its scopes renamed, pushes a change to a moved page
// whose fact checks it leaves as they are.
//
//   docker build -f deploy/Dockerfile -t shinan:local .
//   SHINAN_IMAGE=shinan:local node deploy/test/upgrade.mjs [--keep]
//
// Needs Docker with Compose 2.23.1 or later. Ports on 127.0.0.1: 18444
// (HTTPS: the dataset's tokens were issued for https://localhost:18444),
// TEST_MAILPIT_PORT (18026) and SHINAN_PORT (13001). Everything it creates
// is removed at the end unless --keep is given.
import { execFileSync, spawn, spawnSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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

const httpsPort = "18444"
const mailpitPort = process.env.TEST_MAILPIT_PORT ?? "18026"
const installationUrl = `https://localhost:${httpsPort}`
const proxyAddress = "10.247.248.10"

// Caddy's certificate is self-signed; only this test process skips the check.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
process.removeAllListeners("warning")

const project = `shinan-upgrade-${randomBytes(3).toString("hex")}`
const dir = mkdtempSync(join(tmpdir(), "shinan-upgrade-"))
const deploy = fileURLToPath(new URL("..", import.meta.url))
const dataset = join(deploy, "test", "v0.3.0-dataset.sql")

function writeSecret(name, value) {
  writeFileSync(join(dir, "secrets", name), value, { mode: 0o644 })
}

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
    // The dataset's owner: an operator, so their agent's token is let in.
    "SHINAN_OPERATORS=guneet@example.com",
    `SHINAN_TRUSTED_PROXIES=${proxyAddress}`,
    `SHINAN_PORT=${process.env.SHINAN_PORT ?? "13001"}`,
    "EMAIL_FROM=shinan@example.com",
    "SES_REGION=us-east-1",
    `TEST_HTTPS_PORT=${httpsPort}`,
    `TEST_MAILPIT_PORT=${mailpitPort}`,
    "TEST_PROXY_SUBNET=10.247.248.0/24",
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
    maxBuffer: 64 * 1024 * 1024,
  })
}

function inspect(service, format) {
  const id = compose("ps", "--all", "--quiet", service).trim()
  return execFileSync("docker", ["inspect", "--format", format, id], {
    encoding: "utf8",
  }).trim()
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(what, check, seconds = 180) {
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

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")

/**
 * The repository of a workspace as the Git container serves it, read from
 * its network with the service token: `main`'s commit, its history, and
 * the SHA-256 of every file, so nothing large passes through the output.
 */
function repository(workspaceId) {
  const script = `
    const { createHash } = await import("node:crypto")
    const ask = async (path, body) => {
      const r = await fetch("http://git:3000/repositories/" + process.env.WORKSPACE + path, {
        method: body ? "POST" : "GET",
        headers: { authorization: "Bearer " + process.env.TOKEN, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      })
      return r.json()
    }
    const { main } = await ask("")
    const { commits } = await ask("/history?commit=" + main + "&limit=5")
    const { entries } = await ask("/tree?commit=" + main)
    const files = {}
    let left = entries.filter((e) => e.type === "blob").map((e) => e.path)
    while (left.length > 0) {
      const { documents } = await ask("/documents", { commit: main, paths: left })
      left = []
      for (const d of documents) {
        if (d.deferred) left.push(d.path)
        else if (d.content) files[d.path] = createHash("sha256").update(Buffer.from(d.content, "base64")).digest("hex")
      }
    }
    console.log(JSON.stringify({
      main,
      commits: commits.map((c) => ({ author: c.author.name, committer: c.committer.name, parents: c.parents.length, message: c.message })),
      files,
    }))`
  return JSON.parse(
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        `${project}_git`,
        "--env",
        `WORKSPACE=${workspaceId}`,
        "--env",
        `TOKEN=${gitServiceToken}`,
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

/** The `git` client as an agent runs it, with the skill's credential helper. */
const agentHome = join(dir, "agent-home")
function agentGit(args, { cwd = dir, token } = {}) {
  mkdirSync(join(agentHome, ".config", "shinan"), { recursive: true })
  if (token)
    writeFileSync(join(agentHome, ".config", "shinan", "token"), token, {
      mode: 0o600,
    })
  const result = spawnSync(
    "git",
    [
      "-c",
      "http.sslVerify=false",
      "-c",
      `credential.${installationUrl}.helper=`,
      "-c",
      `credential.${installationUrl}.helper=!f(){ test "$1" = get && printf "username=agent\\npassword=%s\\n" "$(cat ~/.config/shinan/token)"; }; f`,
      "-c",
      "user.name=Agent",
      "-c",
      "user.email=agent@example.com",
      ...args,
    ],
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

const m2Tables = [
  "catalog_documents",
  "catalog_revisions",
  "catalog_revision_documents",
  "catalog_proposals",
  "catalog_proposal_comments",
  "catalog_page_visits",
]

/** PostgreSQL alone, with the database as v0.3.0 left it, restored as from the pre-upgrade dump. */
function restore() {
  compose("up", "--detach", "--quiet-pull", "--wait", "postgres")
  execFileSync(
    "docker",
    [
      ...composeArgs,
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "shinan",
      "-d",
      "shinan",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: readFileSync(dataset), stdio: ["pipe", "ignore", "pipe"] },
  )
}

async function run() {
  console.info(`Starting ${project} in ${dir}`)

  // First, an upgrade during which 0.3's catalog is still written to, as
  // by 0.3's web left running: a session holds a lock the drop needs
  // (the first table 0020 locks), so the drop cannot run before a late
  // revision is written to Trial's catalog, right after the moves are
  // recorded; then the lock is let go. The drop must refuse, and nothing may
  // be lost.
  restore()
  const holder = spawn(
    "docker",
    [
      ...composeArgs,
      "exec",
      "-T",
      "postgres",
      "psql",
      "postgres://shinan@/shinan?application_name=upgrade_test_lock",
    ],
    { stdio: ["pipe", "ignore", "ignore"] },
  )
  holder.stdin.write(
    "begin; lock table catalog_page_visits in access share mode; select pg_sleep(600);\n",
  )
  await waitFor("the test's lock", () =>
    psql(
      "select count(*) from pg_locks l join pg_stat_activity a on a.pid = l.pid where a.application_name = 'upgrade_test_lock' and l.relation = 'catalog_page_visits'::regclass and l.granted",
    ) === "1"
      ? true
      : null,
  )
  const late = spawn(
    "docker",
    [...composeArgs, "up", "--detach", "--quiet-pull"],
    {
      stdio: "ignore",
    },
  )
  const lateDone = new Promise((resolve) => late.on("close", resolve))
  // The drop cannot get past the held lock: once the moves are recorded,
  // the late write lands before it can check, well within its 15 seconds
  // of waiting.
  await waitFor("the moves to be recorded", () =>
    psql("select to_regclass('public.catalog_moves') is not null") === "t" &&
    psql("select count(*) from catalog_moves") === "3"
      ? true
      : null,
  )
  psql(`insert into catalog_revisions
    select (jsonb_populate_record(null::catalog_revisions, to_jsonb(r) || jsonb_build_object('number', r.number + 1))).*
    from catalog_revisions r join workspaces w on w.id = r.workspace_id
    where w.name = 'Trial' order by r.number desc limit 1`)
  psql(
    "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'upgrade_test_lock'",
  )
  holder.kill()
  await lateDone
  await waitFor("migrate to stop", () =>
    inspect("migrate", "{{.State.Status}}") === "exited" ? true : null,
  )
  const refusal = compose("logs", "--no-color", "migrate")
  check(
    inspect("migrate", "{{.State.ExitCode}}") === "1" &&
      // The guard's refusal; or, on a slow runner where the late write took
      // longer than the drop's 15 seconds of waiting, its lock's time-out:
      // as safe, M2's tables kept either way.
      (refusal.includes(
        "M2's catalog tables are kept: a workspace's catalog was not moved into Git, or changed after it was moved",
      ) ||
        refusal.includes(
          "M2's catalog tables are kept: the drop waited 15 seconds for them",
        )) &&
      inspect("web", "{{.State.Status}}") !== "running",
    "with the catalog written to after its move, the drop refuses: migrate exits 1 and web does not start",
  )
  check(
    m2Tables.every((t) => psql(`select to_regclass('public.${t}')`) !== "") &&
      psql(
        "select max(number) from catalog_revisions r join workspaces w on w.id = r.workspace_id where w.name = 'Trial'",
      ) === "19",
    "M2's tables are kept, with the late revision in them",
  )
  spawnSync("docker", [...composeArgs, "down", "--volumes"], {
    stdio: "ignore",
  })

  // Now the upgrade as the operator guide describes it.
  restore()
  const before = JSON.parse(
    psql(`select json_agg(json_build_object(
      'name', w.name, 'id', w.id,
      'texts', (select coalesce(json_agg(rd.text), '[]') from catalog_documents d
        join catalog_revision_documents rd on rd.document_id = d.id and rd.revision = d.current_revision
        where d.workspace_id = w.id),
      'revision', (select coalesce(max(number), 0) from catalog_revisions r where r.workspace_id = w.id)
    ) order by w.created_at) from workspaces w`),
  )
  check(
    before.map((w) => `${w.name}:${w.texts.length}:${w.revision}`).join(" ") ===
      "Trial:17:18 Shapes:6:7 Empty:0:0",
    `the v0.3.0 database holds three workspaces' catalogs (${before.map((w) => `${w.name} ${w.texts.length} documents at revision ${w.revision}`).join(", ")}), two proposals waiting`,
  )

  compose("up", "--detach", "--quiet-pull")
  await waitFor(
    "web to be healthy",
    () => inspect("web", "{{.State.Health.Status}}") === "healthy",
  )
  check(
    inspect("migrate", "{{.State.Status}} {{.State.ExitCode}}") === "exited 0",
    "migrate ran after git was healthy and exited 0",
  )
  const log = compose("logs", "--no-color", "migrate")
  const [trial, shapes, empty] = before
  check(
    log.includes(
      `Workspace "Trial" (${trial.id}): moved 17 catalog documents at revision 18 into Git, verified file by file`,
    ) &&
      log.includes(
        `Workspace "Shapes" (${shapes.id}): moved 6 catalog documents at revision 7 into Git, verified file by file`,
      ) &&
      log.includes(
        `Workspace "Empty" (${empty.id}): no catalog documents; its repository starts with README.md`,
      ),
    "migrate reports each workspace's catalog moved and verified",
  )
  check(
    log.includes(
      `Workspace "Trial" (${trial.id}): catalog proposal #19 was waiting for approval and is not applied (it touched service/container-registry); redo it by pushing`,
    ) &&
      log.includes(
        `Workspace "Trial" (${trial.id}): catalog proposal #20 was waiting for approval and is not applied (it touched start-here); redo it by pushing`,
      ) &&
      /the moved catalog reads with \d+ problems?, kept as they were: .*start-here-invalid \(blocking\) in start-here/.test(
        log,
      ),
    "it reports the waiting proposals by number and the IDs they touched, and the start-here document's old list as a problem",
  )
  check(
    !/blue mat|purged\)|Renouvel|203\.0\.113/.test(log),
    "the report holds no catalog text",
  )

  for (const workspace of before) {
    const repo = repository(workspace.id)
    const expected = Object.fromEntries(
      workspace.texts.map((text) => [
        `${/^id: (.+)$/m.exec(text)[1]}.md`,
        sha256(Buffer.from(text, "utf8")),
      ]),
    )
    const paths = Object.keys(repo.files).filter((p) => p !== "README.md")
    check(
      paths.length === workspace.texts.length &&
        paths.every((p) => repo.files[p] === expected[p]) &&
        "README.md" in repo.files,
      `${workspace.name}: the first commit holds every document byte for byte at its ID plus .md (${paths.length}), and README.md`,
    )
    check(
      repo.commits.length === 1 &&
        repo.commits[0].author === "Shinan" &&
        repo.commits[0].committer === "Shinan" &&
        repo.commits[0].parents === 0 &&
        repo.commits[0].message ===
          (workspace.texts.length === 0
            ? "Start the catalog\n"
            : `Bring the catalog over from Shinan 0.3 (revision ${workspace.revision})\n`),
      `${workspace.name}: in one first commit by Shinan (${JSON.stringify(repo.commits[0].message)})`,
    )
    workspace.main = repo.main
  }
  const trialFiles = repository(trial.id).files
  check(
    !("start-here.md" in trialFiles) &&
      !("service/container-registry.md" in trialFiles),
    "the waiting proposals were not applied (GD-12)",
  )
  check(
    m2Tables.every((t) => psql(`select to_regclass('public.${t}')`) === "") &&
      psql(
        "select count(*) from information_schema.columns where table_name = 'workspaces' and column_name = 'catalog_strict'",
      ) === "0",
    "M2's tables and the strict setting are gone",
  )
  check(
    psql(
      "select string_agg(documents || '@' || revision, ' ' order by documents desc) from catalog_moves",
    ) === "17@18 6@7 0@0",
    "each workspace's verified move is recorded",
  )

  // The worker indexes the moved catalogs, and stores the Git container's
  // record of their first commits, first pushed by shinan.
  await waitFor(
    "the worker to index the moved catalogs",
    () =>
      psql(
        `select count(*) from catalog_index_documents where workspace_id = '${trial.id}'`,
      ) === "17",
  )
  check(true, "the worker built the agent index of the moved catalog from main")
  await waitFor(
    "the first commits' first pushes",
    () =>
      psql(
        "select count(*) from catalog_commit_first_pushes where by_label = 'shinan'",
      ) === "3",
  )
  check(
    psql(
      "select string_agg(commit, ' ' order by commit) from catalog_commit_first_pushes where by_label = 'shinan'",
    ) ===
      before
        .map((w) => w.main)
        .sort()
        .join(" "),
    "the push log records each first commit as first pushed by shinan",
  )

  // migrate again, as on the next `up`: nothing changes.
  const firstRun = inspect("migrate", "{{.State.StartedAt}}")
  compose("up", "--detach", "--quiet-pull")
  await waitFor("migrate to run again", () =>
    inspect("migrate", "{{.State.Status}}") === "exited" &&
    inspect("migrate", "{{.State.StartedAt}}") !== firstRun
      ? true
      : null,
  )
  const again = compose("logs", "--no-color", "migrate")
  check(
    inspect("migrate", "{{.State.ExitCode}}") === "0" &&
      (again.match(/Database ready/g) ?? []).length === 2 &&
      (again.match(/moved 17 catalog documents/g) ?? []).length === 1 &&
      psql("select count(*) from catalog_moves") === "3" &&
      before.every((w) => repository(w.id).main === w.main),
    "migrate runs again, moves nothing and changes no repository",
  )

  // The v0.3.0 agent's token: a value only this test knows replaces its
  // hash. Its scopes were renamed by the upgrade.
  const token = `shinan_agent_${randomBytes(64)
    .toString("base64")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 43)}`
  const tokenId = psql(
    `select t.id from agent_tokens t join agents a on a.id = t.agent_id where a.workspace_id = '${trial.id}' and t.revoked_at is null`,
  )
  psql(
    `update agent_tokens set token_hash = '${createHash("sha256").update(token).digest("base64url")}' where id = '${tokenId}'`,
  )
  check(
    psql(
      `select array_to_string(scopes, ' ') from agent_tokens where id = '${tokenId}'`,
    ).includes("catalog:write"),
    "the v0.3.0 agent's token has catalog:write after the upgrade",
  )
  const clone = join(dir, "clone")
  const cloned = agentGit(
    ["clone", "--quiet", `${installationUrl}/git/${trial.id}.git`, clone],
    { token },
  )
  check(
    cloned.code === 0,
    `the v0.3.0 agent clones its catalog (${cloned.stderr.trim()})`,
  )
  appendFileSync(
    join(clone, "machine", "musashi.md"),
    "\nChecked after the upgrade.\n",
  )
  agentGit(["commit", "--quiet", "-am", "A line on Musashi"], { cwd: clone })
  const pushed = agentGit(["push", "origin", "HEAD:refs/heads/main"], {
    cwd: clone,
  })
  check(
    pushed.code === 0 && !pushed.stderr.includes("by-not-first-pusher"),
    `it pushes a change to a moved page whose fact checks it leaves as they are (${pushed.stderr
      .trim()
      .split("\n")
      .filter((l) => l.startsWith("remote:"))
      .join(" | ")})`,
  )
  await waitFor(
    "the push in the push log",
    () =>
      psql(
        `select count(*) from catalog_pushes where workspace_id = '${trial.id}' and outcome = 'accepted'`,
      ) === "1",
  )
  check(true, "the push is in the push log")

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
    maxBuffer: 64 * 1024 * 1024,
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
