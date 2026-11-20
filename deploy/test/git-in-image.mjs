// Runs inside the built image, as its own user, with no shell, a read-only
// root file system, a /tmp and no network (deploy/test/first-start.mjs
// starts it): Git through @shinan/git, the hook, and `git http-backend`
// answering a fetch and refusing a push. Prints one JSON object of results;
// first-start.mjs checks them.
import { mkdtempSync, readFileSync } from "node:fs"
import { join } from "node:path"

import {
  createGit,
  diffTrees,
  history,
  hooksDirectory,
  listTree,
  newCommits,
  openCatFile,
} from "/app/packages/git/dist/index.js"

const git = createGit()
const results = { binary: git.binary }
const identity = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_AUTHOR_DATE: "1790000000 +0000",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_COMMITTER_DATE: "1790000000 +0000",
}
const text = async (args, options) =>
  (await git.run(args, options)).stdout.toString("utf8").trim()

results.version = await text(["--version"])
results.debianVersion = /^Version: (.*)$/m.exec(
  readFileSync("/var/lib/dpkg/status.d/git", "utf8"),
)?.[1]

const root = mkdtempSync("/tmp/git-")
const init = async (name) => {
  const gitDir = join(root, name)
  await git.run([
    "init",
    "--quiet",
    "--bare",
    "--template=",
    "--initial-branch=main",
    gitDir,
  ])
  return gitDir
}
const blob = (gitDir, content) =>
  text(["hash-object", "-w", "--stdin"], { gitDir, input: content })
const tree = (gitDir, lines) =>
  text(["mktree"], { gitDir, input: lines.map((line) => `${line}\n`).join("") })
const commit = (gitDir, treeId, parents, message) =>
  text(
    [
      "commit-tree",
      ...parents.flatMap((p) => ["-p", p]),
      "-m",
      message,
      treeId,
    ],
    {
      gitDir,
      env: identity,
    },
  )

// The server's repository, as Shinan would hold it, and a client's with one
// commit more.
const server = await init("server.git")
await git.run(["config", "core.hooksPath", hooksDirectory], { gitDir: server })
const client = await init("client.git")
const readme = await blob(client, "# Catalog\n")
const first = await commit(
  client,
  await tree(client, [`100644 blob ${readme}\tREADME.md`]),
  [],
  "First",
)
const musashi = await blob(client, "musashi\n")
const machine = await tree(client, [`100644 blob ${musashi}\tmusashi.md`])
const second = await commit(
  client,
  await tree(client, [
    `100644 blob ${readme}\tREADME.md`,
    `040000 tree ${machine}\tmachine`,
  ]),
  [first],
  "Second",
)
await git.run(["update-ref", "refs/heads/main", first], { gitDir: client })
results.newCommits = (
  await newCommits(git, client, [second], { limit: 10 })
).commits.map((c) => c === second)
await git.run(["update-ref", "refs/heads/main", second], { gitDir: client })
const pack = async (revisions) =>
  (
    await git.run(["pack-objects", "--stdout", "--revs", "--quiet"], {
      gitDir: client,
      input: revisions.map((r) => `${r}\n`).join(""),
    })
  ).stdout
await git.run(["index-pack", "--stdin", "--fix-thin"], {
  gitDir: server,
  input: await pack([first]),
})
await git.run(["update-ref", "refs/heads/main", first], { gitDir: server })

// @shinan/git's reads.
results.tree = (await listTree(git, client, "refs/heads/main")).map(
  (e) => `${e.mode} ${e.path}`,
)
results.diff = (await diffTrees(git, client, first, second)).map(
  (c) => `${c.status} ${c.path}`,
)
results.history = (
  await history(git, client, "refs/heads/main", { limit: 10 })
).map((c) => c.message.trim())
const reader = openCatFile(git, client)
const object = await reader.read("refs/heads/main:machine/musashi.md")
await reader.close()
results.catFile =
  typeof object === "string" ? object : object.content.toString("utf8")

// The hook, started by Git with no shell.
const hook = await git.run(["hook", "run", "pre-receive"], {
  gitDir: server,
  okExitCodes: [0, 1],
})
results.hook = { exitCode: hook.exitCode, stderr: hook.stderr.trim() }

// git http-backend, as Shinan's Git role will start it (CGI).
const pkt = (line) =>
  `${(line.length + 4).toString(16).padStart(4, "0")}${line}`
const backend = async (method, path, query, contentType, body) => {
  const result = await git.run(["http-backend"], {
    env: {
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: "1",
      REMOTE_USER: "test-agent",
      REQUEST_METHOD: method,
      PATH_INFO: path,
      QUERY_STRING: query,
      ...(body
        ? { CONTENT_TYPE: contentType, CONTENT_LENGTH: String(body.length) }
        : {}),
    },
    input: body,
  })
  const output = result.stdout
  const split = output.indexOf("\r\n\r\n")
  return {
    headers: output.subarray(0, split).toString("latin1"),
    body: output.subarray(split + 4),
    stderr: result.stderr,
  }
}
const advertised = await backend(
  "GET",
  "/server.git/info/refs",
  "service=git-upload-pack",
)
results.advertisement = {
  contentType: advertised.headers.match(/^Content-Type: (.*)$/im)?.[1] ?? null,
  service: advertised.body.includes("# service=git-upload-pack\n"),
  main: advertised.body.includes(`${first} refs/heads/main`),
}
const fetched = await backend(
  "POST",
  "/server.git/git-upload-pack",
  "",
  "application/x-git-upload-pack-request",
  Buffer.from(`${pkt(`want ${first}\n`)}0000${pkt("done\n")}`),
)
results.fetch = {
  nak: fetched.body.subarray(0, 8).toString("latin1") === "0008NAK\n",
  pack: fetched.body.subarray(8, 12).toString("latin1") === "PACK",
}
const pushed = await backend(
  "POST",
  "/server.git/git-receive-pack",
  "",
  "application/x-git-receive-pack-request",
  Buffer.concat([
    Buffer.from(
      `${pkt(`${first} ${second} refs/heads/main\0report-status\n`)}0000`,
    ),
    await pack([second, `^${first}`]),
  ]),
)
const report = pushed.body.toString("latin1")
results.push = {
  unpacked: report.includes("unpack ok\n"),
  declined: report.includes("ng refs/heads/main pre-receive hook declined\n"),
  hookMessage: pushed.stderr.includes(
    "Shinan: this push could not be checked. Nothing was changed.",
  ),
  mainUnchanged:
    (await text(["rev-parse", "refs/heads/main"], { gitDir: server })) ===
    first,
  objectsDropped:
    (
      await git.run(["cat-file", "-e", second], {
        gitDir: server,
        okExitCodes: [0, 1, 128],
      })
    ).exitCode !== 0,
}

console.log(JSON.stringify(results))
