import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { fakeApi, renderApp, workspaceId } from "../../test/render"

describe("Settings › Catalog", () => {
  it("gives every member the address agents clone from, to copy", async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    renderApp(`/w/${workspaceId}/settings/catalog`, fakeApi())
    const address = `${window.location.origin}/git/${workspaceId}.git`
    const field = await screen.findByRole("textbox", {
      name: "Address for agents",
    })
    expect((field as HTMLInputElement).value).toBe(address)
    expect((field as HTMLInputElement).readOnly).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: "Copy" }))
    expect(writeText).toHaveBeenCalledWith(address)
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "Set up an agent →" })
        .getAttribute("href"),
    ).toBe("/account/agents/setup")
    expect(
      screen
        .getByRole("navigation", { name: "Workspace settings" })
        .querySelector('[aria-current="page"]')?.textContent,
    ).toBe("Catalog")
    // Nothing promised for later.
    expect(screen.queryByText(/coming soon/i)).toBeNull()
  })
})
