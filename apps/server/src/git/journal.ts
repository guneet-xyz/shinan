import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs"
import { join } from "node:path"

import { maxJournalPage } from "@shinan/core"
import type { JournalEntry } from "@shinan/core"

/** The largest journal entry, as JSON. */
export const maxJournalEntryBytes = 1024 * 1024

/** A journal request that cannot be done: answered 400. */
export class JournalError extends Error {
  override name = "JournalError"
}

/**
 * A journal entry that cannot be read: answered 500 and logged with its
 * number, and kept for an operator. Reading and acknowledging stop there.
 */
export class JournalDamagedError extends Error {
  override name = "JournalDamagedError"
  constructor(
    readonly entry: number,
    options?: ErrorOptions,
  ) {
    super(
      `Journal entry ${entry} is damaged; it is kept in journal/entries for an operator`,
      options,
    )
  }
}

export interface Journal {
  /**
   * Appends an entry and returns it once it is on disk. Numbers rise by
   * one and are never used twice, even after every entry is acknowledged
   * and the container restarts.
   */
  append(kind: string, data: Record<string, unknown>): Promise<JournalEntry>
  /** Entries numbered above `after`, oldest first, at most `limit`. */
  read(after: number, limit?: number): JournalEntry[]
  /** Deletes the entries up to `through`; repeating it deletes nothing more. */
  acknowledge(through: number): { deleted: number }
  /** The last number given, 0 before the first entry. */
  last(): number
}

/** Writes `content` to `path` through a temporary file, synced, then renamed into place. */
function writeDurably(folder: string, name: string, content: string): void {
  const temporary = join(folder, `.${name}.tmp`)
  const fd = openSync(temporary, "w", 0o600)
  try {
    writeSync(fd, content)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temporary, join(folder, name))
  const dir = openSync(folder, "r")
  try {
    fsyncSync(dir)
  } finally {
    closeSync(dir)
  }
}

const entryName = (number: number) => `${String(number).padStart(16, "0")}.json`
const entryPattern = /^(\d{16})\.json$/

/**
 * The journal of what the Git container did that PostgreSQL must learn
 * (Git-based catalog plan §2.6): the Git container has no database access,
 * so it appends entries here, on its volume, and `web` reads them, stores
 * them (idempotently, by number) and acknowledges them, after which they are
 * deleted. One file per entry, under `journal/entries/`, and the last number
 * in `journal/sequence`, written before the entry, so a number is never
 * reused.
 */
export function openJournal(root: string): Journal {
  const folder = join(root, "journal")
  const entries = join(folder, "entries")
  mkdirSync(entries, { recursive: true, mode: 0o700 })
  for (const name of readdirSync(entries)) {
    if (name.endsWith(".tmp")) rmSync(join(entries, name), { force: true })
  }
  let sequence = 0
  try {
    sequence = Number(readFileSync(join(folder, "sequence"), "utf8").trim())
  } catch {
    sequence = 0
  }
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error("The journal's sequence file is damaged")
  }
  // A sequence file behind its entries (a copy restored by hand) never
  // makes a number be given twice.
  for (const name of readdirSync(entries)) {
    const match = entryPattern.exec(name)
    if (match) sequence = Math.max(sequence, Number(match[1]))
  }

  let tail: Promise<unknown> = Promise.resolve()

  /**
   * Entry `n`, or `null` if it is gone (acknowledged meanwhile). Anything
   * else wrong with it is an error, never a skip: the entry is a record
   * PostgreSQL has not stored yet.
   */
  const readEntry = (n: number): JournalEntry | null => {
    let text: string
    try {
      text = readFileSync(join(entries, entryName(n)), "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      throw new JournalDamagedError(n, { cause: error })
    }
    let entry: unknown
    try {
      entry = JSON.parse(text)
    } catch (error) {
      throw new JournalDamagedError(n, { cause: error })
    }
    const e = entry as Partial<JournalEntry> | null
    if (
      typeof e !== "object" ||
      e === null ||
      e.number !== n ||
      typeof e.kind !== "string" ||
      typeof e.recordedAt !== "string" ||
      typeof e.data !== "object" ||
      e.data === null
    ) {
      throw new JournalDamagedError(n)
    }
    return e as JournalEntry
  }

  const numbers = () =>
    readdirSync(entries)
      .map((name) => entryPattern.exec(name)?.[1])
      .filter((n): n is string => n !== undefined)
      .map(Number)
      .sort((a, b) => a - b)

  const whole = (value: number, what: string) => {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new JournalError(`${what} must be a whole number`)
    }
    return value
  }

  return {
    append(kind, data) {
      const run = tail.then(() => {
        if (!/^[a-z][a-z0-9.-]{0,63}$/.test(kind)) {
          throw new JournalError("Not a journal entry kind")
        }
        const number = sequence + 1
        const entry: JournalEntry = {
          number,
          recordedAt: new Date().toISOString(),
          kind,
          data,
        }
        const content = JSON.stringify(entry)
        if (Buffer.byteLength(content) > maxJournalEntryBytes) {
          throw new JournalError("The journal entry is too large")
        }
        writeDurably(folder, "sequence", `${number}\n`)
        sequence = number
        writeDurably(entries, entryName(number), content)
        return entry
      })
      tail = run.catch(() => {})
      return run
    },
    read(after, limit = maxJournalPage) {
      whole(after, "after")
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxJournalPage) {
        throw new JournalError(`The limit is 1 to ${maxJournalPage}`)
      }
      // A damaged entry ends the page: the entries before it come back, so
      // `web` can store and acknowledge them, and the next read, which
      // starts at it, fails with its number.
      const page: JournalEntry[] = []
      for (const n of numbers()
        .filter((n) => n > after)
        .slice(0, limit)) {
        let entry: JournalEntry | null
        try {
          entry = readEntry(n)
        } catch (error) {
          if (page.length > 0) break
          throw error
        }
        if (entry) page.push(entry)
      }
      return page
    },
    acknowledge(through) {
      whole(through, "through")
      if (through > sequence) {
        throw new JournalError("No entry has that number yet")
      }
      let deleted = 0
      for (const n of numbers()) {
        if (n > through) break
        // An entry is deleted only once it reads whole: a damaged one stays
        // for an operator, and nothing after it is acknowledged.
        if (!readEntry(n)) continue
        rmSync(join(entries, entryName(n)), { force: true })
        deleted++
      }
      return { deleted }
    },
    last: () => sequence,
  }
}
