import type { ActorKind } from "@shinan/db"

/**
 * Where the words of a document came from, for the `written_by` credit of
 * its sections (catalog §12.4) and so for trust labels (agent integrations).
 *
 * A section's words are cut into units: normalised word 3-grams, or the
 * whole of a one- or two-word body (`sectionWords`). For each unit that ever
 * appeared in the document, the provenance keeps the least-trusted author
 * who introduced it, in any revision: a unit is introduced by a revision
 * whose body has it when the document's previous revision did not. Units
 * stay known after they leave the document, so text
 * restored later (a revert, a re-added section) keeps its first author.
 *
 * Only units introduced by someone less trusted than a person are kept: a
 * person's units can never lower a credit, so leaving them out changes no
 * answer and keeps the table small for catalogs people write.
 */

/** How far text from each kind of actor is trusted, least first. */
export const trust: Record<ActorKind, number> = {
  outside: 0,
  unknown: 1,
  agent: 2,
  shinan: 3,
  person: 4,
}

export interface Author {
  kind: ActorKind
  /** The written form (identity §8.7). */
  author: string
}

/** Units of three words; a shorter body is one unit of its own. */
const gram = 3

/** Characters a reader never sees: zero-width spaces and joiners, bidi marks, soft hyphens, variation selectors. */
const invisible = /\p{Default_Ignorable_Code_Point}/gu

/**
 * The words a reader sees: invisible characters removed, NFKC, lower case,
 * Markdown markers, punctuation and symbols dropped, and nothing made only
 * of combining marks. Rewrapping, merging or splitting lines, list markers,
 * emphasis, heading levels, punctuation and invisible characters change
 * nothing.
 */
export function normalisedWords(text: string): string[] {
  return text
    .replace(invisible, "")
    .normalize("NFKC")
    .replace(invisible, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter((w) => w !== "" && !/^\p{M}+$/u.test(w))
}

/** One part of a section: its words, and two 32-bit hashes of each. */
export interface Part {
  words: string[]
  a: Uint32Array
  b: Uint32Array
}

/**
 * A section's words in two parts, its heading line and the rest, each cut
 * into units on its own. A heading of one or two words (`Notes`) gives no
 * unit, so a shared heading alone carries no credit; a longer one does,
 * since a heading can carry an instruction too.
 */
export interface SectionWords {
  heading: Part
  body: Part
}

/** A unit: the hash that keys it, and its words, to tell a real match from a hash collision. */
export interface Unit {
  hash: number
  words: string
}

export function sectionWords(section: {
  anchor: string | null
  text: string
}): SectionWords {
  if (section.anchor === null)
    return { heading: part([]), body: part(normalisedWords(section.text)) }
  const end = section.text.search(/\r\n|\r|\n/)
  return end < 0
    ? { heading: part(normalisedWords(section.text)), body: part([]) }
    : {
        heading: part(normalisedWords(section.text.slice(0, end))),
        body: part(normalisedWords(section.text.slice(end))),
      }
}

/** FNV-1a and a second, differently seeded hash of each word. */
function part(words: string[]): Part {
  const a = new Uint32Array(words.length)
  const b = new Uint32Array(words.length)
  words.forEach((word, w) => {
    let x = 0x811c9dc5
    let y = 0x5bd1e995
    for (let i = 0; i < word.length; i++) {
      const c = word.charCodeAt(i)
      x = Math.imul(x ^ c, 0x01000193)
      y = Math.imul(y ^ c, 0x5bd1e995)
      y ^= y >>> 15
    }
    a[w] = x
    b[w] = y
  })
  return { words, a, b }
}

/**
 * The units a section brings: the word 3-grams of each part, or a body of
 * one or two words whole.
 */
export function storedUnits(words: SectionWords): Unit[] {
  return [...partUnits(words.heading, false), ...partUnits(words.body, true)]
}

/**
 * The hashes a section is looked up by: its units, and the 2-grams of
 * longer parts, which find a one- or two-word body written around.
 */
export function foundUnits(words: SectionWords): number[] {
  const hashes = storedUnits(words).map((u) => u.hash)
  for (const p of [words.heading, words.body])
    if (p.words.length > 2)
      for (let i = 0; i + 2 <= p.words.length; i++)
        hashes.push(hashUnit(p, i, 2))
  return hashes
}

function partUnits(p: Part, short: boolean): Unit[] {
  const length = p.words.length
  if (length === 0) return []
  if (length < gram)
    return short
      ? [{ hash: hashUnit(p, 0, length), words: p.words.join(" ") }]
      : []
  const units: Unit[] = []
  for (let i = 0; i + gram <= length; i++)
    units.push({
      hash: hashUnit(p, i, gram),
      words: p.words.slice(i, i + gram).join(" "),
    })
  return units
}

/**
 * A 53-bit hash of words `from` to `from + count`, as a JavaScript number
 * (so it can key a Map), combined from the words' two hashes. It is not
 * secret: a collision only ever makes a credit more cautious, since a
 * revision's words are compared with the previous revision's as words, not
 * hashes (`Provenance.introduce`), and any stored hash a section has counts
 * against it.
 */
function hashUnit(p: Part, from: number, count: number): number {
  let a = 0x811c9dc5 ^ count
  let b = 0x01000193 ^ count
  for (let w = from; w < from + count; w++) {
    a = Math.imul(a ^ p.a[w]!, 0x01000193)
    a ^= a >>> 13
    b = Math.imul(b ^ p.b[w]!, 0x5bd1e995)
    b ^= b >>> 15
  }
  return (a >>> 11) * 0x100000000 + (b >>> 0)
}

/** The least-trusted author known for each unit of one document. */
export class Provenance {
  /** Each unit's author, as a place in `authors`. */
  private readonly units = new Map<number, number>()
  private readonly authors: Author[] = []
  private readonly places = new Map<string, number>()

  private place(author: Author): number {
    const key = authorKey(author)
    let place = this.places.get(key)
    if (place === undefined) {
      place = this.authors.length
      this.authors.push(author)
      this.places.set(key, place)
    }
    return place
  }

  /**
   * Records the units `author` introduced: those in `current` whose words
   * the previous revision did not have. Words, not hashes, decide what was
   * there before, so a unit whose hash merely matches earlier text is
   * still recorded.
   */
  introduce(
    previous: ReadonlyMap<number, ReadonlySet<string>>,
    current: readonly Unit[],
    author: Author,
  ): void {
    if (trust[author.kind] >= trust.person) return
    const place = this.place(author)
    for (const { hash: unit, words } of current) {
      if (previous.get(unit)?.has(words)) continue
      const known = this.units.get(unit)
      if (
        known === undefined ||
        trust[author.kind] < trust[this.authors[known]!.kind]
      )
        this.units.set(unit, place)
    }
  }

  /** The least trusted of `start` and the authors of any of the units. */
  leastTrusted(units: Iterable<number>, start: Author): Author {
    let least = start
    for (const unit of units) {
      const known = this.units.get(unit)
      if (known === undefined) continue
      const author = this.authors[known]!
      if (trust[author.kind] < trust[least.kind]) least = author
    }
    return least
  }

  get size(): number {
    return this.units.size
  }

  /**
   * The stored form: the authors the units name, sorted, and the units,
   * sorted, as 10 bytes each (the hash's high 21 bits and low 32 bits, then
   * the author's place in the list). The same provenance always gives the
   * same bytes.
   */
  encode(): { authors: Author[]; units: Buffer } {
    const used = [...new Set(this.units.values())]
    used.sort((x, y) =>
      authorKey(this.authors[x]!) < authorKey(this.authors[y]!) ? -1 : 1,
    )
    const remap = new Map(used.map((place, i) => [place, i]))
    const keys = Float64Array.from(this.units.keys()).sort()
    const units = Buffer.alloc(keys.length * 10)
    for (let i = 0; i < keys.length; i++) {
      const unit = keys[i]!
      units.writeUInt32BE(Math.floor(unit / 0x100000000), i * 10)
      units.writeUInt32BE(unit % 0x100000000, i * 10 + 4)
      units.writeUInt16BE(remap.get(this.units.get(unit)!)!, i * 10 + 8)
    }
    return { authors: used.map((place) => this.authors[place]!), units }
  }

  static decode(stored: { authors: Author[]; units: Buffer }): Provenance {
    const provenance = new Provenance()
    const places = stored.authors.map((a) => provenance.place(a))
    for (let i = 0; i + 10 <= stored.units.length; i += 10) {
      const unit =
        stored.units.readUInt32BE(i) * 0x100000000 +
        stored.units.readUInt32BE(i + 4)
      provenance.units.set(unit, places[stored.units.readUInt16BE(i + 8)]!)
    }
    return provenance
  }
}

function authorKey(a: Author): string {
  return `${trust[a.kind]}\u0000${a.author}`
}
