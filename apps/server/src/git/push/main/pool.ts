import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { Worker } from "node:worker_threads"

import type { MainCheckInput, MainCheckOutput } from "./checks.js"

/** The checks of `main` ran past their time limit. */
export class MainCheckTimeoutError extends Error {
  override name = "MainCheckTimeoutError"
}

/** The checks of `main` ran out of their heap. */
export class MainCheckMemoryError extends Error {
  override name = "MainCheckMemoryError"
}

export interface MainChecker {
  /** Runs the checks, or rejects at `deadline` (milliseconds since 1970). */
  check(input: MainCheckInput, deadline: number): Promise<MainCheckOutput>
  stop(): Promise<void>
}

/**
 * One worker thread for the checks of `main` (plan §2.5): one push at a
 * time, in turn; each must finish by its deadline, or the worker is stopped
 * (and started again for the next) and the push refused as too slow. The
 * heap is limited (`heapMb`); a worker idle for `idleMs` is stopped, which
 * frees its parsed documents.
 */
export function createMainChecker(
  options: { heapMb?: number; idleMs?: number } = {},
): MainChecker {
  const heapMb = options.heapMb ?? 384
  const idleMs = options.idleMs ?? 5 * 60 * 1000
  let worker: Worker | null = null
  let ready: Promise<Worker> | null = null
  let idle: NodeJS.Timeout | undefined
  let tail: Promise<unknown> = Promise.resolve()
  let next = 0

  const start = (): Promise<Worker> => {
    if (ready) return ready
    // From source (tests, development) the worker loads TypeScript as the
    // server does there.
    const source = import.meta.url.endsWith(".ts")
    const started = new Worker(
      new URL(source ? "./worker.ts" : "./worker.js", import.meta.url),
      {
        resourceLimits: { maxOldGenerationSizeMb: heapMb },
        execArgv: source
          ? [
              "--import",
              pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
              "--conditions=@shinan/source",
            ]
          : [],
      },
    )
    started.unref()
    worker = started
    ready = new Promise<Worker>((resolve, reject) => {
      started.once("message", () => resolve(started))
      started.once("error", reject)
      started.once("exit", (code) =>
        reject(
          new Error(`The main checks' worker stopped (exit code ${code})`),
        ),
      )
    })
    started.once("exit", () => {
      if (worker === started) {
        worker = null
        ready = null
      }
    })
    return ready
  }

  const stop = async () => {
    const current = worker
    worker = null
    ready = null
    await current?.terminate()
  }

  const run = async (
    input: MainCheckInput,
    deadline: number,
  ): Promise<MainCheckOutput> => {
    clearTimeout(idle)
    const current = await start()
    const id = ++next
    try {
      return await new Promise<MainCheckOutput>((resolve, reject) => {
        const timer = setTimeout(
          () => {
            void stop()
            reject(new MainCheckTimeoutError())
          },
          Math.max(0, deadline - Date.now()),
        )
        const done = () => {
          clearTimeout(timer)
          current.off("message", onMessage)
          current.off("error", onError)
          current.off("exit", onExit)
        }
        const onMessage = (message: {
          id?: number
          output?: MainCheckOutput
          error?: string
        }) => {
          if (message.id !== id) return
          done()
          if (message.output) resolve(message.output)
          else reject(new Error(message.error ?? "The main checks failed"))
        }
        const onError = (error: Error) => {
          done()
          void stop()
          reject(
            (error as { code?: string }).code === "ERR_WORKER_OUT_OF_MEMORY"
              ? new MainCheckMemoryError()
              : error,
          )
        }
        const onExit = (code: number) => {
          done()
          reject(
            new Error(`The main checks' worker stopped (exit code ${code})`),
          )
        }
        current.on("message", onMessage)
        current.once("error", onError)
        current.once("exit", onExit)
        current.postMessage({ id, input })
      })
    } finally {
      clearTimeout(idle)
      idle = setTimeout(() => void stop(), idleMs)
      idle.unref()
    }
  }

  return {
    check(input, deadline) {
      // One at a time; the wait counts against each push's deadline.
      const result = tail.then(() => run(input, deadline))
      tail = result.catch(() => {})
      return result
    },
    stop,
  }
}
