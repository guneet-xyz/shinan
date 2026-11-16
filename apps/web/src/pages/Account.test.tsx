import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import {
  account,
  apiError,
  currentPath,
  fakeApi,
  reauthenticationRequired,
  renderApp,
  signedOut,
  workspaceId,
} from "../test/render"

vi.mock("../navigation", () => ({ leaveApp: vi.fn() }))

describe("your account", () => {
  it("shows the profile and workspaces with roles", async () => {
    renderApp("/account")

    expect(
      await screen.findByRole("heading", { name: "Your account" }),
    ).toBeTruthy()
    expect(screen.getAllByText("guneet@example.com")).toHaveLength(2)
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

  it("says when signing out is not available", async () => {
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
      "Sign-in is not available on this installation.",
    )
  })
})

describe("sign-in methods, sessions and invitations", () => {
  it("adds GitHub after signing in again, and removes it", async () => {
    const { leaveApp } = await import("../navigation")
    const api = fakeApi({
      addGitHub: () =>
        Promise.resolve({ url: "https://github.com/login/oauth/authorize" }),
    })
    renderApp("/account", api)

    await userEvent.click(
      await screen.findByRole("button", { name: "Add GitHub" }),
    )
    expect(api.addGitHub).toHaveBeenCalledWith({ callbackURL: "/account" })
    expect(leaveApp).toHaveBeenCalledWith(
      "https://github.com/login/oauth/authorize",
    )

    const linked = fakeApi({
      account: () =>
        Promise.resolve({
          ...account,
          signInMethods: {
            ...account.signInMethods,
            github: {
              accountId: "1",
              login: "guneet-gh",
              addedAt: "2026-11-02T10:00:00.000Z",
            },
          },
        }),
      removeGitHub: () => Promise.resolve(undefined),
    })
    renderApp("/account", linked)
    expect(await screen.findByText(/@guneet-gh/)).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Remove GitHub" }))
    expect(linked.removeGitHub).toHaveBeenCalled()
  })

  it("asks to sign in again when adding GitHub needs it", async () => {
    const api = fakeApi({
      addGitHub: () => Promise.reject(reauthenticationRequired()),
    })
    renderApp("/account", api)

    await userEvent.click(
      await screen.findByRole("button", { name: "Add GitHub" }),
    )
    expect(
      await screen.findByRole("dialog", { name: "Sign in again to continue" }),
    ).toBeTruthy()
  })

  it("lists sign-in sessions and ends them", async () => {
    const api = fakeApi({
      signInSessions: () =>
        Promise.resolve([
          {
            id: "s1",
            createdAt: "2026-11-16T10:00:00.000Z",
            lastActiveAt: "2026-11-16T10:30:00.000Z",
            expiresAt: "2026-11-16T11:30:00.000Z",
            networkAddress: "192.0.2.1",
            client: "Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0",
            browser: "Firefox on Linux",
            current: true,
          },
          {
            id: "s2",
            createdAt: "2026-11-15T10:00:00.000Z",
            lastActiveAt: "2026-11-15T10:30:00.000Z",
            expiresAt: "2026-11-15T11:30:00.000Z",
            networkAddress: null,
            client: "Mozilla/5.0 (iPhone) Safari/604.1",
            browser: "Safari on iOS",
            current: false,
          },
        ]),
      endSignInSession: () => Promise.resolve(undefined),
      signOutEverywhere: () => Promise.resolve(undefined),
    })
    renderApp("/account", api)

    expect(await screen.findByText("This browser")).toBeTruthy()
    const ends = screen.getAllByRole("button", { name: "End this session" })
    expect(ends).toHaveLength(1)
    await userEvent.click(ends[0]!)
    expect(api.endSignInSession).toHaveBeenCalledWith("s2")

    await userEvent.click(
      screen.getByRole("button", { name: "Sign out everywhere" }),
    )
    expect(api.signOutEverywhere).toHaveBeenCalled()
  })

  it("lists pending invitations to accept or decline", async () => {
    const api = fakeApi({
      invitationsForYou: () =>
        Promise.resolve([
          {
            id: "i1",
            workspaceId: "w2",
            workspaceName: "Other team",
            invitedByHandle: "sam",
            role: "contributor",
            expiresAt: "2026-11-23T10:00:00.000Z",
          },
        ]),
      acceptInvitationById: () =>
        Promise.resolve({ workspaceId: "w2", memberId: "m2" }),
    })
    renderApp("/account", api)

    expect(
      await screen.findByRole("heading", { name: "Pending invitations" }),
    ).toBeTruthy()
    await userEvent.click(await screen.findByRole("button", { name: "Accept" }))
    expect(api.acceptInvitationById).toHaveBeenCalledWith("i1")
  })

  it("explains a GitHub account that could not be added", async () => {
    renderApp("/account?error=account_already_linked_to_different_user")

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /GitHub could not be added/,
    )
  })
})
