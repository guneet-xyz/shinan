/**
 * One push at a time per repository (Git-based catalog plan §2.5), so the
 * first pusher of each commit is decided in one order: a push holds its
 * repository's lock from `pre-receive` until its ref updates are recorded,
 * and the next waits its turn, at most `waitMs`.
 */
export interface PushLocks {
  /** The lock's release, or null if it was not free within `waitMs`. */
  acquire(workspaceId: string, waitMs: number): Promise<(() => void) | null>
  /** Whether a push holds the repository's lock. */
  held(workspaceId: string): boolean
}

export function createPushLocks(): PushLocks {
  const queues = new Map<string, ((granted: boolean) => void)[]>()
  const holders = new Set<string>()

  const releaser = (workspaceId: string) => {
    let released = false
    return () => {
      if (released) return
      released = true
      const queue = queues.get(workspaceId)
      const next = queue?.shift()
      if (queue?.length === 0) queues.delete(workspaceId)
      // The lock passes straight to the next in line.
      if (next) next(true)
      else holders.delete(workspaceId)
    }
  }

  return {
    async acquire(workspaceId, waitMs) {
      if (!holders.has(workspaceId)) {
        holders.add(workspaceId)
        return releaser(workspaceId)
      }
      if (waitMs <= 0) return null
      const granted = await new Promise<boolean>((resolve) => {
        const queue = queues.get(workspaceId) ?? []
        queues.set(workspaceId, queue)
        const settle = (value: boolean) => {
          clearTimeout(timer)
          const at = queue.indexOf(settle)
          if (at >= 0) queue.splice(at, 1)
          if (queue.length === 0 && queues.get(workspaceId) === queue)
            queues.delete(workspaceId)
          resolve(value)
        }
        const timer = setTimeout(() => settle(false), waitMs)
        queue.push(settle)
      })
      return granted ? releaser(workspaceId) : null
    },
    held: (workspaceId) => holders.has(workspaceId),
  }
}
