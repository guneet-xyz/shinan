import type { ActorKind } from "@shinan/db"

/**
 * Where the words of a document came from, for the `written_by` credit of
 * its sections (catalog §12.4) and so for trust labels (agent integrations).
 *
 * A section's words are cut into units: normalised word 5-grams, or the
 * whole of a shorter part (`sectionWords`). For each unit that ever
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

/** Units of five words; shorter text is one unit of its own. */
const gram = 5
/**
 * A unit of three or four words is also found inside longer text, so a
 * person cannot lift a short agent sentence by writing around it.
 */
const shortestFound = 3

/**
 * Words with NFKC, lower case, and Markdown markers, punctuation and
 * symbols dropped, so rewrapping, merging or splitting lines, list
 * markers, emphasis, heading levels and punctuation change nothing.
 */
export function normalisedWords(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter((w) => w !== "")
}

/**
 * A section's words in two parts, its heading line and the rest, each cut
 * into units on its own, as hashes of each word. A heading of one or two
 * words (`Notes`) gives no unit, so a shared heading alone carries no
 * credit; a longer one does, since a heading can carry an instruction too.
 */
export interface SectionWords {
  heading: WordHashes
  body: WordHashes
}

/** Two 32-bit hashes of each word, so units are hashed without reading words twice. */
interface WordHashes {
  a: Uint32Array
  b: Uint32Array
}

export function sectionWords(section: {
  anchor: string | null
  text: string
}): SectionWords {
  if (section.anchor === null)
    return { heading: hashes([]), body: hashes(normalisedWords(section.text)) }
  const end = section.text.search(/\r\n|\r|\n/)
  return end < 0
    ? { heading: hashes(normalisedWords(section.text)), body: hashes([]) }
    : {
        heading: hashes(normalisedWords(section.text.slice(0, end))),
        body: hashes(normalisedWords(section.text.slice(end))),
      }
}

/** FNV-1a and a second, differently seeded hash of each word. */
function hashes(words: readonly string[]): WordHashes {
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
  return { a, b }
}

/** The units a section introduces: 5-grams, or a shorter part whole. */
export function storedUnits(words: SectionWords): number[] {
  return [
    ...partUnits(words.heading, shortestFound),
    ...partUnits(words.body, 1),
  ]
}

/** The units a section is looked up by: its stored units, and the 3- and 4-grams of longer parts. */
export function foundUnits(words: SectionWords): number[] {
  const units = storedUnits(words)
  for (const part of [words.heading, words.body])
    if (part.a.length > shortestFound)
      for (let n = shortestFound; n < gram; n++)
        for (let i = 0; i + n <= part.a.length; i++)
          units.push(hashUnit(part, i, n))
  return units
}

function partUnits(words: WordHashes, fewest: number): number[] {
  const length = words.a.length
  if (length < fewest || length === 0) return []
  if (length < gram) return [hashUnit(words, 0, length)]
  const units: number[] = []
  for (let i = 0; i + gram <= length; i++) units.push(hashUnit(words, i, gram))
  return units
}

/**
 * A 53-bit hash of words `from` to `from + count`, as a JavaScript number
 * (so it can key a Map), combined from the words' two hashes. Collisions
 * inside one document are out of practical reach.
 */
function hashUnit(words: WordHashes, from: number, count: number): number {
  let a = 0x811c9dc5 ^ count
  let b = 0x01000193 ^ count
  for (let w = from; w < from + count; w++) {
    a = Math.imul(a ^ words.a[w]!, 0x01000193)
    a ^= a >>> 13
    b = Math.imul(b ^ words.b[w]!, 0x5bd1e995)
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

  /** Records the units `author` introduced: those in `current` and not in `previous`. */
  introduce(
    previous: ReadonlySet<number>,
    current: ReadonlySet<number>,
    author: Author,
  ): void {
    if (trust[author.kind] >= trust.person) return
    const place = this.place(author)
    for (const unit of current) {
      if (previous.has(unit)) continue
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
