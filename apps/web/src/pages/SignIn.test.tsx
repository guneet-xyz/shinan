import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { leaveApp } from "../navigation"
import {
  apiError,
  currentPath,
  fakeApi,
  renderApp,
  signedOut,
} from "../test/render"

vi.mock("../navigation", () => ({ leaveApp: vi.fn() }))

function signedOutApi(overrides: Parameters<typeof fakeApi>[0] = {}) {
  return fakeApi({
    account: () => Promise.reject(signedOut()),
    installation: () =>
      Promise.resolve({
        name: "Guneet's Shinan",
        signInMethods: { github: true },
      }),
    ...overrides,
  })
}

describe("the sign-in page", () => {
  it("emails a link and gives the same answer for any address", async () => {
    const api = signedOutApi({
      requestSignInLink: () => Promise.resolve(undefined),
    })
    renderApp("/sign-in?next=%2Faccount", api)

    expect(
      await screen.findByRole("heading", {
        name: "Sign in to Guneet's Shinan",
      }),
    ).toBeTruthy()
    await userEvent.type(
      screen.getByLabelText("Email address"),
      " someone@example.com ",
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    )

    expect(api.requestSignInLink).toHaveBeenCalledWith({
      email: "someone@example.com",
      callbackURL: "/account",
    })
    const heading = await screen.findByRole("heading", {
      name: "Check your email",
    })
    expect(heading.parentElement!.textContent).toContain(
      "If someone@example.com can have an account here, we sent it a sign-in link.",
    )
  })

  it("starts GitHub sign-in", async () => {
    const api = signedOutApi({
      startGitHubSignIn: () =>
        Promise.resolve({ url: "https://github.com/login/oauth/authorize" }),
    })
    renderApp("/sign-in?next=%2Faccount", api)

    await userEvent.click(
      await screen.findByRole("button", { name: "Sign in with GitHub" }),
    )

    expect(api.startGitHubSignIn).toHaveBeenCalledWith({
      callbackURL: "/account",
    })
    await waitFor(() =>
      expect(leaveApp).toHaveBeenCalledWith(
        "https://github.com/login/oauth/authorize",
      ),
    )
  })

  it("only returns to addresses on this site", async () => {
    for (const next of ["%2F%2Fevil.example", "%2F%09%2Fevil.example"]) {
      const api = signedOutApi({
        startGitHubSignIn: () => Promise.resolve({ url: "https://github.com" }),
      })
      const { unmount } = renderApp(`/sign-in?next=${next}`, api)

      await userEvent.click(
        await screen.findByRole("button", { name: "Sign in with GitHub" }),
      )
      expect(api.startGitHubSignIn).toHaveBeenCalledWith({ callbackURL: "/" })
      unmount()
    }
  })

  it("explains a sign-in link that did not work", async () => {
    renderApp("/sign-in?error=INVALID_TOKEN", signedOutApi())

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /link may have expired or been used already/,
    )
  })

  it("says when sign-in is not available", async () => {
    const api = signedOutApi({
      requestSignInLink: () =>
        Promise.reject(
          apiError(404, { error: "not-found", message: "Not found" }),
        ),
    })
    renderApp("/sign-in", api)

    await userEvent.type(
      await screen.findByLabelText("Email address"),
      "someone@example.com",
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    )
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Sign-in is not available on this installation.",
    )
  })

  it("sends someone already signed in on", async () => {
    renderApp("/sign-in?next=%2Faccount")

    expect(
      await screen.findByRole("heading", { name: "Your account" }),
    ).toBeTruthy()
    expect(currentPath()).toBe("/account")
  })
})
