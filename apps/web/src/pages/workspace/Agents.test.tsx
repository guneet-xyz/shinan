import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import type { Agent } from "@shinan/api-client"

import {
  agent,
  contributorMember,
  fakeApi,
  renderApp,
  workspace,
  workspaceId,
} from "../../test/render"

const path = `/w/${workspaceId}/settings/agents`

const samsAgent: Agent = {
  ...agent,
  id: "99999999-9999-4999-8999-999999999999",
  memberId: contributorMember.id,
  personId: contributorMember.personId,
  personHandle: contributorMember.handle,
  personName: contributorMember.name,
  handle: "claude-code-laptop",
  name: "Claude Code on Sam's laptop",
}

async function agentCard(name: string) {
  const strong = await screen.findByText(name, { selector: "strong" })
  return strong.closest("li")!
}

describe("the workspace agents screen", () => {
  it("shows owners every agent and who it acts for", async () => {
    renderApp(
      path,
      fakeApi({ agents: () => Promise.resolve([agent, samsAgent]) }),
    )

    expect(await screen.findByRole("link", { name: "Agents" })).toBeTruthy()
    const sams = await agentCard("Claude Code on Sam's laptop")
    expect(sams.textContent).toContain("Acts forSam (sam)")
    // Another member's agent: disable and revoke only.
    expect(
      within(sams)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Revoke token…", "Disable…"])
    const own = await agentCard("OpenCode on Daedalus")
    expect(within(own).getByRole("button", { name: "Rename" })).toBeTruthy()
  })

  it("lets an owner disable another member's agent", async () => {
    const api = fakeApi({
      agents: () => Promise.resolve([samsAgent]),
      disableAgent: () =>
        Promise.resolve({ ...samsAgent, enabled: false, token: null }),
    })
    renderApp(path, api)

    const sams = await agentCard("Claude Code on Sam's laptop")
    await userEvent.click(
      within(sams).getByRole("button", { name: "Disable…" }),
    )
    await userEvent.click(
      within(sams).getByRole("button", { name: "Disable agent" }),
    )
    expect(api.disableAgent).toHaveBeenCalledWith(workspaceId, samsAgent.id)
    await waitFor(() => expect(api.agents).toHaveBeenCalledTimes(2))
  })

  it("is not a tab for contributors", async () => {
    renderApp(
      `/w/${workspaceId}/settings/members`,
      fakeApi({
        workspace: () => Promise.resolve({ ...workspace, role: "contributor" }),
      }),
    )
    expect(await screen.findByRole("link", { name: "Members" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Agents" })).toBeNull()
  })
})
