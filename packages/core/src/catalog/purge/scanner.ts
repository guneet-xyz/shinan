import { InvalidInputError } from "../../errors.js"
import {
  isDocumentPath,
  isEntityId,
  parseCatalogDocument,
} from "../document/index.js"
import { splitFrontmatter } from "../document/parse.js"
import type { PurgeEncoding, PurgeForm } from "../git/api.js"
import { PurgeMatcher } from "./matcher.js"

/** What replaces purged text. Plain words in brackets, so YAML still reads it as text. */
export const purgeMarker = "(purged)"

/**
 * What replaces purged text in a name: a branch, a file or a folder. Plain
 * letters, which every name may hold (`purgeMarker`'s brackets are not
 * allowed in branch names, or in paths on `main`).
 */
export const purgeNameMarker = "purged"

/** The characters of a catalog ID. */
const idCharacter = /[a-z0-9/-]/

/** Whether `id` is an ID a document can have: an entity's, a type schema's or start-here's. */
function documentId(id: string): boolean {
  return id === "start-here" || isEntityId(id) || isDocumentPath(`${id}.md`)
}

/**
 * `value` with every place that holds the text (`matcher`) replaced by
 * `marker`, except where the place is part of a catalog ID (a page's `id`,
 * an alias, a reference, a link): there by `purgeNameMarker`, as in the
 * page's path, so the ID stays an ID and still equals its path (review of
 * #197). Again until none is left, as `PurgeMatcher.replace`.
 *
 * `idName`, when given, names each such ID after the purge, from its plain
 * form (the text replaced by `purgeNameMarker`): a page renamed to keep it
 * apart from another (`machine/purged-box-2`) is referred to by its new
 * name everywhere.
 */
export function replaceKeepingIds(
  matcher: PurgeMatcher,
  value: string,
  marker: string,
  idName?: (plain: string) => string,
): string {
  let result = value
  for (let pass = 0; ; pass++) {
    const found = matcher.matches(result)
    if (found.length === 0) return result
    if (pass === 10) throw new Error("Purging a text did not finish")
    let out = ""
    let from = 0
    for (const m of found) {
      if (m.start < from) continue
      let left = m.start
      while (left > 0 && idCharacter.test(result[left - 1]!)) left--
      let right = m.end
      while (right < result.length && idCharacter.test(result[right]!)) right++
      const plain =
        idName && left >= from
          ? matcher.replace(result.slice(left, right), purgeNameMarker)
          : null
      if (idName && plain !== null && documentId(plain)) {
        out += result.slice(from, left) + idName(plain)
        from = right
        continue
      }
      const asName = documentId(
        result.slice(left, m.start) +
          purgeNameMarker +
          result.slice(m.end, right),
      )
      out += result.slice(from, m.start) + (asName ? purgeNameMarker : marker)
      from = m.end
    }
    result = out + result.slice(from)
  }
}

/**
 * **Proposed (M2-10):** the text to purge is 4 to 10,000 characters, so it
 * cannot match ordinary words by accident and a long passage is purged in
 * parts; the reason is at most 2,000 characters.
 */
export const purgeLimits = {
  textMin: 4,
  textMax: 10_000,
  reason: 2000,
} as const

/** A purge text, checked: trimmed, of the allowed length, never part of the marker. */
export function checkPurgeText(value: unknown): string {
  if (typeof value !== "string")
    throw new InvalidInputError("text", "Give the text to remove")
  const text = value.trim()
  if (text.length < purgeLimits.textMin)
    throw new InvalidInputError(
      "text-too-short",
      `The text to remove is at least ${purgeLimits.textMin} characters long, so that it cannot match ordinary words by accident`,
    )
  if (text.length > purgeLimits.textMax)
    throw new InvalidInputError(
      "text-too-long",
      `The text to remove is at most ${purgeLimits.textMax} characters long; remove a longer passage in parts`,
    )
  if (!text.isWellFormed() || text.includes("\u0000"))
    throw new InvalidInputError(
      "text",
      "The text to remove has characters that no catalog text can hold",
    )
  if (new PurgeMatcher(text).test(purgeMarker))
    throw new InvalidInputError(
      "text-in-marker",
      `The text to remove cannot be part of ${purgeMarker}, the marker that replaces it`,
    )
  return text
}

/**
 * The text written in encoded forms a purge does not reach, as M2's
 * preview looked for them: URL-encoded (as in a link), percent-encoded
 * character by character, with HTML entities, or with JSON or YAML
 * escapes. Each is searched as written; the first two in any case. Forms
 * that are the text itself are left out.
 */
export function purgeForms(
  text: string,
): { form: PurgeForm; text: string; anyCase: boolean }[] {
  const forms: { form: PurgeForm; text: string; anyCase: boolean }[] = [
    { form: "url", text: encodeURIComponent(text), anyCase: true },
    { form: "percent", text: percentEncoded(text), anyCase: true },
    { form: "html", text: htmlEscaped(text), anyCase: false },
    {
      form: "escaped",
      text: JSON.stringify(text).slice(1, -1),
      anyCase: false,
    },
  ]
  const seen = new Set([text])
  return forms.filter((f) => {
    if (seen.has(f.text)) return false
    seen.add(f.text)
    return true
  })
}

/**
 * How to find the text in the encodings a purge does not reach: base64 at
 * each of the three byte alignments (the stable middle of each, at least 8
 * characters), every byte percent-encoded (in any case), quoted-printable
 * with soft line breaks, UTF-16 (both byte orders), and in another letter
 * case than written.
 */
function encodingsOf(text: string): {
  encoding: PurgeEncoding
  find: (bytes: Buffer, lower: () => Buffer) => boolean
}[] {
  const raw = Buffer.from(text, "utf8")
  const base64 = base64Cores(raw)
  const everyByte = everyBytePercent(raw)
  const le = Buffer.from(text, "utf16le")
  const be = Buffer.from(le).swap16()
  const lowerText = Buffer.from(raw.toString("latin1").toLowerCase(), "latin1")
  return [
    {
      // Also wrapped, as in mail or a certificate (76-character lines).
      encoding: "base64",
      find: (bytes) => {
        if (base64.some((b) => bytes.includes(b))) return true
        if (!bytes.includes(0x0a)) return false
        const unwrapped = Buffer.from(
          bytes.toString("latin1").replace(/\r?\n[ \t]*/g, ""),
          "latin1",
        )
        return base64.some((b) => unwrapped.includes(b))
      },
    },
    {
      encoding: "percent-every-byte",
      find: (bytes, lower) => lower().includes(everyByte),
    },
    {
      encoding: "quoted-printable",
      find: (bytes) =>
        bytes.includes("=\n") &&
        Buffer.from(
          bytes.toString("latin1").replace(/=\r?\n/g, ""),
          "latin1",
        ).includes(raw),
    },
    {
      encoding: "utf-16",
      find: (bytes) => bytes.includes(le) || bytes.includes(be),
    },
    {
      encoding: "other-case",
      find: (bytes, lower) => lower().includes(lowerText),
    },
  ]
}

/**
 * The encodings of the text that can be searched for as strings (in the
 * database's events): base64 at each alignment, every byte
 * percent-encoded, and the text in another case.
 */
export function encodedStrings(
  text: string,
): { encoding: PurgeEncoding; strings: string[]; anyCase: boolean }[] {
  const raw = Buffer.from(text, "utf8")
  return [
    {
      encoding: "base64",
      strings: base64Cores(raw).map((b) => b.toString("latin1")),
      anyCase: false,
    },
    {
      encoding: "percent-every-byte",
      strings: [everyBytePercent(raw).toString("latin1")],
      anyCase: true,
    },
    { encoding: "other-case", strings: [text], anyCase: true },
  ]
}

/** The stable middle of the text's base64 at each of the three byte alignments. */
function base64Cores(raw: Buffer): Buffer[] {
  return [0, 1, 2]
    .map((pad) => {
      const encoded = Buffer.concat([Buffer.alloc(pad), raw]).toString("base64")
      const start = [0, 2, 3][pad]!
      const end =
        (pad + raw.length) % 3 === 0 ? encoded.length : encoded.length - 4
      return Buffer.from(encoded.slice(start, end), "latin1")
    })
    .filter((b) => b.length >= 8)
}

function everyBytePercent(raw: Buffer): Buffer {
  return Buffer.from(
    [...raw].map((b) => `%${b.toString(16).padStart(2, "0")}`).join(""),
    "latin1",
  )
}

/** Every character but ASCII letters and digits as `%XX`, byte by byte. */
function percentEncoded(text: string): string {
  return [...new TextEncoder().encode(text)]
    .map((b) =>
      /[A-Za-z0-9]/.test(String.fromCharCode(b))
        ? String.fromCharCode(b)
        : `%${b.toString(16).toUpperCase().padStart(2, "0")}`,
    )
    .join("")
}

function htmlEscaped(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

/**
 * A purge text matched in what Git stores (Git-based catalog plan §2.9):
 * files, commit messages, identities, paths and branch names, as bytes. The
 * Git container's history rewrite and its preview use it, so the text is
 * found by the same rules as M2's purge (`PurgeMatcher`: exact, except for
 * whitespace and line breaks inside long words).
 *
 * Bytes that are UTF-8 are matched as text. Others (a binary file, a commit
 * message in another encoding) are matched byte for byte against the
 * text's UTF-8 bytes, so a secret pasted into any file is found too.
 */
export class PurgeScanner {
  private readonly text: PurgeMatcher
  private readonly raw: PurgeMatcher

  /** The text, checked (`checkPurgeText`). */
  readonly purgeText: string
  private readonly forms: { form: PurgeForm; bytes: Buffer; anyCase: boolean }[]
  private readonly encodings: {
    encoding: PurgeEncoding
    find: (bytes: Buffer, lower: () => Buffer) => boolean
  }[]

  constructor(text: string, options: { limitMs?: number } = {}) {
    this.purgeText = checkPurgeText(text)
    text = this.purgeText
    this.forms = purgeForms(text).map((f) => ({
      form: f.form,
      bytes: Buffer.from(f.anyCase ? f.text.toLowerCase() : f.text, "utf8"),
      anyCase: f.anyCase,
    }))
    this.encodings = encodingsOf(text)
    this.text = new PurgeMatcher(text, options)
    const bytes = Buffer.from(text, "utf8").toString("latin1")
    this.raw = bytes === text ? this.text : new PurgeMatcher(bytes, options)
  }

  /** The matcher and the string to match for `value`. */
  private view(value: Uint8Array): {
    matcher: PurgeMatcher
    value: string
    utf8: boolean
  } {
    try {
      return {
        matcher: this.text,
        value: utf8.decode(value),
        utf8: true,
      }
    } catch {
      return {
        matcher: this.raw,
        value: Buffer.from(value).toString("latin1"),
        utf8: false,
      }
    }
  }

  /** Gives the event loop back once matching has held it for a while. */
  pause(): Promise<void> {
    return this.text.pause()
  }

  /** How many places of `value` hold the text, and whether any crosses a line break. */
  places(value: Uint8Array): { count: number; acrossLines: boolean } {
    const { matcher, value: v } = this.view(value)
    const found = matcher.matches(v)
    return {
      count: found.length,
      acrossLines: found.some((m) => m.acrossLines),
    }
  }

  holds(value: Uint8Array): boolean {
    return this.places(value).count > 0
  }

  /**
   * `value` with every occurrence replaced by `marker`; `value` itself when
   * it holds none, so what does not hold the text keeps its bytes. Catalog
   * IDs are named by `idName` (`replaceKeepingIds`).
   */
  replace(
    value: Buffer,
    marker: string,
    idName?: (plain: string) => string,
  ): Buffer {
    const { matcher, value: v, utf8: isText } = this.view(value)
    if (!matcher.test(v)) return value
    const replaced = isText
      ? replaceKeepingIds(matcher, v, marker, idName)
      : matcher.replace(v, marker)
    return Buffer.from(replaced, isText ? "utf8" : "latin1")
  }

  /**
   * A name (a branch, a file or a folder) with every occurrence replaced by
   * `purgeNameMarker`; `name` itself when it holds none.
   */
  rename(name: string): string {
    return this.text.test(name)
      ? this.text.replace(name, purgeNameMarker)
      : name
  }

  /** The encoded forms of the text that `value` holds. */
  formsIn(value: Uint8Array): PurgeForm[] {
    const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    let lower: Buffer | undefined
    return this.forms
      .filter((f) =>
        (f.anyCase
          ? (lower ??= Buffer.from(
              bytes.toString("latin1").toLowerCase(),
              "latin1",
            ))
          : bytes
        ).includes(f.bytes),
      )
      .map((f) => f.form)
  }

  /**
   * The encodings `value` may hold the text in (`PurgeEncoding`): what a
   * purge leaves, to report. Looked for in what is left once the text
   * itself is removed, so a file holding both is reported too (review of
   * #197).
   */
  encodingsIn(value: Uint8Array): PurgeEncoding[] {
    const whole = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    const bytes = this.holds(whole) ? this.replace(whole, "\u0000") : whole
    let lower: Buffer | undefined
    const lowered = () =>
      (lower ??= Buffer.from(bytes.toString("latin1").toLowerCase(), "latin1"))
    return this.encodings
      .filter((e) => e.find(bytes, lowered))
      .map((e) => e.encoding)
  }

  /**
   * A document's title as the catalog will show it after the purge (the
   * text replaced by `purgeMarker`), or null if it has none or is not a
   * catalog document.
   */
  title(content: Uint8Array): string | null {
    let text: string
    try {
      text = utf8.decode(content)
    } catch {
      return null
    }
    const title = parseCatalogDocument(text).title
    if (title === null || title.trim() === "") return null
    return this.text.test(title)
      ? replaceKeepingIds(this.text, title, purgeMarker)
      : title
  }

  /**
   * Where purging the text from a document on `main` changes its
   * structure, as M2's preview showed it: its ID, an alias, a frontmatter
   * key it ends at, or lines of the frontmatter it spans.
   */
  structure(content: Uint8Array): ("id" | "alias" | "key" | "frontmatter")[] {
    let text: string
    try {
      text = utf8.decode(content)
    } catch {
      return []
    }
    const found = new Set<"id" | "alias" | "key" | "frontmatter">()
    const document = parseCatalogDocument(text)
    if (document.id !== null && this.text.test(document.id)) found.add("id")
    if (
      document.kind === "entity" &&
      document.aliases.some((alias) => this.text.test(alias))
    )
      found.add("alias")
    const { bodyStart } = splitFrontmatter(text)
    for (const m of this.text.find(text)) {
      if (m.index >= bodyStart) continue
      if (/^\s*:/.test(text.slice(m.index + m.text.length))) found.add("key")
      if (/[\r\n]/.test(m.text)) found.add("frontmatter")
    }
    return [...found]
  }
}

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
