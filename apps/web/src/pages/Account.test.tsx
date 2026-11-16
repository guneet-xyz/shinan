import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import {
  account,
  apiError,
  currentPath,
  fakeApi,
  renderApp,
  signedOut,
  workspaceId,
} from "../test/render"

describe("your account", () => {
  it("shows the profile and workspaces with roles", async () => {
    renderApp("/account")

    expect(
      await screen.findByRole("heading", { name: "Your account" }),
    ).toBeTruthy()
    expect(screen.getByText("guneet@example.com")).toBeTruthy()
    const link = screen.getByRole("link", { name: "Team" })
    expect(link.getAttribute("href")).toBe(`/w/${workspaceId}`)
    expect(link.closest("li")!.textContent).toContain("RoleWorkspace owner")
  })

  it("signs out", async () => {
    let signedIn = true
    const api = fakeApi({
      account: () =>
        signedIn ? Promise.resolve(account) : Promise.reject(signedOut()),
      signOut: () => {
        signedIn = false
        return Promise.resolve(undefined)
      },
    })
    renderApp("/account", api)

    await userEvent.click(
      await screen.findByRole("button", { name: "Sign out" }),
    )
    expect(
      await screen.findByRole("heading", { name: "Sign in to Shinan" }),
    ).toBeTruthy()
    expect(currentPath()).toBe("/sign-in")
  })

  it("says when signing out is not available yet", async () => {
    const api = fakeApi({
      signOut: () =>
        Promise.reject(
          apiError(404, { error: "not-found", message: "Not found" }),
        ),
    })
    renderApp("/account", api)

    await userEvent.click(
      await screen.findByRole("button", { name: "Sign out" }),
    )
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Sign-in is not available on this installation yet.",
    )
  })
})
