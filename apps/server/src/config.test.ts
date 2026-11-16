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
  it("uses local defaults in development", () => {
    expect(readWebConfig({})).toEqual({
      host: "127.0.0.1",
      port: 3000,
      webDistDir: undefined,
      placeholderPerson: undefined,
    })
  })

  it("serves the built web app in production", () => {
    const config = readWebConfig({ NODE_ENV: "production" })

    expect(config.webDistDir).toMatch(/[/\\]web[/\\]dist$/)
  })

  it("reads overrides", () => {
    expect(
      readWebConfig({
        HOST: "0.0.0.0",
        PORT: "8080",
        WEB_DIST_DIR: "/srv",
        NODE_ENV: "development",
        SHINAN_PLACEHOLDER_PERSON: "dev",
      }),
    ).toEqual({
      host: "0.0.0.0",
      port: 8080,
      webDistDir: "/srv",
      placeholderPerson: "dev",
    })
  })

  it("allows the placeholder sign-in only with NODE_ENV=development", () => {
    for (const NODE_ENV of [
      undefined,
      "",
      "production",
      "prod",
      "dev",
      "test",
    ]) {
      expect(
        () => readWebConfig({ NODE_ENV, SHINAN_PLACEHOLDER_PERSON: "dev" }),
        String(NODE_ENV),
      ).toThrow(/NODE_ENV=development/)
    }
  })

  it("turns the placeholder sign-in off with an empty value", () => {
    expect(
      readWebConfig({ SHINAN_PLACEHOLDER_PERSON: "" }).placeholderPerson,
    ).toBeUndefined()
  })

  it("rejects an invalid port", () => {
    expect(() => readWebConfig({ PORT: "web" })).toThrow(/PORT/)
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
