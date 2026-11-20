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
 * What a push's answer says, as `remote:` lines (Git-based catalog plan
 * §2.5, "Output"): the verdict, each blocking problem and warning with its
 * place, Shinan's code and message, and what to do. Never a suspected
 * secret's value: the checks name its kind and fingerprint.
 */
export function verdictLines(verdict: {
  problems: Problem[]
  warnings: Problem[]
  checkOnly: boolean
}): string[] {
  const problems = verdict.problems.filter((p) => p.code !== "check-only")
  const { warnings } = verdict
  if (problems.length === 0 && warnings.length === 0 && !verdict.checkOnly)
    return []
  const lines: string[] = []
  if (problems.length > 0) {
    lines.push("Shinan refused this push. Nothing was changed.")
    lines.push(
      `${plural(problems.length, "blocking problem", "blocking problems")}:`,
    )
    lines.push(...rows(problems))
  } else if (verdict.checkOnly) {
    lines.push("Shinan checked this push: no blocking problems.")
  } else {
    lines.push("Shinan accepted this push.")
  }
  if (warnings.length > 0) {
    lines.push(
      `${plural(warnings.length, "warning", "warnings")} (does not block):`,
    )
    lines.push(...rows(warnings))
  }
  if (verdict.checkOnly) {
    lines.push("  check-only  check only: nothing was changed")
  }
  if (problems.length > 0) {
    lines.push(
      "Fix them in new commits and push again. The shinan skill explains each code.",
    )
  }
  return lines
}
