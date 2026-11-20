import { randomBytes } from "node:crypto"
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createGit } from "./run.js"
import { commitFiles, createFixtureRepository } from "./testing.js"

// A time limit or a kill ends every process Git started, not only Git:
// `http-backend` starts `receive-pack` or `upload-pack`, which start
// `index-pack`, `pack-objects` or the hooks, and those go on when only
// their parent is killed. The tests push through `http-backend` to a
// `pre-receive` hook that does not end, and find the processes by a
// variable only they carry, through /proc.
const git = createGit()
let server: Awaited<ReturnType<typeof createFixtureRepository>>
let client: Awaited<ReturnType<typeof createFixtureRepository>>
let hooks: string
let body: Buffer

beforeAll(async () => {
  server = await createFixtureRepository(git)
  client = await createFixtureRepository(git)
  const first = await commitFiles(git, client.gitDir, {
    "README.md": "# Catalog\n",
  })
  const second = await commitFiles(
    git,
    client.gitDir,
    { "README.md": "# Catalog, changed\n" },
    { parents: [first] },
  )
  const pack = async (input: string) =>
    (
      await git.run(["pack-objects", "--stdout", "--revs", "--quiet"], {
        gitDir: client.gitDir,
        input,
      })
    ).stdout
  await git.run(["index-pack", "--stdin"], {
    gitDir: server.gitDir,
    input: await pack(`${first}\n`),
  })
  await git.run(["update-ref", "refs/heads/main", first], {
    gitDir: server.gitDir,
  })
  hooks = mkdtempSync(join(tmpdir(), "shinan-git-hooks-"))
  writeFileSync(
    join(hooks, "pre-receive"),
    `#!${process.execPath}\nsetTimeout(() => {}, 60_000)\n`,
    { mode: 0o755 },
  )
  await git.run(["config", "core.hooksPath", hooks], { gitDir: server.gitDir })
  const command = `${first} ${second} refs/heads/main\0report-status\n`
  body = Buffer.concat([
    Buffer.from(
      `${(command.length + 4).toString(16).padStart(4, "0")}${command}0000`,
    ),
    await pack(`${second}\n^${first}\n`),
  ])
})
afterAll(() => {
  server.remove()
  client.remove()
  rmSync(hooks, { recursive: true, force: true })
})

/** The command lines of the processes whose environment holds `marker`. */
function processesWith(marker: string): string[] {
  const found: string[] = []
  for (const pid of readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
    try {
      const environ = readFileSync(`/proc/${pid}/environ`, "latin1")
      if (!environ.split("\0").includes(`SHINAN_TEST_MARKER=${marker}`))
        continue
      found.push(
        readFileSync(`/proc/${pid}/cmdline`, "latin1")
          .replaceAll("\0", " ")
          .trim(),
      )
    } catch {
      // Gone meanwhile, or not ours.
    }
  }
  return found
}

async function until(condition: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (condition()) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return condition()
}

/** The CGI environment of a push through `git http-backend`. */
function pushEnvironment(marker: string): Record<string, string> {
  return {
    SHINAN_TEST_MARKER: marker,
    GIT_PROJECT_ROOT: dirname(server.gitDir),
    GIT_HTTP_EXPORT_ALL: "1",
    REMOTE_USER: "test-agent",
    REQUEST_METHOD: "POST",
    PATH_INFO: "/repository.git/git-receive-pack",
    CONTENT_TYPE: "application/x-git-receive-pack-request",
    CONTENT_LENGTH: String(body.length),
  }
}

const hookRuns = (marker: string) => () =>
  processesWith(marker).some((p) => p.includes("pre-receive"))

describe.runIf(process.platform === "linux")(
  "limits end the whole process group",
  () => {
    it("a time limit ends the processes Git started, and in time", async () => {
      const marker = randomBytes(8).toString("hex")
      const started = Date.now()
      const push = git.run(["http-backend"], {
        timeoutMs: 2000,
        env: pushEnvironment(marker),
        input: body,
      })
      expect(await until(hookRuns(marker), 1900)).toBe(true)
      await expect(push).rejects.toMatchObject({
        kind: "timeout",
        command: "http-backend",
      })
      expect(Date.now() - started).toBeLessThan(4000)
      expect(await until(() => processesWith(marker).length === 0, 2000)).toBe(
        true,
      )
    })

    it("kill() ends them too", async () => {
      const marker = randomBytes(8).toString("hex")
      const push = git.spawn(["http-backend"], {
        timeoutMs: 60_000,
        env: pushEnvironment(marker),
      })
      push.child.stdin.end(body)
      expect(await until(hookRuns(marker), 5000)).toBe(true)
      push.kill()
      await push.ended
      expect(await until(() => processesWith(marker).length === 0, 2000)).toBe(
        true,
      )
    })

    it("run() settles at its time limit even when a child keeps Git's output open", async () => {
      const marker = randomBytes(8).toString("hex")
      const started = Date.now()
      const running = git.run(["-c", "alias.linger=!sleep 30", "linger"], {
        timeoutMs: 1000,
        env: { SHINAN_TEST_MARKER: marker },
      })
      expect(
        await until(
          () => processesWith(marker).some((p) => p.includes("sleep")),
          900,
        ),
      ).toBe(true)
      await expect(running).rejects.toMatchObject({
        kind: "timeout",
        command: "linger",
      })
      expect(Date.now() - started).toBeLessThan(4000)
      expect(await until(() => processesWith(marker).length === 0, 2000)).toBe(
        true,
      )
    })
  },
)
