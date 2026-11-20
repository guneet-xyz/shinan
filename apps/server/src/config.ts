import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { isEmailAddress } from "@shinan/core"
import type { EmailFrom } from "@shinan/email"

import { parseTrustedProxies } from "./client-address.js"
import type { TrustedProxies } from "./client-address.js"
import { readInternalListener, readPort } from "./health.js"
import { SettingsError } from "./settings-error.js"

export type Env = Record<string, string | undefined>

export interface WebConfig {
  host: string
  port: number
  /**
   * The internal listener for health checks (architecture §13), which the
   * reverse proxy never routes to.
   */
  internal: { host: string; port: number }
  /**
   * Proxies whose `X-Forwarded-For` header gives the client's address
   * (`SHINAN_TRUSTED_PROXIES`); nobody by default.
   */
  trustedProxies: TrustedProxies
  /** Built web app to serve, or undefined to serve only the API. */
  webDistDir: string | undefined
  /**
   * The installation's public address (`SHINAN_URL`), such as
   * `https://shinan.guneet.dev`: the base of every link Shinan sends and of
   * GitHub's callback address.
   */
  installationUrl: string
  /**
   * The installation operators' email addresses (`SHINAN_OPERATORS`), which
   * also seed the email allowlist (identity §3.2, §12).
   */
  operators: string[]
  /** Signs sign-in cookies and encrypts sign-in state (secret). */
  sessionSecret: string
  /** The GitHub App's client ID and secret, for GitHub sign-in. */
  github: { clientId: string; clientSecret: string } | undefined
  /** Sign-in session limits (identity §3.3); operators may change them. */
  sessions: { idleMinutes: number; maxHours: number }
}

const defaultWebDistDir = fileURLToPath(
  new URL("../../web/dist", import.meta.url),
)

/**
 * A fixed secret, accepted only when NODE_ENV is exactly `development`, so
 * restarting `pnpm dev` keeps people signed in. Anything else must set
 * SHINAN_SESSION_SECRET.
 */
const developmentSessionSecret =
  "shinan-development-only-session-secret-never-use-elsewhere"

export function readWebConfig(
  env: Env,
  readFile?: (path: string) => string,
): WebConfig {
  const production = env.NODE_ENV === "production"
  const development = env.NODE_ENV === "development"

  const url =
    env.SHINAN_URL || (production ? undefined : "http://localhost:5173")
  if (!url) throw new SettingsError("SHINAN_URL is not set")
  const installationUrl = readInstallationUrl(url, production)

  const operators = (env.SHINAN_OPERATORS ?? "")
    .split(/[\s,]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
  for (const email of operators) {
    // The same rule as sign-in links, so every operator can be sent one.
    if (!isEmailAddress(email)) {
      throw new SettingsError(
        `SHINAN_OPERATORS has an address sign-in links cannot be sent to: ${email}`,
      )
    }
  }
  if (production && operators.length === 0) {
    throw new SettingsError("SHINAN_OPERATORS is not set")
  }

  const sessionSecret =
    readSecret(env, "SHINAN_SESSION_SECRET", readFile) ??
    (development ? developmentSessionSecret : undefined)
  if (!sessionSecret)
    throw new SettingsError("SHINAN_SESSION_SECRET is not set")
  if (sessionSecret.length < 32) {
    throw new SettingsError(
      "SHINAN_SESSION_SECRET must be at least 32 characters",
    )
  }

  const clientId = env.GITHUB_CLIENT_ID || undefined
  const clientSecret = readSecret(env, "GITHUB_CLIENT_SECRET", readFile)
  if ((clientId === undefined) !== (clientSecret === undefined)) {
    throw new SettingsError(
      "Set both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, or neither",
    )
  }

  const port = readPort(env.PORT ?? "3000", "PORT")
  const internal = readInternalListener(env)
  if (internal.port === port && port !== 0) {
    throw new SettingsError("INTERNAL_PORT must differ from PORT")
  }

  return {
    host: env.HOST ?? "127.0.0.1",
    port,
    internal,
    trustedProxies: parseTrustedProxies(env.SHINAN_TRUSTED_PROXIES ?? ""),
    webDistDir: production
      ? (env.WEB_DIST_DIR ?? defaultWebDistDir)
      : env.WEB_DIST_DIR,
    installationUrl,
    operators,
    sessionSecret,
    github: clientId && clientSecret ? { clientId, clientSecret } : undefined,
    sessions: {
      idleMinutes: readWhole(
        env.SIGN_IN_SESSION_IDLE_MINUTES ?? "60",
        "SIGN_IN_SESSION_IDLE_MINUTES",
      ),
      maxHours: readWhole(
        env.SIGN_IN_SESSION_MAX_HOURS ?? "24",
        "SIGN_IN_SESSION_MAX_HOURS",
      ),
    },
  }
}

/** An origin with no path, over HTTPS in production. */
function readInstallationUrl(value: string, production: boolean): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new SettingsError(`SHINAN_URL must be an address, got "${value}"`)
  }
  if (url.protocol !== "https:" && (production || url.protocol !== "http:")) {
    throw new SettingsError("SHINAN_URL must use https")
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new SettingsError(
      "SHINAN_URL must be an origin, such as https://shinan.example",
    )
  }
  return url.origin
}

function readWhole(value: string, name: string): number {
  const number = Number(value)
  if (!/^\d+$/.test(value) || number < 1 || !Number.isSafeInteger(number)) {
    throw new SettingsError(
      `${name} must be a whole number above 0, got "${value}"`,
    )
  }
  return number
}

export function readDatabaseUrl(env: Env): string {
  const url = readSecret(env, "DATABASE_URL")
  if (!url) throw new SettingsError("DATABASE_URL is not set")
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
    throw new SettingsError(`Set ${name} or ${name}_FILE, not both`)
  }
  if (file === undefined) return value

  let contents: string
  try {
    contents = readFile(file)
  } catch (error) {
    throw new SettingsError(`Could not read ${name}_FILE (${file})`, {
      cause: error,
    })
  }
  const secret = contents.trim()
  if (!secret) throw new SettingsError(`${name}_FILE (${file}) is empty`)
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
      if (!address) throw new SettingsError("EMAIL_FROM is not set")
      const region = env.SES_REGION
      if (!region) throw new SettingsError("SES_REGION is not set")
      const accessKeyId = readSecret(env, "SES_ACCESS_KEY_ID", readFile)
      const secretAccessKey = readSecret(env, "SES_SECRET_ACCESS_KEY", readFile)
      if ((accessKeyId === undefined) !== (secretAccessKey === undefined)) {
        throw new SettingsError(
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
        throw new SettingsError(
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
      throw new SettingsError("EMAIL_TRANSPORT is not set (it must be ses)")
    default:
      throw new SettingsError(
        `EMAIL_TRANSPORT must be ses or smtp, got "${transport}"`,
      )
  }
}
