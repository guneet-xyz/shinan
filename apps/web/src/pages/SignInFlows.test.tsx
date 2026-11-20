import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { InvitationForYou } from "@shinan/api-client"

import {
  account,
  apiError,
  currentPath,
  fakeApi,
  renderApp,
  signedOut,
  workspaceId,
} from "../test/render"

vi.mock("../navigation", () => ({ leaveApp: vi.fn() }))

const notFound = () =>
  apiError(404, { error: "not-found", message: "Not found" })

const invitation: InvitationForYou = {
  id: "66666666-6666-4666-8666-666666666666",
  workspaceId,
  workspaceName: "Team",
  invitedByHandle: "guneet",
  role: "contributor",
  expiresAt: "2026-11-23T10:00:00.000Z",
}

describe("the GitHub email step", () => {
  it("asks for the address and emails a link back to the same page", async () => {
    const api = fakeApi({
      account: () => Promise.reject(signedOut()),
      pendingGitHubSignIn: () => Promise.resolve({ login: "octo" }),
      requestSignInLink: () => Promise.resolve(undefined),
    })
    renderApp("/sign-in/github?next=%2Fw%2F1", api)

    expect(await screen.findByText("@octo")).toBeTruthy()
    await userEvent.type(
      screen.getByLabelText("Email address"),
      "me@example.com",
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    )
    expect(api.requestSignInLink).toHaveBeenCalledWith({
      email: "me@example.com",
      callbackURL: "/w/1",
      metadata: { github: true },
    })
    expect(
      await screen.findByRole("heading", { name: "Check your email" }),
    ).toBeTruthy()
  })

  it("says when the GitHub sign-in has expired", async () => {
    const api = fakeApi({
      account: () => Promise.reject(signedOut()),
      pendingGitHubSignIn: () => Promise.reject(notFound()),
    })
    renderApp("/sign-in/github", api)

    expect(await screen.findByText(/has expired/)).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Start again" }).getAttribute("href"),
    ).toBe("/sign-in")
  })
})

describe("the sign-in link page", () => {
  it("opens the link only when the person clicks, then goes on", async () => {
    const { leaveApp } = await import("../navigation")
    const api = fakeApi({
      account: () => Promise.reject(signedOut()),
      openSignInLink: () => Promise.resolve({ location: "/w/1" }),
    })
    renderApp("/sign-in/link#token=abc&next=%2Fw%2F1", api)

    const button = await screen.findByRole("button", {
      name: "Continue signing in",
    })
    expect(api.openSignInLink).not.toHaveBeenCalled()
    await userEvent.click(button)
    expect(api.openSignInLink).toHaveBeenCalledWith({
      token: "abc",
      next: "/w/1",
    })
    expect(leaveApp).toHaveBeenCalledWith("/w/1")
  })

  it("keeps the return path on this site", async () => {
    const api = fakeApi({
      account: () => Promise.reject(signedOut()),
      openSignInLink: () => Promise.resolve({ location: "/" }),
    })
    renderApp("/sign-in/link#token=abc&next=%2F%2Fevil.example", api)

    await userEvent.click(
      await screen.findByRole("button", { name: "Continue signing in" }),
    )
    expect(api.openSignInLink).toHaveBeenCalledWith({ token: "abc", next: "/" })
  })

  it("says when the link is incomplete", async () => {
    const api = fakeApi({ account: () => Promise.reject(signedOut()) })
    renderApp("/sign-in/link", api)

    expect(await screen.findByText(/link is incomplete/)).toBeTruthy()
  })
})

describe("creating a workspace", () => {
  it("is offered to someone with no workspace, who becomes its owner", async () => {
    const created = { ...account.workspaces[0]! }
    let workspaces: typeof account.workspaces = []
    const api = fakeApi({
      account: () => Promise.resolve({ ...account, workspaces }),
      createWorkspace: (name: string) => {
        workspaces = [created]
        return Promise.resolve({
          id: workspaceId,
          name,
          createdAt: "2026-11-16T10:00:00.000Z",
          role: "owner",
        })
      },
    })
    renderApp("/", api)

    await userEvent.type(
      await screen.findByLabelText("New workspace name"),
      "Team",
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Create workspace" }),
    )
    expect(api.createWorkspace).toHaveBeenCalledWith("Team")
    await waitFor(() => expect(currentPath()).toBe(`/w/${workspaceId}/catalog`))
  })
})

describe("the setup page", () => {
  it("sends the token from the address's fragment with the operator address", async () => {
    const api = fakeApi({
      account: () => Promise.reject(signedOut()),
      startSetup: () => Promise.resolve(undefined),
    })
    renderApp("/setup#the-token", api)

    await userEvent.type(
      await screen.findByLabelText("Operator email address"),
      "root@example.com",
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    )
    expect(api.startSetup).toHaveBeenCalledWith({
      token: "the-token",
      email: "root@example.com",
    })
    expect(
      await screen.findByRole("heading", { name: "Check your email" }),
    ).toBeTruthy()
  })

  it("explains a used or expired setup link", async () => {
    const api = fakeApi({ startSetup: () => Promise.reject(notFound()) })
    renderApp("/setup#old", api)

    await userEvent.type(
      await screen.findByLabelText("Operator email address"),
      "root@example.com",
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    )
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /Restart the server/,
    )
  })
})

describe("the invitation page", () => {
  it("shows only the installation's name before sign-in", async () => {
    const api = fakeApi({ account: () => Promise.reject(signedOut()) })
    renderApp("/invitation#secret-token", api)

    expect(
      await screen.findByRole("heading", { name: "Invitation to Shinan" }),
    ).toBeTruthy()
    expect(api.findInvitation).not.toHaveBeenCalled()
    expect(screen.queryByText("Team")).toBeNull()
    await userEvent.click(screen.getByRole("link", { name: "Sign in" }))
    // The token stays in this browser, out of the sign-in link's address.
    expect(currentPath()).toBe("/sign-in?next=%2Finvitation")
    expect(localStorage.getItem("shinan.invitation")).toBe("secret-token")
  })

  it("finds the kept token after sign-in, and forgets it once answered", async () => {
    localStorage.setItem("shinan.invitation", "kept-token")
    const api = fakeApi({
      findInvitation: () => Promise.resolve(invitation),
      declineInvitation: () => Promise.resolve(undefined),
    })
    renderApp("/invitation", api)

    await userEvent.click(
      await screen.findByRole("button", { name: "Decline" }),
    )
    expect(api.declineInvitation).toHaveBeenCalledWith("kept-token")
    expect(localStorage.getItem("shinan.invitation")).toBeNull()
  })

  it("lets the invited person accept, then offers to link GitHub", async () => {
    const api = fakeApi({
      findInvitation: () => Promise.resolve(invitation),
      acceptInvitation: () => Promise.resolve({ workspaceId, memberId: "m" }),
    })
    renderApp("/invitation#secret-token", api)

    expect(
      await screen.findByRole("heading", { name: "Join Team" }),
    ).toBeTruthy()
    expect(api.findInvitation).toHaveBeenCalledWith("secret-token")
    await userEvent.click(screen.getByRole("button", { name: "Accept" }))
    expect(api.acceptInvitation).toHaveBeenCalledWith("secret-token")
    expect(
      await screen.findByRole("heading", { name: "You joined Team" }),
    ).toBeTruthy()
    expect(screen.getByText(/Link your GitHub account/)).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Go to Team" }).getAttribute("href"),
    ).toBe(`/w/${workspaceId}`)
  })

  it("can be declined", async () => {
    const api = fakeApi({
      findInvitation: () => Promise.resolve(invitation),
      declineInvitation: () => Promise.resolve(undefined),
    })
    renderApp("/invitation#secret-token", api)

    await userEvent.click(
      await screen.findByRole("button", { name: "Decline" }),
    )
    expect(await screen.findByText("You declined the invitation.")).toBeTruthy()
  })

  it("explains a link that does not work for this account", async () => {
    const api = fakeApi({ findInvitation: () => Promise.reject(notFound()) })
    renderApp("/invitation#secret-token", api)

    expect(
      await screen.findByText(/cannot be opened with your account/),
    ).toBeTruthy()
  })
})

describe("installation settings", () => {
  const operatorAccount = { ...account, operator: true }

  it("let operators add and remove allowlisted addresses", async () => {
    const api = fakeApi({
      account: () => Promise.resolve(operatorAccount),
      allowlist: () =>
        Promise.resolve([
          {
            email: "guneet@example.com",
            addedAt: "2026-11-01T10:00:00.000Z",
            operator: true,
            handle: "guneet",
          },
          {
            email: "sam@example.com",
            addedAt: "2026-11-02T10:00:00.000Z",
            operator: false,
            handle: "sam",
          },
        ]),
      addToAllowlist: () => Promise.resolve(undefined),
      removeFromAllowlist: () => Promise.resolve(undefined),
    })
    renderApp("/installation", api)

    await userEvent.type(
      await screen.findByLabelText("Email address to allow"),
      "new@example.com",
    )
    await userEvent.click(screen.getByRole("button", { name: "Add address" }))
    expect(api.addToAllowlist).toHaveBeenCalledWith("new@example.com")

    // Only addresses that are not operators' can be removed.
    const removeButtons = await screen.findAllByRole("button", {
      name: "Remove…",
    })
    expect(removeButtons).toHaveLength(1)
    await userEvent.click(removeButtons[0]!)
    expect(screen.getByText(/sam is signed out everywhere/)).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Remove" }))
    expect(api.removeFromAllowlist).toHaveBeenCalledWith("sam@example.com")
  })

  it("are not offered to others", async () => {
    const api = fakeApi()
    renderApp("/installation", api)

    expect(await screen.findByText(/Only installation operators/)).toBeTruthy()
    expect(api.allowlist).not.toHaveBeenCalled()
  })
})
