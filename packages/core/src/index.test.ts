import { describe, expect, it } from "vitest"

import { agentTokenPrefix, productName } from "./index.js"

describe("core", () => {
  it("exports the product name", () => {
    expect(productName).toBe("Shinan")
  })

  it("exports a recognisable agent-token prefix", () => {
    expect(agentTokenPrefix).toBe("shinan_agent_")
  })
})
