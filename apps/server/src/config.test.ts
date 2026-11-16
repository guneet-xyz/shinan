import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import {
  readDatabaseUrl,
  readEmailConfig,
  readSecret,
  readWebConfig,
} from "./config.js"

describe("readWebConfig", () => {
  const secret = "s".repeat(32)

  it("uses local defaults in development", () => {
    const config = readWebConfig({ NODE_ENV: "development" })
    expect(config).toMatchObject({
      host: "127.0.0.1",
      port: 3000,
      webDistDir: undefined,
      installationUrl: "http://localhost:5173",
      operators: [],
      github: undefined,
      sessions: { idleMinutes: 60, maxHours: 24 },
    })
    expect(config.sessionSecret.length).toBeGreaterThanOrEqual(32)
  })

  it("serves the built web app in production, and needs its settings there", () => {
    const env = {
      NODE_ENV: "production",
      SHINAN_URL: "https://shinan.example",
      SHINAN_OPERATORS: "Owner@Example.com, second@example.com",
      SHINAN_SESSION_SECRET: secret,
    }
    const config = readWebConfig(env)
    expect(config.webDistDir).toMatch(/[/\\]web[/\\]dist$/)
    expect(config.operators).toEqual([
      "owner@example.com",
      "second@example.com",
    ])

    for (const name of [
      "SHINAN_URL",
      "SHINAN_OPERATORS",
      "SHINAN_SESSION_SECRET",
    ] as const) {
      expect(() => readWebConfig({ ...env, [name]: "" }), name).toThrow(name)
    }
    expect(() =>
      readWebConfig({ ...env, SHINAN_URL: "http://shinan.example" }),
    ).toThrow(/https/)
  })

  it("reads overrides", () => {
    const config = readWebConfig({
      HOST: "0.0.0.0",
      PORT: "8080",
      WEB_DIST_DIR: "/srv",
      SHINAN_URL: "http://localhost:3000",
      SHINAN_SESSION_SECRET: secret,
      GITHUB_CLIENT_ID: "Iv1.abc",
      GITHUB_CLIENT_SECRET: "github-secret",
      SIGN_IN_SESSION_IDLE_MINUTES: "30",
      SIGN_IN_SESSION_MAX_HOURS: "12",
    })
    expect(config).toMatchObject({
      host: "0.0.0.0",
      port: 8080,
      webDistDir: "/srv",
      installationUrl: "http://localhost:3000",
      sessionSecret: secret,
      github: { clientId: "Iv1.abc", clientSecret: "github-secret" },
      sessions: { idleMinutes: 30, maxHours: 12 },
    })
  })

  it("reads secrets from files", () => {
    const files: Record<string, string> = {
      "/run/secrets/session": `${secret}\n`,
      "/run/secrets/github": "github-secret\n",
    }
    const config = readWebConfig(
      {
        SHINAN_SESSION_SECRET_FILE: "/run/secrets/session",
        GITHUB_CLIENT_ID: "Iv1.abc",
        GITHUB_CLIENT_SECRET_FILE: "/run/secrets/github",
      },
      (path) => files[path]!,
    )
    expect(config.sessionSecret).toBe(secret)
    expect(config.github?.clientSecret).toBe("github-secret")
  })

  it("uses the development session secret only with NODE_ENV=development", () => {
    for (const NODE_ENV of [undefined, "", "production", "prod", "test"]) {
      expect(
        () =>
          readWebConfig({
            NODE_ENV,
            SHINAN_URL: "https://x.example",
            SHINAN_OPERATORS: "op@example.com",
          }),
        String(NODE_ENV),
      ).toThrow(/SHINAN_SESSION_SECRET/)
    }
    expect(() => readWebConfig({ SHINAN_SESSION_SECRET: "too-short" })).toThrow(
      /32 characters/,
    )
  })

  it("needs both GitHub settings or neither", () => {
    expect(() =>
      readWebConfig({ NODE_ENV: "development", GITHUB_CLIENT_ID: "Iv1.abc" }),
    ).toThrow(/GITHUB_CLIENT_SECRET/)
  })

  it("rejects bad values", () => {
    const dev = { NODE_ENV: "development" }
    expect(() => readWebConfig({ ...dev, PORT: "web" })).toThrow(/PORT/)
    expect(() =>
      readWebConfig({ ...dev, SHINAN_URL: "https://x.example/app" }),
    ).toThrow(/origin/)
    // Only addresses sign-in links can go to, checked at start.
    for (const address of ["not-an-address", "you@localhost"]) {
      expect(() =>
        readWebConfig({ ...dev, SHINAN_OPERATORS: address }),
      ).toThrow(/SHINAN_OPERATORS/)
    }
    expect(() =>
      readWebConfig({ ...dev, SIGN_IN_SESSION_IDLE_MINUTES: "0" }),
    ).toThrow(/SIGN_IN_SESSION_IDLE_MINUTES/)
  })
})

describe("readDatabaseUrl", () => {
  it("requires DATABASE_URL", () => {
    expect(() => readDatabaseUrl({})).toThrow(/DATABASE_URL/)
  })
})

describe("readSecret", () => {
  const files: Record<string, string> = {
    "/run/secrets/key": "from-file\n",
    "/run/secrets/empty": "  \n",
  }
  const readFile = (path: string) => {
    const contents = files[path]
    if (contents === undefined) throw new Error("ENOENT")
    return contents
  }

  it("reads the variable itself", () => {
    expect(readSecret({ KEY: "direct" }, "KEY", readFile)).toBe("direct")
  })

  it("reads the file named by the _FILE variable, without the line end", () => {
    expect(readSecret({ KEY_FILE: "/run/secrets/key" }, "KEY", readFile)).toBe(
      "from-file",
    )
  })

  it("treats empty values as unset", () => {
    expect(readSecret({ KEY: "", KEY_FILE: "" }, "KEY", readFile)).toBe(
      undefined,
    )
  })

  it("refuses both, unreadable and empty files, without showing values", () => {
    expect(() =>
      readSecret(
        { KEY: "direct-value", KEY_FILE: "/run/secrets/key" },
        "KEY",
        readFile,
      ),
    ).toThrow("Set KEY or KEY_FILE, not both")
    expect(() => readSecret({ KEY_FILE: "/missing" }, "KEY", readFile)).toThrow(
      "Could not read KEY_FILE (/missing)",
    )
    expect(() =>
      readSecret({ KEY_FILE: "/run/secrets/empty" }, "KEY", readFile),
    ).toThrow(/empty/)
  })

  it("applies to DATABASE_URL", () => {
    const dir = mkdtempSync(join(tmpdir(), "shinan-config-"))
    try {
      const file = join(dir, "database-url")
      writeFileSync(file, "postgres://shinan:secret@db/shinan\n")
      expect(readDatabaseUrl({ DATABASE_URL_FILE: file })).toBe(
        "postgres://shinan:secret@db/shinan",
      )
    } finally {
      rmSync(dir, { recursive: true })
    }
  })
})

describe("readEmailConfig", () => {
  const ses = {
    NODE_ENV: "production",
    EMAIL_TRANSPORT: "ses",
    EMAIL_FROM: "shinan@guneet.dev",
    SES_REGION: "us-east-1",
  }

  it("uses the local mail catcher in development", () => {
    expect(readEmailConfig({})).toEqual({
      transport: "smtp",
      from: { address: "shinan@localhost", name: "Shinan" },
      host: "127.0.0.1",
      port: 1025,
    })
    expect(
      readEmailConfig({ SMTP_HOST: "mailpit", SMTP_PORT: "2525" }),
    ).toMatchObject({ host: "mailpit", port: 2525 })
  })

  it("reads SES settings, with keys from files", () => {
    const files: Record<string, string> = {
      "/run/secrets/id": "AKIDEXAMPLE\n",
      "/run/secrets/secret": "wJalrXUtnFEMI\n",
    }
    expect(
      readEmailConfig(
        {
          ...ses,
          EMAIL_FROM_NAME: "Shinan (test)",
          SES_CONFIGURATION_SET: "guneet-dev",
          SES_ACCESS_KEY_ID_FILE: "/run/secrets/id",
          SES_SECRET_ACCESS_KEY_FILE: "/run/secrets/secret",
        },
        (path) => files[path]!,
      ),
    ).toEqual({
      transport: "ses",
      from: { address: "shinan@guneet.dev", name: "Shinan (test)" },
      region: "us-east-1",
      configurationSet: "guneet-dev",
      credentials: {
        accessKeyId: "AKIDEXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI",
      },
    })
  })

  it("leaves credentials to the AWS SDK when no key is given", () => {
    expect(readEmailConfig(ses)).toEqual({
      transport: "ses",
      from: { address: "shinan@guneet.dev", name: "Shinan" },
      region: "us-east-1",
    })
  })

  it("refuses incomplete SES settings", () => {
    expect(() => readEmailConfig({ ...ses, EMAIL_FROM: "" })).toThrow(
      /EMAIL_FROM/,
    )
    expect(() => readEmailConfig({ ...ses, SES_REGION: undefined })).toThrow(
      /SES_REGION/,
    )
    expect(() =>
      readEmailConfig({ ...ses, SES_ACCESS_KEY_ID: "AKIDEXAMPLE" }),
    ).toThrow(/both/)
  })

  it("requires SES in production and refuses SMTP there (D-044)", () => {
    expect(() => readEmailConfig({ NODE_ENV: "production" })).toThrow(
      /EMAIL_TRANSPORT is not set/,
    )
    expect(() =>
      readEmailConfig({ NODE_ENV: "production", EMAIL_TRANSPORT: "smtp" }),
    ).toThrow(/only for the local mail catcher/)
  })

  it("rejects an unknown transport or port", () => {
    expect(() => readEmailConfig({ EMAIL_TRANSPORT: "sendmail" })).toThrow(
      /ses or smtp/,
    )
    expect(() => readEmailConfig({ SMTP_PORT: "mail" })).toThrow(/SMTP_PORT/)
  })
})
