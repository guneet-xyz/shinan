import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import {
  account,
  apiError,
  currentPath,
  fakeApi,
  renderApp,
  signedOut,
  workspaceId,
} from "./test/render"

describe("the app shell", () => {
  it("sends someone who is not signed in to sign in, then back", async () => {
    const api = fakeApi({ account: () => Promise.reject(signedOut()) })
    renderApp(`/w/${workspaceId}/settings/members`, api)

    expect(
      await screen.findByRole("heading", { name: "Sign in to Shinan" }),
    ).toBeTruthy()
    expect(currentPath()).toBe(
      `/sign-in?next=${encodeURIComponent(`/w/${workspaceId}/settings/members`)}`,
    )
  })

  it("needs sign-in even for unknown addresses", async () => {
    const api = fakeApi({ account: () => Promise.reject(signedOut()) })
    renderApp("/no/such/page", api)

    expect(
      await screen.findByRole("heading", { name: "Sign in to Shinan" }),
    ).toBeTruthy()
  })

  it("opens the person's first workspace", async () => {
    renderApp("/")

    // The catalog opens a workspace until the Now screen exists.
    expect(
      await screen.findByRole("heading", { name: "Your catalog is empty." }),
    ).toBeTruthy()
    await waitFor(() => expect(currentPath()).toBe(`/w/${workspaceId}/catalog`))
  })

  it("welcomes someone with no workspace", async () => {
    const api = fakeApi({
      account: () => Promise.resolve({ ...account, workspaces: [] }),
    })
    renderApp("/", api)

    expect(
      await screen.findByRole("heading", { name: "Welcome, Guneet" }),
    ).toBeTruthy()
    expect(screen.getByText(/needs an invitation/)).toBeTruthy()
  })

  it("lists the person's workspaces with their role", async () => {
    const api = fakeApi({
      account: () =>
        Promise.resolve({
          ...account,
          workspaces: [
            ...account.workspaces,
            {
              id: "66666666-6666-4666-8666-666666666666",
              name: "Other",
              role: "contributor",
              memberId: "77777777-7777-4777-8777-777777777777",
              joinedAt: "2026-11-03T10:00:00.000Z",
            },
          ],
        }),
    })
    renderApp(`/w/${workspaceId}/settings/general`, api)

    const sidebar = await screen.findByRole("complementary")
    await userEvent.click(
      await within(sidebar).findByRole("button", {
        name: /^Team\s*\(switch workspace\)$/,
      }),
    )
    const menu = await screen.findByRole("menu")
    const items = within(menu).getAllByRole("menuitem")
    expect(items.map((item) => item.textContent)).toEqual([
      "TeamWorkspace owner",
      "OtherContributor",
    ])
    expect(items[0]!.getAttribute("aria-current")).toBe("page")
    expect(items[1]!.getAttribute("href")).toBe(
      "/w/66666666-6666-4666-8666-666666666666",
    )

    await userEvent.click(items[1]!)
    await waitFor(() =>
      expect(currentPath()).toBe(
        "/w/66666666-6666-4666-8666-666666666666/catalog",
      ),
    )
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("answers not found for unknown pages", async () => {
    renderApp("/no/such/page")

    expect(
      await screen.findByRole("heading", { name: "Not found" }),
    ).toBeTruthy()
  })

  it("answers not found for a workspace the person cannot see", async () => {
    const api = fakeApi({
      workspace: () =>
        Promise.reject(
          apiError(404, { error: "not-found", message: "Not found" }),
        ),
    })
    renderApp("/w/88888888-8888-4888-8888-888888888888", api)

    expect(
      await screen.findByRole("heading", { name: "Not found" }),
    ).toBeTruthy()
  })

  it("shows a generic message when the server fails", async () => {
    const api = fakeApi({
      account: () =>
        Promise.reject(
          apiError(500, { error: "internal", message: "Something went wrong" }),
        ),
    })
    renderApp("/", api)

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Something went wrong. Try again in a moment.",
    )
  })

  it("shows a generic page when rendering fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const api = fakeApi({
      // A malformed answer makes the page throw while rendering.
      account: () => Promise.resolve({} as typeof account),
    })
    renderApp("/account", api)

    expect(
      await screen.findByRole("heading", { name: "Something went wrong" }),
    ).toBeTruthy()
    error.mockRestore()
  })
})
