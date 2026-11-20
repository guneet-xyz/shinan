import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createGit, hooksDirectory } from "@shinan/git"

import { readGitClientConfig } from "../config.js"
import { SettingsError } from "../settings-error.js"
import { checkGitRole, readGitRoleConfig } from "./startup.js"

const token = "service-token-for-tests-0123456789abcdef"
const git = createGit()
let folder: string
let catalog: string
let temporary: string
let hooks: string

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "shinan-git-startup-"))
  catalog = join(folder, "catalog")
  temporary = join(folder, "tmp")
  hooks = join(folder, "hooks")
  for (const dir of [catalog, temporary, hooks]) mkdirSync(dir, { mode: 0o700 })
  writeHook(`process.stderr.write("Shinan: no\\n"); process.exitCode = 1`)
})
afterEach(() => rmSync(folder, { recursive: true, force: true }))

function writeHook(body: string, mode = 0o755) {
  writeFileSync(
    join(hooks, "pre-receive"),
    `#!${process.execPath}\n${body}\n`,
    { mode },
  )
  chmodSync(join(hooks, "pre-receive"), mode)
}

const check = (options: Partial<Parameters<typeof checkGitRole>[0]> = {}) =>
  checkGitRole({
    git,
    catalogDir: catalog,
    hooksDirectory: hooks,
    temporaryDir: temporary,
    ...options,
  })

describe("the git role's settings", () => {
  it("refuse to start without the service token", () => {
    expect(() => readGitRoleConfig({})).toThrow(
      /SHINAN_GIT_SERVICE_TOKEN is not set/,
    )
    expect(() =>
      readGitRoleConfig({ SHINAN_GIT_SERVICE_TOKEN: "short" }),
    ).toThrow(/at least 32 characters/)
    expect(() =>
      readGitRoleConfig({ SHINAN_GIT_SERVICE_TOKEN: `${token} x` }),
    ).toThrow(SettingsError)
    expect(() =>
      readGitRoleConfig({
        SHINAN_GIT_SERVICE_TOKEN: token,
        SHINAN_CATALOG_DIR: "catalog",
      }),
    ).toThrow(/absolute/)
  })

  it("read the token from a file, the catalog folder and the listeners", () => {
    const config = readGitRoleConfig(
      { SHINAN_GIT_SERVICE_TOKEN_FILE: "/run/secrets/git", HOST: "0.0.0.0" },
      () => `${token}\n`,
    )
    expect(config).toEqual({
      host: "0.0.0.0",
      port: 3000,
      internal: { host: "127.0.0.1", port: 3001 },
      serviceToken: token,
      catalogDir: "/var/lib/shinan/catalog",
    })
  })

  it("for the other roles, name the Git container and its token together", () => {
    expect(readGitClientConfig({})).toBeUndefined()
    expect(() => readGitClientConfig({ NODE_ENV: "production" })).toThrow(
      SettingsError,
    )
    expect(() =>
      readGitClientConfig({ SHINAN_GIT_URL: "http://git:3000" }),
    ).toThrow(/both/)
    expect(
      readGitClientConfig({
        SHINAN_GIT_URL: "http://git:3000/",
        SHINAN_GIT_SERVICE_TOKEN: token,
      }),
    ).toEqual({ url: "http://git:3000", serviceToken: token })
    for (const url of [
      "git:3000",
      "ftp://git",
      "http://git:3000/api",
      "http://u:p@git:3000",
    ]) {
      expect(
        () =>
          readGitClientConfig({
            SHINAN_GIT_URL: url,
            SHINAN_GIT_SERVICE_TOKEN: token,
          }),
        url,
      ).toThrow(SettingsError)
    }
  })
})

describe("the git role's start", () => {
  it("passes with a private volume and a hook that refuses a dry run", () => {
    expect(() => check()).not.toThrow()
  })

  it("refuses a volume that is missing, not writable, or writable by others", () => {
    expect(() => check({ catalogDir: join(folder, "nothing") })).toThrow(
      /does not exist/,
    )
    chmodSync(catalog, 0o770)
    expect(() => check()).toThrow(/group or everyone/)
    chmodSync(catalog, 0o707)
    expect(() => check()).toThrow(/group or everyone/)
    if (process.getuid?.() !== 0) {
      chmodSync(catalog, 0o500)
      expect(() => check()).toThrow(/not writable/)
    }
  })

  it("refuses a hook that is missing or not executable, which Git would skip without a word", () => {
    writeHook(`process.exitCode = 1`, 0o644)
    expect(() => check()).toThrow(/not an executable file/)
    rmSync(join(hooks, "pre-receive"))
    expect(() => check()).toThrow(/missing/)
  })

  it("refuses a hook that lets a dry run through, or that did not run", () => {
    writeHook(`process.exitCode = 0`)
    expect(() => check()).toThrow(/did not refuse a dry run/)
    writeHook(`process.exitCode = 1`)
    expect(() => check()).toThrow(/did not refuse a dry run/)
    writeFileSync(join(hooks, "pre-receive"), "#!/nonexistent/node\n", {
      mode: 0o755,
    })
    expect(() => check()).toThrow(/did not refuse a dry run/)
  })

  it("refuses hooks in the temporary folder (noexec in Docker) or on the volume", () => {
    const inTemporary = join(temporary, "hooks")
    mkdirSync(inTemporary)
    expect(() => check({ hooksDirectory: inTemporary })).toThrow(
      /temporary folder/,
    )
    const onVolume = join(catalog, "hooks")
    mkdirSync(onVolume)
    expect(() => check({ hooksDirectory: onVolume })).toThrow(
      /SHINAN_CATALOG_DIR/,
    )
  })

  it("uses the image's hooks by default", () => {
    expect(hooksDirectory).toMatch(/packages\/git\/hooks$/)
  })
})
