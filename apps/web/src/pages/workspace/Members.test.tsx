import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import {
  account,
  apiError,
  contributorMember,
  fakeApi,
  ownerMember,
  reauthenticationRequired,
  renderApp,
  workspace,
  workspaceId,
} from "../../test/render"

const path = `/w/${workspaceId}/settings/members`

async function memberCard(name: string) {
  const strong = await screen.findByText(name, { selector: "strong" })
  return strong.closest("li")!
}

describe("the members screen", () => {
  it("lists each member with role, joined and who invited them", async () => {
    renderApp(path)

    const sam = await memberCard("Sam")
    expect(sam.textContent).toContain("sam")
    expect(sam.textContent).toContain("Contributor")
    expect(sam.textContent).toContain("Invited byguneet")
    const you = await memberCard("Guneet")
    expect(you.textContent).toContain("guneet (you)")
    expect(you.textContent).toContain("Nobody (created the workspace)")
  })

  it("lets a workspace owner change a role", async () => {
    const api = fakeApi({
      changeRole: () =>
        Promise.resolve({ ...contributorMember, role: "owner" }),
    })
    renderApp(path, api)

    await userEvent.click(
      within(await memberCard("Sam")).getByRole("button", {
        name: "Make workspace owner",
      }),
    )

    expect(api.changeRole).toHaveBeenCalledWith(
      workspaceId,
      contributorMember.id,
      "owner",
    )
    await waitFor(() => expect(api.members).toHaveBeenCalledTimes(2))
  })

  it("does not offer to lower or remove the last workspace owner", async () => {
    renderApp(path)

    const you = await memberCard("Guneet")
    expect(within(you).queryByRole("button")).toBeNull()
    expect(you.textContent).toContain(
      "The last workspace owner cannot be removed or made a contributor.",
    )
  })

  it("lists the consequences before removing a member", async () => {
    const api = fakeApi({ removeMember: () => Promise.resolve(undefined) })
    renderApp(path, api)

    const sam = await memberCard("Sam")
    await userEvent.click(within(sam).getByRole("button", { name: "Remove…" }))
    expect(sam.textContent).toContain(
      "They lose access to this workspace on their next request.",
    )
    expect(sam.textContent).toContain("does not remove their access on GitHub")
    expect(api.removeMember).not.toHaveBeenCalled()

    await userEvent.click(
      within(sam).getByRole("button", { name: "Remove Sam" }),
    )
    expect(api.removeMember).toHaveBeenCalledWith(
      workspaceId,
      contributorMember.id,
    )
  })

  it("asks the person to sign in again for sensitive actions", async () => {
    const api = fakeApi({
      changeRole: () => Promise.reject(reauthenticationRequired()),
      requestSignInLink: () => Promise.resolve(undefined),
    })
    renderApp(path, api)

    await userEvent.click(
      within(await memberCard("Sam")).getByRole("button", {
        name: "Make workspace owner",
      }),
    )
    const dialog = await screen.findByRole("dialog", {
      name: "Sign in again to continue",
    })
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Email me a sign-in link" }),
    )

    expect(api.requestSignInLink).toHaveBeenCalledWith({
      email: account.person.email,
      callbackURL: path,
    })
    expect(dialog.textContent).toContain("We sent a sign-in link to")
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("shows the rule a change broke", async () => {
    const otherOwner = { ...contributorMember, role: "owner" as const }
    const api = fakeApi({
      members: () => Promise.resolve([ownerMember, otherOwner]),
      changeRole: () =>
        Promise.reject(
          apiError(409, {
            error: "conflict",
            message: "A workspace always has at least one workspace owner",
            rule: "last-owner",
          }),
        ),
    })
    renderApp(path, api)

    await userEvent.click(
      within(await memberCard("Sam")).getByRole("button", {
        name: "Make contributor",
      }),
    )
    expect((await screen.findByRole("alert")).textContent).toBe(
      "A workspace always has at least one workspace owner",
    )
  })

  it("offers contributors no actions and no invitations", async () => {
    const api = fakeApi({
      workspace: () => Promise.resolve({ ...workspace, role: "contributor" }),
    })
    renderApp(path, api)

    await memberCard("Sam")
    expect(screen.queryByRole("button", { name: /Make|Remove/ })).toBeNull()
    const tabs = screen.getByRole("navigation", { name: "Workspace settings" })
    expect(
      within(tabs)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual(["General", "Members", "Security log"])
  })
})
