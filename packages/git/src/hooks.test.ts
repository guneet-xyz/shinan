import { spawnSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { hooksDirectory } from "./hooks.js"

describe("the hooks", () => {
  it.each(["pre-receive", "post-receive"])(
    "are Node.js scripts Git starts directly, without a shell: %s",
    (name) => {
      const hook = join(hooksDirectory, name)
      expect(readFileSync(hook, "utf8").split("\n", 1)[0]).toBe(
        "#!/nodejs/bin/node",
      )
      expect(statSync(hook).mode & 0o111).toBe(0o111)
    },
  )

  it.each(["pre-receive", "post-receive"])(
    "start no process, detached or not: %s",
    (name) => {
      // A detached process would leave the process group that Git's time
      // limit ends (#165): the hooks only call the git role and exit.
      const text = readFileSync(join(hooksDirectory, name), "utf8")
      for (const word of [
        "child_process",
        "spawn",
        "exec",
        "fork",
        "detached",
        "setsid",
        "worker_threads",
        "require(",
        "import(",
        "import ",
      ]) {
        expect(text.replace(/^\/\/.*$/gm, ""), word).not.toContain(word)
      }
    },
  )

  it("refuse a push they cannot have checked: no nonce, no git role", () => {
    const result = spawnSync(
      process.execPath,
      [join(hooksDirectory, "pre-receive")],
      {
        input: `${"0".repeat(40)} ${"a".repeat(40)} refs/heads/main\n`,
        encoding: "utf8",
      },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toBe(
      "Shinan: this push could not be checked. Nothing was changed.\n",
    )
    const unreachable = spawnSync(
      process.execPath,
      [join(hooksDirectory, "pre-receive")],
      {
        input: `${"0".repeat(40)} ${"a".repeat(40)} refs/heads/main\n`,
        encoding: "utf8",
        env: {
          SHINAN_PUSH_NONCE: "a".repeat(64),
          // Nothing listens on port 9.
          SHINAN_HOOK_URL: "http://127.0.0.1:9",
        },
      },
    )
    expect(unreachable.status).toBe(1)
    expect(unreachable.stderr).toBe(
      "Shinan: this push could not be checked. Nothing was changed.\n",
    )
  })
})
