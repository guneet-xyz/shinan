import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import type { EmailFrom } from "@shinan/email"

export type Env = Record<string, string | undefined>

export interface WebConfig {
  host: string
  port: number
  /** Built web app to serve, or undefined to serve only the API. */
  webDistDir: string | undefined
  /**
   * PLACEHOLDER until sign-in (M1-4): the handle of the person every request
   * is signed in as, in development only.
   */
  placeholderPerson: string | undefined
}

const defaultWebDistDir = fileURLToPath(
  new URL("../../web/dist", import.meta.url),
)

export function readWebConfig(env: Env): WebConfig {
  const production = env.NODE_ENV === "production"
  // An empty value turns the placeholder off.
  const placeholderPerson = env.SHINAN_PLACEHOLDER_PERSON || undefined
  if (placeholderPerson) requireDevelopment(env)
  return {
    host: env.HOST ?? "127.0.0.1",
    port: readPort(env.PORT ?? "3000", "PORT"),
    webDistDir: production
      ? (env.WEB_DIST_DIR ?? defaultWebDistDir)
      : env.WEB_DIST_DIR,
    placeholderPerson,
  }
}

/**
 * PLACEHOLDER until sign-in (M1-4). The placeholder person runs only when
 * NODE_ENV is exactly `development`; any other value, or none, refuses it, so
 * a mistyped or missing NODE_ENV can never sign the public in.
 */
export function requireDevelopment(env: { NODE_ENV?: string }): void {
  if (env.NODE_ENV !== "development") {
    throw new Error(
      "SHINAN_PLACEHOLDER_PERSON is for development only: it needs NODE_ENV=development",
    )
  }
}

export function readDatabaseUrl(env: Env): string {
  const url = readSecret(env, "DATABASE_URL")
  if (!url) throw new Error("DATABASE_URL is not set")
  return url
}

/**
 * Reads a secret from `NAME`, or from the file named by `NAME_FILE`, as
 * container secret stores provide them (architecture §10.3). Setting both is
 * an error; empty values count as unset. The error never includes the value.
 */
export function readSecret(
  env: Env,
  name: string,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): string | undefined {
  const value = env[name] || undefined
  const file = env[`${name}_FILE`] || undefined
  if (value !== undefined && file !== undefined) {
    throw new Error(`Set ${name} or ${name}_FILE, not both`)
  }
  if (file === undefined) return value

  let contents: string
  try {
    contents = readFile(file)
  } catch (error) {
    throw new Error(`Could not read ${name}_FILE (${file})`, { cause: error })
  }
  const secret = contents.trim()
  if (!secret) throw new Error(`${name}_FILE (${file}) is empty`)
  return secret
}

/**
 * How the worker sends email. SES is the channel (D-044); SMTP exists only
 * for the local mail catcher, so it is refused in production.
 */
export type EmailConfig =
  | {
      transport: "ses"
      from: EmailFrom
      region: string
      credentials?: { accessKeyId: string; secretAccessKey: string }
      configurationSet?: string
    }
  | { transport: "smtp"; from: EmailFrom; host: string; port: number }

export function readEmailConfig(
  env: Env,
  readFile?: (path: string) => string,
): EmailConfig {
  const production = env.NODE_ENV === "production"
  const transport = env.EMAIL_TRANSPORT || (production ? undefined : "smtp")
  const name = env.EMAIL_FROM_NAME || "Shinan"

  switch (transport) {
    case "ses": {
      const address = env.EMAIL_FROM
      if (!address) throw new Error("EMAIL_FROM is not set")
      const region = env.SES_REGION
      if (!region) throw new Error("SES_REGION is not set")
      const accessKeyId = readSecret(env, "SES_ACCESS_KEY_ID", readFile)
      const secretAccessKey = readSecret(env, "SES_SECRET_ACCESS_KEY", readFile)
      if ((accessKeyId === undefined) !== (secretAccessKey === undefined)) {
        throw new Error(
          "Set both SES_ACCESS_KEY_ID and SES_SECRET_ACCESS_KEY, or neither",
        )
      }
      return {
        transport,
        from: { address, name },
        region,
        ...(accessKeyId && secretAccessKey
          ? { credentials: { accessKeyId, secretAccessKey } }
          : {}),
        ...(env.SES_CONFIGURATION_SET
          ? { configurationSet: env.SES_CONFIGURATION_SET }
          : {}),
      }
    }
    case "smtp":
      if (production) {
        throw new Error(
          "EMAIL_TRANSPORT=smtp is only for the local mail catcher in development; use ses",
        )
      }
      return {
        transport,
        from: { address: env.EMAIL_FROM || "shinan@localhost", name },
        host: env.SMTP_HOST || "127.0.0.1",
        port: readPort(env.SMTP_PORT || "1025", "SMTP_PORT"),
      }
    case undefined:
      throw new Error("EMAIL_TRANSPORT is not set (it must be ses)")
    default:
      throw new Error(`EMAIL_TRANSPORT must be ses or smtp, got "${transport}"`)
  }
}

function readPort(value: string, name: string): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${name} must be a port number, got "${value}"`)
  }
  return port
}
