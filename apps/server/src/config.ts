import { fileURLToPath } from "node:url"

export type Env = Record<string, string | undefined>

export interface WebConfig {
  host: string
  port: number
  /** Built web app to serve, or undefined to serve only the API. */
  webDistDir: string | undefined
}

const defaultWebDistDir = fileURLToPath(
  new URL("../../web/dist", import.meta.url),
)

export function readWebConfig(env: Env): WebConfig {
  const production = env.NODE_ENV === "production"
  return {
    host: env.HOST ?? "127.0.0.1",
    port: readPort(env.PORT ?? "3000"),
    webDistDir: production
      ? (env.WEB_DIST_DIR ?? defaultWebDistDir)
      : env.WEB_DIST_DIR,
  }
}

export function readDatabaseUrl(env: Env): string {
  const url = env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  return url
}

function readPort(value: string): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be a port number, got "${value}"`)
  }
  return port
}
