import { createHash } from "node:crypto"

import { agentTokenPrefix } from "../../tokens.js"
import type { Severity } from "./problems.js"
import type { Range } from "./source.js"

/**
 * The check for secret-looking values (catalog §7.3): a safety net, not a
 * guarantee. Near-certain credentials refuse a push; weaker signs are
 * warnings.
 *
 * Every pattern runs in time linear in the text: each has a fixed or
 * bounded start, so no run of characters can be retried from every
 * position. `secrets.test.ts` checks this on hostile input.
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

/**
 * A finding with the secret itself, for validation only: the whole match,
 * or for an assignment or a URL only the value or password. Validation uses
 * it to cut the secret out of messages and to tell findings apart; it is
 * never stored, shown or exported from core.
 */
export interface SecretMatch extends SecretFinding {
  secret: string
}

/**
 * The most text the check reads from one document or other text.
 * Validation refuses longer text (`too-large`), so nothing past it is ever
 * accepted unchecked.
 */
export const maxCheckedLength = 512 * 1024

interface Pattern {
  kind: string
  pattern: RegExp
  /** Which capture group holds the secret; the whole match by default. */
  group?: number
  /** Extra test on the match, to keep false alarms rare. */
  accept?: (match: RegExpExecArray) => boolean
}

const escapedPrefix = agentTokenPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** "-----BEGIN" in base64, at each of the three byte alignments. */
const base64Begin = ["LS0tLS1CRUdJTi", "LS0tQkVHSU4", "LS0tLUJFR0lO"]

/** Not inside a longer word of letters, digits, `_` or `-`. */
const start = "(?<![A-Za-z0-9_-])"
const end = "(?![A-Za-z0-9_-])"

/** Credentials that are almost certainly real (catalog §7.3, blocking). */
const certain: Pattern[] = [
  {
    kind: "private key",
    pattern: /-----BEGIN (?:[A-Z0-9]{1,20} ){0,4}PRIVATE KEY(?: BLOCK)?-----/g,
  },
  {
    // A PEM private key in base64, as Kubernetes secrets hold them. A long
    // base64 run that holds "-----BEGIN" at any of the three byte
    // alignments is decoded whole, so a key after a certificate in a
    // bundle, or after a leading line break, is found too.
    kind: "private key (base64)",
    pattern: /(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/_-]{40,}={0,2}/g,
    accept: (m) =>
      base64Begin.some((marker) => m[0].includes(marker)) &&
      /-----BEGIN (?:[A-Z0-9]{1,20} ){0,4}PRIVATE KEY/.test(
        Buffer.from(m[0], "base64").toString("latin1"),
      ),
  },
  {
    kind: "age secret key",
    pattern: /AGE-SECRET-KEY-1[0-9A-Z]{58}/g,
  },
  {
    kind: "Shinan agent token",
    pattern: new RegExp(`${escapedPrefix}[A-Za-z0-9]{20,}`, "g"),
  },
  {
    kind: "GitHub token",
    pattern: new RegExp(`${start}gh[pousr]_[A-Za-z0-9]{36,}${end}`, "g"),
  },
  {
    kind: "GitHub token",
    pattern: new RegExp(`${start}github_pat_[A-Za-z0-9_]{60,}${end}`, "g"),
  },
  {
    kind: "GitLab token",
    pattern: new RegExp(`${start}glpat-[A-Za-z0-9_-]{20,}${end}`, "g"),
  },
  {
    kind: "Slack token",
    pattern: new RegExp(`${start}(?:xox[abposr]|xapp)-[A-Za-z0-9-]{10,}`, "g"),
  },
  {
    kind: "Slack webhook",
    pattern:
      /https:\/\/hooks\.slack\.com\/(?:services|workflows)\/[A-Za-z0-9]{6,}\/[A-Za-z0-9]{6,}\/[A-Za-z0-9]{12,}/g,
  },
  {
    kind: "Discord webhook",
    pattern:
      /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/[0-9]{5,}\/[A-Za-z0-9_-]{20,}/g,
  },
  {
    kind: "AWS access key",
    pattern: /(?<![A-Z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Z0-9])/g,
  },
  {
    kind: "Google API key",
    pattern: new RegExp(`${start}AIza[0-9A-Za-z_-]{35}${end}`, "g"),
  },
  {
    kind: "Stripe key",
    pattern: new RegExp(`${start}[rs]k_live_[0-9A-Za-z]{20,}`, "g"),
  },
  {
    kind: "AI provider key",
    pattern: new RegExp(`${start}sk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}`, "g"),
    accept: (m) => mixed(m[0]),
  },
  {
    kind: "npm token",
    pattern: new RegExp(`${start}npm_[A-Za-z0-9]{36}${end}`, "g"),
  },
  {
    kind: "PyPI token",
    pattern: new RegExp(`${start}pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{40,}`, "g"),
  },
  {
    kind: "Docker Hub token",
    pattern: new RegExp(`${start}dckr_pat_[A-Za-z0-9_-]{20,}`, "g"),
  },
  {
    kind: "Hugging Face token",
    pattern: new RegExp(`${start}hf_[A-Za-z0-9]{30,}${end}`, "g"),
  },
  {
    kind: "SendGrid key",
    pattern: new RegExp(
      `${start}SG\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}${end}`,
      "g",
    ),
  },
  {
    kind: "JSON Web Token",
    pattern: new RegExp(
      `${start}eyJ[A-Za-z0-9_-]{8,}\\.eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}`,
      "g",
    ),
  },
  {
    kind: "URL with a password",
    // The scheme is bounded and cannot start inside another scheme-like run,
    // so a long run such as `a.a.a.…` is tried from one place only.
    pattern:
      /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/[^\s/:@]{0,256}:([^\s/@]{1,256})@/g,
    group: 1,
    accept: (m) => !placeholder(m[1] ?? ""),
  },
]

/**
 * Public values that look random but are not secrets, so the weaker checks
 * leave them alone: SSH public keys, and fingerprints, digests and
 * subresource-integrity hashes (catalog §7.1 allows host key fingerprints).
 */
const harmless: Pattern[] = [
  {
    kind: "SSH public key",
    pattern:
      /(?:ssh-(?:rsa|dss|ed25519)|ecdsa-sha2-nistp[0-9]{3}|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)[ \t]+AAAA[A-Za-z0-9+/]+=*/g,
  },
  {
    kind: "fingerprint or digest",
    pattern:
      /(?<![A-Za-z0-9])(?:sha1|sha256|sha384|sha512|md5)[:-][A-Za-z0-9+/:]+=*/gi,
  },
]

/** Weaker signs (catalog §7.3, warning). */
const suspicious: Pattern[] = [
  {
    kind: "password or key written as a value",
    // Also after `_`, so `DB_PASSWORD=` and `AWS_SECRET_ACCESS_KEY=` count.
    pattern:
      /(?<![A-Za-z0-9])(?:password|passwd|pwd|passphrase|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key)(?:[_-][A-Za-z0-9_-]{0,40})?[ \t]*[=:][ \t]*["']?([^\s"',;]{1,512})/gi,
    group: 1,
    accept: (m) => (m[1] ?? "").length >= 4 && !placeholder(m[1] ?? ""),
  },
  {
    kind: "long random-looking string",
    pattern: /(?<![A-Za-z0-9_+=-])[A-Za-z0-9_+=-]{32,}/g,
    accept: (m) => randomLooking(m[0]),
  },
]

/**
 * Finds secret-looking values in `text`, which starts at `offset` in its
 * document: where they are and what they look like, never the values.
 */
export function findSecrets(text: string, offset = 0): SecretFinding[] {
  return scanSecrets(text, offset).map(
    ({ severity, kind, range, excerpt }) => ({
      severity,
      kind,
      range,
      excerpt,
    }),
  )
}

/**
 * A value's fingerprint: the SHA-256 of its UTF-8 bytes, in lowercase hex.
 * A push refused for a secret shows it, and a workspace owner may allow
 * exactly that value as "not a secret" by it (plan §2.5, GQ-2).
 */
export function secretFingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

/** A finding of the push checks: where, what, and the value's fingerprint, never the value. */
export interface PushSecretFinding extends SecretFinding {
  fingerprint: string
}

/**
 * The secret check of every push (plan §2.5, check 3): as `findSecrets`,
 * with each value's fingerprint, leaving out the values whose fingerprints
 * the workspace's owners allowed.
 */
export function findPushSecrets(
  text: string,
  allowed: ReadonlySet<string> = new Set(),
): PushSecretFinding[] {
  const findings: PushSecretFinding[] = []
  // A file may be longer than one scan reads (`maxCheckedLength`): it is
  // read in windows that overlap by more than any match is long, and each
  // finding is taken from the window it starts in.
  const step = maxCheckedLength - windowOverlap
  for (let at = 0; at === 0 || at < text.length; at += step) {
    const last = at + maxCheckedLength >= text.length
    for (const { severity, kind, range, excerpt, secret } of scanSecrets(
      text.slice(at, at + maxCheckedLength),
      at,
    )) {
      if (!last && range.start >= at + step) continue
      const fingerprint = secretFingerprint(secret)
      if (allowed.has(fingerprint)) continue
      findings.push({ severity, kind, range, excerpt, fingerprint })
    }
    if (last) break
  }
  return findings
}

/** Longer than any match the patterns make, but a private key's base64. */
const windowOverlap = 64 * 1024

/** As `findSecrets`, with each secret's value. Internal to core: see `SecretMatch`. */
export function scanSecrets(text: string, offset = 0): SecretMatch[] {
  const checked =
    text.length > maxCheckedLength ? text.slice(0, maxCheckedLength) : text
  const findings: SecretMatch[] = []
  const taken: Range[] = []
  const scan = (patterns: Pattern[], severity: Severity | null) => {
    for (const { kind, pattern, group, accept } of patterns) {
      pattern.lastIndex = 0
      for (let m = pattern.exec(checked); m; m = pattern.exec(checked)) {
        if (findings.length >= maxFindings) return
        const range = { start: m.index, end: m.index + m[0].length }
        if (range.end === range.start) pattern.lastIndex++
        if (accept && !accept(m)) continue
        if (!take(taken, range)) continue
        if (severity === null) continue
        findings.push({
          severity,
          kind,
          range: { start: offset + range.start, end: offset + range.end },
          excerpt: excerpt(m[0]),
          secret: (group === undefined ? m[0] : m[group]) ?? m[0],
        })
      }
    }
  }
  scan(certain, "blocking")
  scan(harmless, null)
  scan(suspicious, "warning")
  return findings.sort((a, b) => a.range.start - b.range.start)
}

/** More findings than this in one text add nothing for the reader. */
const maxFindings = 1000

/**
 * Adds `range` to the sorted, non-overlapping `taken` list unless it
 * overlaps one already there. Binary search keeps many findings cheap.
 */
function take(taken: Range[], range: Range): boolean {
  let low = 0
  let high = taken.length
  while (low < high) {
    const mid = (low + high) >> 1
    if ((taken[mid] as Range).start < range.start) low = mid + 1
    else high = mid
  }
  const before = taken[low - 1]
  const after = taken[low]
  if (before && before.end > range.start) return false
  if (after && after.start < range.end) return false
  taken.splice(low, 0, range)
  return true
}

/** The start of a match and an ellipsis. */
export function excerpt(match: string): string {
  return `${match.slice(0, Math.min(6, Math.floor(match.length / 3)))}…`
}

function mixed(s: string): boolean {
  return /[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s)
}

/** Values people write in place of a secret: `****`, `xxxx`, `${PASSWORD}`, `<password>`. */
function placeholder(value: string): boolean {
  return /^(?:\*+|x+|X+|\.{3,}|…|\$\{?[A-Za-z_][A-Za-z0-9_]{0,64}\}?|<[^>]{0,64}>|\{\{[^}]{0,64}\}\}|%[A-Za-z_]{1,64}%|redacted|password|secret|token|none|null|unknown)$/i.test(
    value,
  )
}

/**
 * Mixed-case letters with digits and high entropy. Bare SSH key blobs
 * (starting `AAAA`) are left alone.
 */
function randomLooking(s: string): boolean {
  if (!mixed(s) || s.startsWith("AAAA") || wordsAndNumbers(s)) return false
  return entropy(s) >= 4
}

/**
 * Names made of words and numbers joined by `-` or `_`, such as a decision's
 * file name in a pinned link (`D-054-public-image-registry-project`): each
 * part is one word (lowercase, capitalised or all capitals) or a number.
 * Random strings with dashes mix cases and digits inside their parts
 * (#157).
 */
function wordsAndNumbers(s: string): boolean {
  const parts = s.split(/[-_]+/).filter(Boolean)
  return (
    parts.length >= 3 &&
    parts.every((part) =>
      /^(?:[A-Z]?[a-z]{1,24}|[A-Z]{1,24}|[0-9]{1,24})$/.test(part),
    )
  )
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
