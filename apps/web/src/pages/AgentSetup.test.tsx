import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

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
  workspaceId: "99999999-9999-4999-8999-999999999999",
  workspaceName: "Other",
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

  it("gives this installation's addresses, and clones with Git's credential helper", async () => {
    renderApp(
      "/account/agents/setup",
      fakeApi({ yourAgents: () => Promise.resolve([agent]) }),
    )
    const origin = window.location.origin

    // The token is read without echo and written by a shell builtin into a
    // file only its user can read, never given on a command line.
    expect(
      (await screen.findByText(/umask 077/, { selector: "code" })).textContent,
    ).toBe(
      `bash -c 'umask 077; mkdir -p ~/.config/shinan && chmod 700 ~/.config/shinan && IFS= read -rs t && : > ~/.config/shinan/token && chmod 600 ~/.config/shinan/token && printf "%s\\n" "$t" > ~/.config/shinan/token'`,
    )
    // The credential helper in the clone's own settings, after an empty
    // value that switches off every other helper for this address; it
    // answers only `get`, from the token file.
    expect(
      (await screen.findByText(/git clone/, { selector: "pre code" }))
        .textContent,
    ).toBe(
      [
        "GIT_TERMINAL_PROMPT=0 git clone \\",
        `  -c 'credential.${origin}.helper=' \\`,
        `  -c 'credential.${origin}.helper=!f() { test "$1" = get && printf "username=agent\\npassword=%s\\n" "$(cat ~/.config/shinan/token)"; }; f' \\`,
        `  ${origin}/git/${workspaceId}.git ~/shinan-catalog/main`,
        "git config --global shinan.catalog ~/shinan-catalog/main",
        "git config --global shinan.by 'guneet via opencode-daedalus'",
      ].join("\n"),
    )
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
  })

  it("fills in the agent the token was made for", async () => {
    renderApp(
      `/account/agents/setup?agent=${other.id}`,
      fakeApi({ yourAgents: () => Promise.resolve([agent, other]) }),
    )
    const clone = await screen.findByText(/claude-code-laptop/, {
      selector: "pre code",
    })
    expect(clone.textContent).toContain(`/git/${other.workspaceId}.git`)
    await userEvent.selectOptions(screen.getByLabelText("Agent"), agent.id)
    expect(
      (await screen.findByText(/git clone/, { selector: "pre code" }))
        .textContent,
    ).toContain("'guneet via opencode-daedalus'")
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
