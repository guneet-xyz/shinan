/**
 * Measures how a parser's time grows with the size of its input, for the
 * hostile-input tests (#95, #102). It compares reading the full size once
 * with reading a quarter of the size four times: the same number of
 * characters. Reading that grows linearly gives a ratio of about 1;
 * quadratic growth gives about 4. Tests require under 2.
 *
 * Time is CPU time of this thread (`process.threadCpuUsage`), not
 * wall-clock time, so other processes on a busy machine do not count; and
 * the best of several runs is taken for each side.
 */
export interface Growth {
  /** Best CPU time to read a quarter of the size four times, in milliseconds. */
  quarters: number
  /** Best CPU time to read the full size once, in milliseconds. */
  full: number
  /** `full / max(quarters, floorMs)`. */
  ratio: number
}

/**
 * Times below this are too short to compare; the quarters count as at least
 * this long. A quadratic cost is caught once the full size takes over twice
 * this.
 */
export const floorMs = 4

/** The ratio linear reading stays under; quadratic reading is about 4. */
export const maxGrowth = 2

export function growth(
  make: (size: number) => string,
  read: (text: string) => unknown,
  size: number,
  runs = 5,
): Growth {
  const small = make(Math.floor(size / 4))
  const large = make(size)
  let quarters = Infinity
  let full = Infinity
  for (let i = 0; i < runs; i++) {
    quarters = Math.min(
      quarters,
      cpu(() => {
        for (let k = 0; k < 4; k++) read(small)
      }),
    )
    full = Math.min(
      full,
      cpu(() => read(large)),
    )
  }
  return { quarters, full, ratio: full / Math.max(quarters, floorMs) }
}

/** CPU time of this thread spent in `run`, in milliseconds. */
export function cpu(run: () => unknown): number {
  const start = process.threadCpuUsage()
  run()
  const used = process.threadCpuUsage(start)
  return (used.user + used.system) / 1000
}
