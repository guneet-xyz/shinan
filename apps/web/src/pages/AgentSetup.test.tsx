import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { setupCommand } from "@shinan/skill/setup"

import {
  agent,
  currentPath,
  fakeApi,
  renderApp,
  workspaceId,
} from "../test/render"

const other = {
  ...agent,
  id: "88888888-8888-4888-8888-888888888888",
  handle: "claude-code-laptop",
  name: "Claude Code on Laptop",
}

describe("setting up an agent", () => {
  it("is linked from Your agents", async () => {
    renderApp(
      "/account/agents",
      fakeApi({ yourAgents: () => Promise.resolve([]) }),
    )
    await userEvent.click(
      await screen.findByRole("link", { name: "Set up an agent" }),
    )
    expect(currentPath()).toBe("/account/agents/setup")
    expect(
      await screen.findByRole("heading", { level: 1, name: "Set up an agent" }),
    ).toBeTruthy()
  })

  it("takes four steps, with one command to run on the machine", async () => {
    renderApp(
      "/account/agents/setup",
      fakeApi({ yourAgents: () => Promise.resolve([agent]) }),
    )
    const origin = window.location.origin
    await screen.findByText(/opencode-daedalus/, { selector: "pre code" })
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual([
      "1. Create a token for this machine",
      "2. Run one command on the machine",
      "3. Add Shinan to OpenCode",
      "4. Check it",
      "Keep the token safe",
    ])
    // The command is the tested one (packages/skill), for this
    // installation, workspace and agent.
    expect(
      screen.getByText(/git clone/, { selector: "pre code" }).textContent,
    ).toBe(
      setupCommand({
        origin,
        workspaceId,
        by: "guneet via opencode-daedalus",
      }),
    )
    // The person copies the command first, then the token.
    expect(
      screen.getByText(/when it asks, go back to the token, copy it/),
    ).toBeTruthy()
    const config = screen.getByText(/"\$schema"/, {
      selector: "code",
    }).textContent
    expect(JSON.parse(config)).toEqual({
      $schema: "https://opencode.ai/config.json",
      skills: [`${origin}/skills/`],
      permissions: [
        { action: "read", resource: "~/.config/shinan/*", effect: "deny" },
      ],
    })
    // Nothing about MCP or headers, except removing an old MCP entry.
    expect(document.body.textContent).not.toMatch(/Authorization|Bearer/)
    // How each step works is there, folded.
    expect(screen.getAllByText("What does this do?")).toHaveLength(3)
  })

  it("fills in the agent the token was made for", async () => {
    renderApp(
      `/account/agents/setup?agent=${other.id}`,
      fakeApi({ yourAgents: () => Promise.resolve([agent, other]) }),
    )
    const command = await screen.findByText(/claude-code-laptop/, {
      selector: "pre code",
    })
    expect(command.textContent).toContain(`/git/${workspaceId}.git`)
    // One workspace: the picker names only the agents.
    expect(
      screen.getByRole("option", {
        name: "Claude Code on Laptop (claude-code-laptop)",
      }),
    ).toBeTruthy()
    await userEvent.selectOptions(screen.getByLabelText("Agent"), agent.id)
    expect(
      (await screen.findByText(/git clone/, { selector: "pre code" }))
        .textContent,
    ).toContain('"guneet via opencode-daedalus"')
  })

  it("copies the configuration", async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, "writeText")
    renderApp(
      "/account/agents/setup",
      fakeApi({ yourAgents: () => Promise.resolve([]) }),
    )

    await user.click(
      await screen.findByRole("button", {
        name: "Copy OpenCode configuration",
      }),
    )
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining(`"${window.location.origin}/skills/"`),
    )
    expect(
      await screen.findByRole("button", {
        name: "Copied OpenCode configuration",
      }),
    ).toBeTruthy()
  })
})
