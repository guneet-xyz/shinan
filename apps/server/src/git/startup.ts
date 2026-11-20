import { spawnSync } from "node:child_process"
import {
  accessSync,
  constants,
  lstatSync,
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative, resolve } from "node:path"

import { hooksDirectory as imageHooks } from "@shinan/git"
import type { Git } from "@shinan/git"

import type { Env } from "../config.js"
import { readServiceToken } from "../config.js"
import { readInternalListener, readPort } from "../health.js"
import { SettingsError } from "../settings-error.js"

export interface GitRoleConfig {
  host: string
  port: number
  /** The internal listener for the container's health check (architecture §13). */
  internal: { host: string; port: number }
  /** The only credential this role holds (D-065). */
  serviceToken: string
  /** The volume with the repositories and the journal (`SHINAN_CATALOG_DIR`). */
  catalogDir: string
}

export const defaultCatalogDir = "/var/lib/shinan/catalog"

/**
 * The `git` role's settings: the service token (refused to start without
 * one, D-065), the catalog folder and its listeners. It reads no database
 * address, session secret or email setting: it holds none.
 */
export function readGitRoleConfig(
  env: Env,
  readFile?: (path: string) => string,
): GitRoleConfig {
  const serviceToken = readServiceToken(env, readFile)
  if (!serviceToken) {
    throw new SettingsError(
      "SHINAN_GIT_SERVICE_TOKEN is not set: the git role refuses to start without its service token. Set it or SHINAN_GIT_SERVICE_TOKEN_FILE; see the operator guide, 'Setting up'",
    )
  }
  const catalogDir = env.SHINAN_CATALOG_DIR || defaultCatalogDir
  if (!isAbsolute(catalogDir)) {
    throw new SettingsError("SHINAN_CATALOG_DIR must be an absolute path")
  }
  const port = readPort(env.PORT ?? "3000", "PORT")
  const internal = readInternalListener(env)
  if (internal.port === port && port !== 0) {
    throw new SettingsError("INTERNAL_PORT must differ from PORT")
  }
  return {
    host: env.HOST ?? "127.0.0.1",
    port,
    internal,
    serviceToken,
    catalogDir,
  }
}

/** Whether `path` is `folder` or inside it. */
function inside(path: string, folder: string): boolean {
  const r = relative(resolve(folder), resolve(path))
  return r === "" || (!r.startsWith("..") && !isAbsolute(r))
}

/**
 * Refuses to start the `git` role unless the volume is usable and only by
 * this user, and the push hook would run. A hook that is not executable,
 * or on a `noexec` file system (Docker's default `/tmp` is one), is skipped
 * by Git without a word, and the push would land unchecked: so the hooks
 * must be outside `/tmp` and the volume, executable, and must refuse a dry
 * run started by Git itself.
 */
export function checkGitRole(options: {
  git: Git
  catalogDir: string
  hooksDirectory?: string
  temporaryDir?: string
}): void {
  const hooks = options.hooksDirectory ?? imageHooks
  const temporary = options.temporaryDir ?? tmpdir()

  let folder
  try {
    folder = statSync(options.catalogDir)
  } catch {
    throw new SettingsError(
      `SHINAN_CATALOG_DIR (${options.catalogDir}) does not exist; create it owned by user 65532 with mode 0700`,
    )
  }
  if (!folder.isDirectory()) {
    throw new SettingsError(
      `SHINAN_CATALOG_DIR (${options.catalogDir}) is not a folder; make it a folder owned by user 65532 with mode 0700`,
    )
  }
  try {
    accessSync(
      options.catalogDir,
      constants.R_OK | constants.W_OK | constants.X_OK,
    )
  } catch {
    throw new SettingsError(
      `SHINAN_CATALOG_DIR (${options.catalogDir}) is not writable by this user (${process.getuid?.() ?? "?"}); give it to that user (chown ${process.getuid?.() ?? 65532}) with mode 0700`,
    )
  }
  if (folder.mode & 0o022) {
    throw new SettingsError(
      `SHINAN_CATALOG_DIR (${options.catalogDir}) is writable by its group or everyone; give it mode 0700`,
    )
  }

  for (const [place, name] of [
    [temporary, "the temporary folder"],
    [options.catalogDir, "SHINAN_CATALOG_DIR"],
  ] as const) {
    if (inside(hooks, place)) {
      throw new SettingsError(`Git's hooks (${hooks}) must not be in ${name}`)
    }
  }
  const hook = join(hooks, "pre-receive")
  let stat
  try {
    stat = lstatSync(hook)
  } catch {
    throw new SettingsError(
      `Git's pre-receive hook (${hook}) is missing. The image is damaged; use the published image unchanged.`,
    )
  }
  try {
    if (!stat.isFile()) throw new Error("not a file")
    accessSync(hook, constants.X_OK)
  } catch {
    throw new SettingsError(
      `Git's pre-receive hook (${hook}) is not an executable file. The image is damaged or its hooks folder is mounted noexec; use the published image unchanged.`,
    )
  }

  // A dry run, started by Git as a push would start it: it must refuse.
  const probe = mkdtempSync(join(temporary, "shinan-git-probe-"))
  try {
    const gitDir = join(probe, "probe.git")
    const env = options.git.environment()
    const run = (args: string[]) =>
      spawnSync(options.git.binary, [`--git-dir=${gitDir}`, ...args], {
        env,
        cwd: probe,
        input: "",
        encoding: "utf8",
        timeout: 30_000,
      })
    const init = spawnSync(
      options.git.binary,
      ["init", "--quiet", "--bare", "--template=", gitDir],
      { env, cwd: probe, encoding: "utf8", timeout: 30_000 },
    )
    if (init.status !== 0) {
      throw new SettingsError(
        `Git does not run (\`${options.git.binary} init\` failed). The image is damaged; use the published image unchanged.`,
      )
    }
    run(["config", "core.hooksPath", hooks])
    // Shinan's hooks start what they write with "Shinan:", which shows that
    // the hook itself ran and refused, not Git failing to start it.
    const dry = run(["hook", "run", "pre-receive"])
    if (
      dry.status === 0 ||
      dry.status === null ||
      !dry.stderr.includes("Shinan:")
    ) {
      throw new SettingsError(
        "Git's pre-receive hook did not refuse a dry run: it did not run, or it lets pushes through. The image is damaged or its hooks folder is mounted noexec; use the published image unchanged.",
      )
    }
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}
