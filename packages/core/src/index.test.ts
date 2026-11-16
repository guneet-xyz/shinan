import { describe, expect, it } from "vitest"

import { productName } from "./index.js"

describe("core", () => {
  it("exports the product name", () => {
    expect(productName).toBe("Shinan")
  })
})
