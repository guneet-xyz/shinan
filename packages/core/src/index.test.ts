import { describe, expect, it } from "vitest"

import {
  agentTokenPrefix,
  parseCatalogDocument,
  parserVersion,
  productName,
} from "./index.js"

describe("core", () => {
  it("exports the product name", () => {
    expect(productName).toBe("Shinan")
  })

  it("exports a recognisable agent-token prefix", () => {
    expect(agentTokenPrefix).toBe("shinan_agent_")
  })

  it("exports the catalog document model", () => {
    expect(parserVersion).toBe(5)
    expect(parseCatalogDocument("---\nid: start-here\n---\n").kind).toBe(
      "start-here",
    )
  })
})
