/**
 * Dates in catalog documents. YAML's core schema leaves them as text, and
 * Shinan reads them itself so every reader agrees (catalog §2.1).
 *
 * Two forms are accepted: a date (`2026-11-14`) or a date and time with a UTC
 * offset (`2026-11-14T09:30Z`, `2026-11-14T09:30:15+01:00`). A date and time
 * without an offset is refused, because "not in the future" and freshness
 * could not be decided for it.
 */
export interface CatalogTime {
  /** As written. */
  text: string
  /** Whether only a date was written. */
  dateOnly: boolean
  /**
   * The instant, in milliseconds since 1970: for a date, the start of that
   * day in UTC.
   */
  at: number
}

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/
const dateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/

export function parseCatalogTime(text: string): CatalogTime | null {
  const date = datePattern.exec(text)
  if (date) {
    const at = utc(date[1], date[2], date[3])
    return at === null ? null : { text, dateOnly: true, at }
  }
  const dateTime = dateTimePattern.exec(text)
  if (!dateTime) return null
  const [, y, mo, d, h, mi, s, fraction, zone] = dateTime
  const day = utc(y, mo, d)
  const hours = Number(h)
  const minutes = Number(mi)
  const seconds = Number(s ?? "0")
  if (day === null || hours > 23 || minutes > 59 || seconds > 59) return null
  let offset = 0
  if (zone && zone !== "Z") {
    const sign = zone.startsWith("-") ? -1 : 1
    const oh = Number(zone.slice(1, 3))
    const om = Number(zone.slice(4, 6))
    if (oh > 14 || om > 59) return null
    offset = sign * (oh * 60 + om)
  }
  const millis = Math.floor(Number(`0.${fraction ?? "0"}`) * 1000)
  const at =
    day + ((hours * 60 + minutes - offset) * 60 + seconds) * 1000 + millis
  return { text, dateOnly: false, at }
}

function utc(
  y: string | undefined,
  m: string | undefined,
  d: string | undefined,
): number | null {
  const year = Number(y)
  const month = Number(m)
  const day = Number(d)
  if (month < 1 || month > 12 || day < 1) return null
  const back = new Date(0)
  back.setUTCFullYear(year, month - 1, day)
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day
  )
    return null
  return back.getTime()
}

export const dayMillis = 24 * 60 * 60 * 1000
