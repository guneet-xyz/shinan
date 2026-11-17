import type { Env } from "./config.js"
import { SettingsError } from "./settings-error.js"

/**
 * Where the `web` role's internal listener for health checks listens
 * (`INTERNAL_HOST`, `INTERNAL_PORT`; architecture §13).
 */
export function readInternalListener(env: Env): { host: string; port: number } {
  return {
    host: env.INTERNAL_HOST ?? "127.0.0.1",
    port: readPort(env.INTERNAL_PORT ?? "3001", "INTERNAL_PORT"),
  }
}

export function readPort(value: string, name: string): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new SettingsError(`${name} must be a port number, got "${value}"`)
  }
  return port
}

/**
 * Asks the `web` role's internal listener whether it is ready: database
 * reachable, migrations current (architecture §13). Container health checks
 * run this inside the container, so the listener is never published. It
 * imports nothing else of the server, so it starts quickly.
 */
export async function checkHealth(
  env: Env,
  fetchReadiness: typeof fetch = fetch,
): Promise<number> {
  const { host, port } = readInternalListener(env)
  // A listener on every address answers on loopback too.
  const target = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host
  const url = `http://${target.includes(":") ? `[${target}]` : target}:${port}/readyz`
  try {
    const response = await fetchReadiness(url, {
      signal: AbortSignal.timeout(5000),
    })
    const body = await response.text()
    if (response.ok) {
      console.info(body)
      return 0
    }
    console.error(`Not ready (${response.status}): ${body}`)
    return 1
  } catch (error) {
    console.error(`No answer from ${url}: ${failure(error)}`)
    return 1
  }
}

/** A failed request's error name and system error code, never more. */
function failure(error: unknown): string {
  const name = error instanceof Error ? error.name : "Error"
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code
  return typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code)
    ? `${name} ${code}`
    : name
}
