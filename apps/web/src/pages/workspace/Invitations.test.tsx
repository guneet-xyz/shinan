import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import type { Invitation } from "@shinan/api-client"

import {
  apiError,
  fakeApi,
  renderApp,
  workspace,
  workspaceId,
} from "../../test/render"

const path = `/w/${workspaceId}/settings/invitations`

const pending: Invitation = {
  id: "99999999-9999-4999-8999-999999999999",
  email: "new@example.com",
  role: "contributor",
  state: "pending",
  invitedByHandle: "guneet",
  createdAt: "2026-11-10T10:00:00.000Z",
  expiresAt: "2026-11-17T10:00:00.000Z",
}
const declined: Invitation = {
  ...pending,
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "no@example.com",
  state: "declined",
  createdAt: "2026-11-12T10:00:00.000Z",
}

describe("the invitations screen", () => {
  it("says plainly when the server has no invitations yet", async () => {
    const api = fakeApi({
      invitations: () =>
        Promise.reject(
          apiError(501, {
            error: "not-implemented",
            message: "Invitations are not available yet",
          }),
        ),
    })
    renderApp(path, api)

    expect(
      await screen.findByText(
        "Invitations are not available on this installation yet.",
      ),
    ).toBeTruthy()
  })

  it("lists pending invitations first, with their actions", async () => {
    const api = fakeApi({
      invitations: () => Promise.resolve([declined, pending]),
      withdrawInvitation: () => Promise.resolve(undefined),
    })
    renderApp(path, api)

    const sent = await screen.findAllByText(/@example.com/, {
      selector: "strong",
    })
    expect(sent.map((e) => e.textContent)).toEqual([
      "new@example.com",
      "no@example.com",
    ])
    const declinedCard = sent[1]!.closest("li")!
    expect(within(declinedCard).queryByRole("button")).toBeNull()

    const pendingCard = sent[0]!.closest("li")!
    await userEvent.click(
      within(pendingCard).getByRole("button", { name: "Withdraw" }),
    )
    expect(api.withdrawInvitation).toHaveBeenCalledWith(workspaceId, pending.id)
  })

  it("invites by email address and role", async () => {
    const api = fakeApi({
      invitations: () => Promise.resolve([]),
      invite: () => Promise.resolve(pending),
    })
    renderApp(path, api)

    expect(
      await screen.findByText(/Every member can read and change everything/),
    ).toBeTruthy()
    await userEvent.type(
      screen.getByLabelText("Email address"),
      "new@example.com",
    )
    await userEvent.selectOptions(screen.getByLabelText("Role"), "owner")
    await userEvent.click(
      screen.getByRole("button", { name: "Send invitation" }),
    )

    expect(api.invite).toHaveBeenCalledWith(workspaceId, {
      email: "new@example.com",
      role: "owner",
    })
    expect(
      await screen.findByText("Invitation sent to new@example.com."),
    ).toBeTruthy()
  })

  it("shows why an address cannot be invited", async () => {
    const message =
      "That address is not on the email allowlist. Ask an installation operator to add it first."
    const api = fakeApi({
      invitations: () => Promise.resolve([]),
      invite: () =>
        Promise.reject(
          apiError(422, {
            error: "invalid-input",
            message,
            rule: "not-allowlisted",
          }),
        ),
    })
    renderApp(path, api)

    await userEvent.type(
      await screen.findByLabelText("Email address"),
      "stranger@example.com",
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Send invitation" }),
    )
    expect((await screen.findByRole("alert")).textContent).toBe(message)
  })

  it("is for workspace owners only, without asking the server", async () => {
    const api = fakeApi({
      workspace: () => Promise.resolve({ ...workspace, role: "contributor" }),
    })
    renderApp(path, api)

    expect(
      await screen.findByText(
        "Only workspace owners invite people and manage invitations.",
      ),
    ).toBeTruthy()
    expect(api.invitations).not.toHaveBeenCalled()
  })
})
