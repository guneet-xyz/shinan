import { agentTokenPrefix } from "../../tokens.js"
import type { Severity } from "./problems.js"
import type { Range } from "./source.js"

/**
 * The check for secret-looking values (catalog §7.3): a safety net, not a
 * guarantee. Near-certain credentials block a catalog proposal; weaker signs
 * hold it for catalog approval.
 */
export interface SecretFinding {
  severity: Severity
  /** What it looks like, such as "GitHub token" or "URL with a password". */
  kind: string
  range: Range
  /**
   * The start of the match and an ellipsis, never the whole value, so
   * findings can be stored and shown without spreading the secret further.
   */
  excerpt: string
}

interface Pattern {
  kind: string
  pattern: RegExp
  /** Extra test on the match, to keep false alarms rare. */
  accept?: (match: RegExpExecArray) => boolean
}

const escapedPrefix = agentTokenPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Credentials that are almost certainly real (catalog §7.3, blocking). */
const certain: Pattern[] = [
  {
    kind: "private key",
    pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g,
  },
  {
    kind: "Shinan agent token",
    pattern: new RegExp(`${escapedPrefix}[A-Za-z0-9]{20,}`, "g"),
  },
  { kind: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { kind: "GitHub token", pattern: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g },
  { kind: "GitLab token", pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { kind: "Slack token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "AWS access key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "Stripe key", pattern: /\b[rs]k_live_[0-9A-Za-z]{20,}\b/g },
  {
    kind: "AI provider key",
    pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/g,
    accept: (m) => mixed(m[0]),
  },
  { kind: "npm token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { kind: "PyPI token", pattern: /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{40,}/g },
  { kind: "Docker Hub token", pattern: /\bdckr_pat_[A-Za-z0-9_-]{20,}/g },
  { kind: "Hugging Face token", pattern: /\bhf_[A-Za-z0-9]{30,}\b/g },
  {
    kind: "SendGrid key",
    pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g,
  },
  {
    kind: "URL with a password",
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:([^\s/@]+)@/gi,
    accept: (m) => !placeholder(m[1] ?? ""),
  },
]

/** Weaker signs (catalog §7.3, warning). */
const suspicious: Pattern[] = [
  {
    kind: "password or key written as a value",
    pattern:
      /\b(?:password|passwd|pwd|passphrase|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key)\s*[=:]\s*["']?([^\s"',;]+)/gi,
    accept: (m) => (m[1] ?? "").length >= 4 && !placeholder(m[1] ?? ""),
  },
  {
    kind: "long random-looking string",
    pattern: /[A-Za-z0-9_+=-]{32,}/g,
    accept: (m) => randomLooking(m[0], m.input.slice(0, m.index)),
  },
]

/** Finds secret-looking values in `text`, which starts at `offset` in its document. */
export function findSecrets(text: string, offset = 0): SecretFinding[] {
  const findings: SecretFinding[] = []
  const taken: Range[] = []
  const scan = (patterns: Pattern[], severity: Severity) => {
    for (const { kind, pattern, accept } of patterns) {
      pattern.lastIndex = 0
      for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
        const range = { start: m.index, end: m.index + m[0].length }
        if (range.end === range.start) pattern.lastIndex++
        if (accept && !accept(m)) continue
        if (taken.some((t) => t.start < range.end && range.start < t.end))
          continue
        taken.push(range)
        findings.push({
          severity,
          kind,
          range: { start: offset + range.start, end: offset + range.end },
          excerpt: excerpt(m[0]),
        })
      }
    }
  }
  scan(certain, "blocking")
  scan(suspicious, "warning")
  return findings.sort((a, b) => a.range.start - b.range.start)
}

function excerpt(match: string): string {
  return `${match.slice(0, Math.min(6, Math.floor(match.length / 3)))}…`
}

function mixed(s: string): boolean {
  return /[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s)
}

/** Values people write in place of a secret: `****`, `xxxx`, `${PASSWORD}`, `<password>`. */
function placeholder(value: string): boolean {
  return /^(?:\*+|x+|X+|\.{3,}|…|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|<[^>]*>|\{\{[^}]*\}\}|%[A-Za-z_]+%|redacted|changeme|password|secret|token|none|null|unknown|obscuro:.*)$/i.test(
    value,
  )
}

/**
 * Mixed-case letters with digits and high entropy. Excludes SSH public keys
 * (which start `AAAA`) and fingerprints or digests after `SHA256:`, since
 * catalog §7.1 allows host key fingerprints.
 */
function randomLooking(s: string, before: string): boolean {
  if (!mixed(s) || s.startsWith("AAAA")) return false
  if (/(?:sha(?:1|256|384|512)|md5)[:-]$/i.test(before)) return false
  return entropy(s) >= 4
}

function entropy(s: string): number {
  const counts = new Map<string, number>()
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1)
  let bits = 0
  for (const n of counts.values()) {
    const p = n / s.length
    bits -= p * Math.log2(p)
  }
  return bits
}
