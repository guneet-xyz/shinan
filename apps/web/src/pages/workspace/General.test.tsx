import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import {
  apiError,
  contributorMember,
  currentPath,
  fakeApi,
  ownerMember,
  renderApp,
  workspace,
  workspaceId,
} from "../../test/render"

const path = `/w/${workspaceId}/settings/general`

describe("the general settings screen", () => {
  it("shows the workspace's details and owners", async () => {
    renderApp(path)

    const owners = await screen.findByText("Guneet (guneet)")
    expect(owners.tagName).toBe("DD")
    expect(screen.getByText("Workspace owner", { selector: "dd" })).toBeTruthy()
  })

  it("lets a workspace owner rename it", async () => {
    const api = fakeApi({
      renameWorkspace: () => Promise.resolve({ ...workspace, name: "Crew" }),
    })
    renderApp(path, api)

    const name = await screen.findByLabelText("Name")
    await userEvent.clear(name)
    await userEvent.type(name, "Crew")
    await userEvent.click(screen.getByRole("button", { name: "Rename" }))

    expect(api.renameWorkspace).toHaveBeenCalledWith(workspaceId, "Crew")
    expect(await screen.findByText("Saved.")).toBeTruthy()
    // The workspace and the switcher show the new name.
    await waitFor(() => expect(api.workspace).toHaveBeenCalledTimes(2))
    expect(api.account).toHaveBeenCalledTimes(2)
  })

  it("shows contributors the name without a form", async () => {
    const api = fakeApi({
      workspace: () => Promise.resolve({ ...workspace, role: "contributor" }),
    })
    renderApp(path, api)

    expect(
      await screen.findByText("Contributor", { selector: "dd" }),
    ).toBeTruthy()
    expect(screen.queryByLabelText("Name")).toBeNull()
  })

  it("lets a member leave after confirming", async () => {
    const api = fakeApi({
      workspace: () => Promise.resolve({ ...workspace, role: "contributor" }),
      leaveWorkspace: () => Promise.resolve(undefined),
    })
    renderApp(path, api)

    await userEvent.click(
      await screen.findByRole("button", { name: "Leave workspace…" }),
    )
    expect(
      screen.getByText(/You will lose access to Team at once/),
    ).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Leave Team" }))

    expect(api.leaveWorkspace).toHaveBeenCalledWith(workspaceId)
    expect(await screen.findByText("You left Team.")).toBeTruthy()
    expect(currentPath()).toBe("/account")
  })

  it("does not offer Leave to the last workspace owner", async () => {
    renderApp(path)

    expect(
      await screen.findByText(/You are the only workspace owner/),
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Leave workspace…" }),
    ).toBeNull()
  })

  it("shows why leaving was refused", async () => {
    const api = fakeApi({
      // Another owner, who may have left meanwhile.
      members: () =>
        Promise.resolve([
          ownerMember,
          { ...contributorMember, role: "owner" as const },
        ]),
      leaveWorkspace: () =>
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
      await screen.findByRole("button", { name: "Leave workspace…" }),
    )
    await userEvent.click(screen.getByRole("button", { name: "Leave Team" }))
    expect((await screen.findByRole("alert")).textContent).toBe(
      "A workspace always has at least one workspace owner",
    )
    expect(currentPath()).toBe(path)
  })
})
