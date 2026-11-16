import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { App } from "./App"

describe("App", () => {
  it("renders the hello page", () => {
    const html = renderToString(<App />)

    expect(html).toContain("<h1>Shinan</h1>")
    expect(html).toContain("checking…")
  })
})
