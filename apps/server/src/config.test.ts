import { describe, expect, it } from "vitest"

import { readDatabaseUrl, readWebConfig } from "./config.js"

describe("readWebConfig", () => {
  it("uses local defaults in development", () => {
    expect(readWebConfig({})).toEqual({
      host: "127.0.0.1",
      port: 3000,
      webDistDir: undefined,
    })
  })

  it("serves the built web app in production", () => {
    const config = readWebConfig({ NODE_ENV: "production" })

    expect(config.webDistDir).toMatch(/[/\\]web[/\\]dist$/)
  })

  it("reads overrides", () => {
    expect(
      readWebConfig({ HOST: "0.0.0.0", PORT: "8080", WEB_DIST_DIR: "/srv" }),
    ).toEqual({ host: "0.0.0.0", port: 8080, webDistDir: "/srv" })
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
