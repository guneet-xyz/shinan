import { describe, expect, it } from "vitest"

import { agentTokenPattern, agentTokenPrefix, newAgentToken } from "./tokens.js"

describe("newAgentToken", () => {
  it("is the prefix and 43 letters or digits, one word in text", () => {
    const token = newAgentToken()
    expect(token).toHaveLength(56)
    expect(token.startsWith(agentTokenPrefix)).toBe(true)
    expect(token).toMatch(/^shinan_agent_[A-Za-z0-9]{43}$/)
    expect(token).toMatch(/^\w+$/)
    expect(agentTokenPattern.exec(`key: ${token}.`)?.[0]).toBe(token)
  })

  it("is different every time", () => {
    const tokens = new Set(Array.from({ length: 1000 }, newAgentToken))
    expect(tokens.size).toBe(1000)
  })

  it("draws every letter and digit about equally often", () => {
    const counts = new Map<string, number>()
    const samples = 2000
    for (let n = 0; n < samples; n++) {
      for (const char of newAgentToken().slice(agentTokenPrefix.length)) {
        counts.set(char, (counts.get(char) ?? 0) + 1)
      }
    }
    expect(counts.size).toBe(62)
    // 2000 × 43 / 62 ≈ 1387 each; a modulo bias would push the first eight
    // characters about 25% above the rest.
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(1150)
      expect(count).toBeLessThan(1650)
    }
  })
})
