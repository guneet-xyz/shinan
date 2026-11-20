import { spawnSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { hooksDirectory } from "./hooks.js"

describe("the hooks", () => {
  it("are Node.js scripts Git starts directly, without a shell", () => {
    const hook = join(hooksDirectory, "pre-receive")
    expect(readFileSync(hook, "utf8").split("\n", 1)[0]).toBe(
      "#!/nodejs/bin/node",
    )
    expect(statSync(hook).mode & 0o111).toBe(0o111)
  })

  it("refuse every push until push checks exist", () => {
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
      "Shinan: pushes are not open yet. Nothing was changed.\n",
    )
  })
})
