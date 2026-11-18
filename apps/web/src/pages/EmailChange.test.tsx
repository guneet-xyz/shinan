import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import type { Account } from "@shinan/api-client"

import {
  account,
  apiError,
  fakeApi,
  reauthenticationRequired,
  renderApp,
  signedOut,
} from "../test/render"

const pending: NonNullable<Account["pendingEmailChange"]> = {
  email: "new@example.com",
  expiresAt: "2026-11-18T12:00:00.000Z",
}
const waiting: Account = { ...account, pendingEmailChange: pending }

describe("changing the email address on Your account", () => {
  it("asks for the new address and sends the link", async () => {
    let current: Account = account
    const api = fakeApi({
      account: () => Promise.resolve(current),
      requestEmailChange: (email) => {
        current = { ...account, pendingEmailChange: { ...pending, email } }
        return Promise.resolve({ ...pending, email })
      },
    })
    renderApp("/account", api)

    await userEvent.click(
      await screen.findByRole("button", { name: "Change email address" }),
    )
    await userEvent.type(
      screen.getByLabelText("New email address"),
      "new@example.com",
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Send confirmation link" }),
    )
    expect(api.requestEmailChange).toHaveBeenCalledWith("new@example.com")
    expect(
      (await screen.findByText(/Waiting for confirmation/)).textContent,
    ).toContain("new@example.com")
  })

  it("asks to sign in again first when the sign-in is not recent", async () => {
    renderApp(
      "/account",
      fakeApi({
        requestEmailChange: () => Promise.reject(reauthenticationRequired()),
      }),
    )
    await userEvent.click(
      await screen.findByRole("button", { name: "Change email address" }),
    )
    await userEvent.type(
      screen.getByLabelText("New email address"),
      "new@example.com",
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Send confirmation link" }),
    )
    expect(
      await screen.findByRole("dialog", { name: "Sign in again to continue" }),
    ).toBeTruthy()
  })

  it("shows why an address is refused", async () => {
    renderApp(
      "/account",
      fakeApi({
        requestEmailChange: () =>
          Promise.reject(
            apiError(409, {
              error: "conflict",
              message:
                "That address is not on the email allowlist. Ask an installation operator to add it first",
            }),
          ),
      }),
    )
    await userEvent.click(
      await screen.findByRole("button", { name: "Change email address" }),
    )
    await userEvent.type(
      screen.getByLabelText("New email address"),
      "else@example.com",
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Send confirmation link" }),
    )
    expect(await screen.findByText(/not on the email allowlist/)).toBeTruthy()
  })

  it("cancels a waiting change", async () => {
    let current: Account = waiting
    const api = fakeApi({
      account: () => Promise.resolve(current),
      cancelEmailChange: () => {
        current = account
        return Promise.resolve()
      },
    })
    renderApp("/account", api)
    await userEvent.click(
      await screen.findByRole("button", { name: "Cancel the change" }),
    )
    expect(api.cancelEmailChange).toHaveBeenCalled()
    expect(
      await screen.findByRole("button", { name: "Change email address" }),
    ).toBeTruthy()
  })
})

describe("the link sent to the new address", () => {
  it("asks to sign in first, keeping the token out of the address", async () => {
    renderApp(
      "/email-change#secret-token",
      fakeApi({ account: () => Promise.reject(signedOut()) }),
    )
    const signIn = await screen.findByRole("link", { name: "Sign in" })
    expect(signIn.getAttribute("href")).not.toContain("secret-token")
  })

  it("confirms the change for the person who asked", async () => {
    const api = fakeApi({
      account: () => Promise.resolve(waiting),
      confirmEmailChange: () => Promise.resolve({ email: pending.email }),
    })
    renderApp("/email-change#secret-token", api)
    await userEvent.click(
      await screen.findByRole("button", { name: "Confirm new address" }),
    )
    expect(api.confirmEmailChange).toHaveBeenCalledWith("secret-token")
    expect(
      await screen.findByRole("heading", {
        name: "Your email address is now new@example.com",
      }),
    ).toBeTruthy()
  })

  it("explains a link that does not work for this account", async () => {
    renderApp(
      "/email-change#secret-token",
      fakeApi({ account: () => Promise.resolve(account) }),
    )
    await waitFor(() =>
      expect(
        screen.getByText(/does not work for the account you are signed in to/),
      ).toBeTruthy(),
    )
    expect(
      screen.queryByRole("button", { name: "Confirm new address" }),
    ).toBeNull()
  })
})
