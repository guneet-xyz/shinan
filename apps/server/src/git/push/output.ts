import type { Problem } from "./checks.js"

/** The most problems one push's answer lists; the rest are counted. */
const maxListed = 50

function rows(problems: Problem[]): string[] {
  const listed = problems.slice(0, maxListed)
  const whereWidth = Math.min(
    48,
    Math.max(0, ...listed.map((p) => p.where.length)),
  )
  const codeWidth = Math.max(0, ...listed.map((p) => p.code.length))
  const lines = listed.map((p) =>
    `  ${p.where === "" ? "" : p.where.padEnd(whereWidth)}${p.where === "" ? "" : "  "}${p.code.padEnd(codeWidth)}  ${p.message}`.trimEnd(),
  )
  if (problems.length > listed.length) {
    lines.push(`  … and ${problems.length - listed.length} more`)
  }
  return lines
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

/**
 * The codes of problems inside the commits a push brings: a new commit on
 * top leaves the bad one in the push, so they are fixed by rewriting the
 * commits (product review of GC-3a).
 */
const inCommits = new Set([
  "secret",
  "symlink",
  "submodule",
  "file-too-large",
  "commit-too-large",
  "path-not-portable",
  "tree-too-large",
])

/**
 * What a push's answer says, as `remote:` lines (Git-based catalog plan
 * §2.5, "Output"): the verdict, each blocking problem and warning with its
 * place, Shinan's code and message, and what to do next, chosen by the
 * codes present. Never a suspected secret's value: the checks name its
 * kind and fingerprint.
 */
export function verdictLines(verdict: {
  problems: Problem[]
  warnings: Problem[]
  checkOnly: boolean
}): string[] {
  const problems = verdict.problems.filter((p) => p.code !== "check-only")
  const { warnings, checkOnly } = verdict
  if (problems.length === 0 && warnings.length === 0 && !checkOnly) return []
  const lines: string[] = []
  if (checkOnly) {
    lines.push(
      problems.length > 0
        ? "Shinan checked this push (check only). Nothing was changed."
        : "Shinan checked this push (check only): no blocking problems. Nothing was changed.",
    )
  } else if (problems.length > 0) {
    lines.push("Shinan refused this push. Nothing was changed.")
  } else {
    lines.push("Shinan accepted this push.")
  }
  if (problems.length > 0) {
    lines.push(
      `${plural(problems.length, "blocking problem", "blocking problems")}:`,
    )
    lines.push(...rows(problems))
  }
  if (warnings.length > 0) {
    lines.push(
      `${plural(warnings.length, "warning", "warnings")} (does not block):`,
    )
    lines.push(...rows(warnings))
  }
  if (problems.length > 0) {
    lines.push(
      problems.some((p) => inCommits.has(p.code))
        ? "These problems are in commits not yet in Shinan: rewrite them (git rebase -i origin/main), then push again. A new commit on top won't help."
        : "Fix them in new commits and push again. The shinan skill explains each code.",
    )
  }
  if (problems.some((p) => p.code === "secret")) {
    lines.push(
      "If a value is not a secret, a workspace owner can allow its fingerprint in workspace settings (Catalog).",
    )
  }
  return lines
}
