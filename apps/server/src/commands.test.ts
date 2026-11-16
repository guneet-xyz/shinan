import { afterEach, describe, expect, it, vi } from "vitest"

import { runCommand, usage } from "./commands.js"

describe("runCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("prints usage for help", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})

    await expect(runCommand(["help"], {})).resolves.toBe(0)
    expect(info).toHaveBeenCalledWith(usage)
  })

  it("rejects unknown commands", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(runCommand(["serve"], {})).resolves.toBe(1)
    expect(error).toHaveBeenCalledWith(expect.stringContaining("serve"))
  })

  it("requires a command", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(runCommand([], {})).resolves.toBe(1)
  })

  it("requires DATABASE_URL to migrate", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})

    await expect(runCommand(["migrate"], {})).rejects.toThrow(/DATABASE_URL/)
  })

  it("requires DATABASE_URL to run the worker", async () => {
    await expect(runCommand(["worker"], {})).rejects.toThrow(/DATABASE_URL/)
  })
})
