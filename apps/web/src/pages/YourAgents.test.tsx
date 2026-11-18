import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { Agent, IssuedAgentToken } from "@shinan/api-client"

import {
  agent,
  fakeApi,
  reauthenticationRequired,
  renderApp,
  workspaceId,
} from "../test/render"

const issued: IssuedAgentToken = {
  agent,
  token: `shinan_agent_${"x".repeat(43)}`,
  agentCreated: true,
  replacedToken: false,
}

async function agentCard(name: string) {
  const strong = await screen.findByText(name, { selector: "strong" })
  return strong.closest("li")!
}

describe("your agents", () => {
  it("lists agents with their last use first", async () => {
    const stale: Agent = {
      ...agent,
      id: "88888888-8888-4888-8888-888888888888",
      handle: "codex-takezo",
      name: "Codex on Takezo",
      token: {
        ...agent.token!,
        access: "read-only",
        lastUsedAt: null,
        lastNetworkAddress: null,
        unused: true,
      },
    }
    renderApp(
      "/account/agents",
      fakeApi({ yourAgents: () => Promise.resolve([agent, stale]) }),
    )

    const card = await agentCard("OpenCode on Daedalus")
    expect(card.textContent).toContain("Full token")
    expect(card.textContent).toMatch(/Last used .* from 203\.0\.113\.7/)
    expect(card.textContent).toContain("WorkspaceTeam")
    expect(card.textContent).toContain("Requests1,234")
    const old = await agentCard("Codex on Takezo")
    expect(old.textContent).toContain("Read-only token")
    expect(old.textContent).toContain("Never used")
    expect(old.textContent).toContain("Unused for 30 days")
  })

  it("creates a token by hand and shows it once", async () => {
    const api = fakeApi({
      yourAgents: () => Promise.resolve([]),
      createAgentToken: () => Promise.resolve(issued),
    })
    renderApp("/account/agents", api)

    expect(await screen.findByText(/You have no agents yet/)).toBeTruthy()
    await userEvent.type(screen.getByLabelText("Machine"), "Daedalus")
    await userEvent.selectOptions(screen.getByLabelText("Access"), "read-only")
    await userEvent.click(screen.getByRole("button", { name: "Create token" }))

    expect(api.createAgentToken).toHaveBeenCalledWith(workspaceId, {
      codingTool: "opencode",
      machine: "Daedalus",
      name: "OpenCode on Daedalus",
      access: "read-only",
    })
    const shown = await screen.findByLabelText("Agent token")
    expect((shown as HTMLInputElement).value).toBe(issued.token)
    expect(
      screen.getByText(/It will not be shown again/).textContent,
    ).toBeTruthy()
    // The setup guide opens beside it, so the token stays on screen.
    const guide = screen.getByRole("link", {
      name: "How to set up OpenCode (opens in a new tab)",
    })
    expect(guide.getAttribute("href")).toBe("/account/agents/setup")
    expect(guide.getAttribute("target")).toBe("_blank")
    await waitFor(() => expect(api.yourAgents).toHaveBeenCalledTimes(2))

    await userEvent.click(screen.getByRole("button", { name: "Done" }))
    expect(screen.queryByLabelText("Agent token")).toBeNull()
  })

  it("takes another coding tool by name", async () => {
    const api = fakeApi({
      yourAgents: () => Promise.resolve([]),
      createAgentToken: () => Promise.resolve(issued),
    })
    renderApp("/account/agents", api)

    await userEvent.selectOptions(
      await screen.findByLabelText("Coding tool"),
      "other",
    )
    await userEvent.type(
      screen.getByLabelText("Name of the coding tool"),
      "Aider",
    )
    await userEvent.type(screen.getByLabelText("Machine"), "Musashi")
    await userEvent.type(screen.getByLabelText("Name (optional)"), "Mine")
    await userEvent.click(screen.getByRole("button", { name: "Create token" }))
    expect(api.createAgentToken).toHaveBeenCalledWith(workspaceId, {
      codingTool: "Aider",
      machine: "Musashi",
      name: "Mine",
      access: "full",
    })
  })

  it("asks to sign in again before making a token", async () => {
    const api = fakeApi({
      yourAgents: () => Promise.resolve([]),
      createAgentToken: () => Promise.reject(reauthenticationRequired()),
    })
    renderApp("/account/agents", api)

    await userEvent.type(await screen.findByLabelText("Machine"), "Daedalus")
    await userEvent.click(screen.getByRole("button", { name: "Create token" }))
    expect(
      await screen.findByRole("heading", { name: "Sign in again to continue" }),
    ).toBeTruthy()
  })

  it("revokes a token after saying what it does", async () => {
    const api = fakeApi({
      yourAgents: () => Promise.resolve([agent]),
      revokeAgentToken: () => Promise.resolve({ ...agent, token: null }),
    })
    renderApp("/account/agents", api)

    const card = await agentCard("OpenCode on Daedalus")
    await userEvent.click(
      within(card).getByRole("button", { name: "Revoke token…" }),
    )
    expect(card.textContent).toContain(
      "Its current token stops working on its next request.",
    )
    expect(card.textContent).toContain("is not affected")
    await userEvent.click(
      within(card).getByRole("button", { name: "Revoke token" }),
    )
    expect(api.revokeAgentToken).toHaveBeenCalledWith(workspaceId, agent.id)
    await waitFor(() => expect(api.yourAgents).toHaveBeenCalledTimes(2))
  })

  it("renames, disables and enables", async () => {
    const disabled: Agent = {
      ...agent,
      enabled: false,
      disabledAt: "2026-11-17T10:00:00.000Z",
      token: null,
    }
    const api = fakeApi({
      yourAgents: vi
        .fn()
        .mockResolvedValueOnce([agent])
        .mockResolvedValueOnce([agent])
        .mockResolvedValue([disabled]),
      renameAgent: () => Promise.resolve({ ...agent, name: "Main" }),
      disableAgent: () => Promise.resolve(disabled),
      enableAgent: () => Promise.resolve(agent),
    })
    renderApp("/account/agents", api)

    let card = await agentCard("OpenCode on Daedalus")
    await userEvent.click(within(card).getByRole("button", { name: "Rename" }))
    const input = within(card).getByLabelText("New name for opencode-daedalus")
    await userEvent.clear(input)
    await userEvent.type(input, "Main")
    await userEvent.click(within(card).getByRole("button", { name: "Save" }))
    expect(api.renameAgent).toHaveBeenCalledWith(workspaceId, agent.id, "Main")

    card = await agentCard("OpenCode on Daedalus")
    await userEvent.click(
      within(card).getByRole("button", { name: "Disable…" }),
    )
    expect(card.textContent).toContain(
      "No new token can be made for it until it is enabled.",
    )
    await userEvent.click(
      within(card).getByRole("button", { name: "Disable agent" }),
    )
    expect(api.disableAgent).toHaveBeenCalledWith(workspaceId, agent.id)

    await waitFor(() =>
      expect(screen.getByText("Disabled", { selector: "span" })).toBeTruthy(),
    )
    card = await agentCard("OpenCode on Daedalus")
    expect(within(card).queryByRole("button", { name: /token/ })).toBeNull()
    await userEvent.click(within(card).getByRole("button", { name: "Enable" }))
    expect(api.enableAgent).toHaveBeenCalledWith(workspaceId, agent.id)
  })

  it("replaces a token with one of the same kind and shows it", async () => {
    const api = fakeApi({
      yourAgents: () => Promise.resolve([agent]),
      issueAgentToken: () =>
        Promise.resolve({
          ...issued,
          agentCreated: false,
          replacedToken: true,
        }),
    })
    renderApp("/account/agents", api)

    const card = await agentCard("OpenCode on Daedalus")
    await userEvent.click(
      within(card).getByRole("button", { name: "Replace token…" }),
    )
    expect(card.textContent).toContain(
      "Its current token stops working on its next request.",
    )
    expect(api.issueAgentToken).not.toHaveBeenCalled()
    await userEvent.click(
      within(card).getByRole("button", { name: "Replace token" }),
    )
    expect(api.issueAgentToken).toHaveBeenCalledWith(
      workspaceId,
      agent.id,
      "full",
    )
    expect(
      await screen.findByText(/The agent's previous token stopped working/),
    ).toBeTruthy()
  })
})
