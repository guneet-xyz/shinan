import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { currentPath, fakeApi, renderApp } from "../test/render"

describe("setting up OpenCode", () => {
  it("is linked from Your agents", async () => {
    renderApp(
      "/account/agents",
      fakeApi({ yourAgents: () => Promise.resolve([]) }),
    )
    await userEvent.click(
      await screen.findByRole("link", { name: "Set up OpenCode" }),
    )
    expect(currentPath()).toBe("/account/agents/setup")
    expect(
      await screen.findByRole("heading", { level: 1, name: "Set up OpenCode" }),
    ).toBeTruthy()
  })

  it("gives this installation's addresses and reads the token from a file", async () => {
    renderApp("/account/agents/setup")
    const origin = window.location.origin

    const config = (await screen.findByText(/"\$schema"/, { selector: "code" }))
      .textContent
    expect(JSON.parse(config)).toEqual({
      $schema: "https://opencode.ai/config.json",
      mcp: {
        servers: {
          shinan: {
            type: "remote",
            url: `${origin}/mcp`,
            oauth: false,
            headers: {
              Authorization: "Bearer {file:~/.config/shinan/token}",
            },
          },
        },
      },
      skills: [`${origin}/skills/`],
    })
    // The token is read without echo and written by a shell builtin into a
    // file only its user can read, never given on a command line.
    expect(
      screen.getByText(/umask 077/, { selector: "code" }).textContent,
    ).toBe(
      `bash -c 'umask 077; mkdir -p ~/.config/shinan && chmod 700 ~/.config/shinan && IFS= read -rs t && : > ~/.config/shinan/token && chmod 600 ~/.config/shinan/token && printf "%s\\n" "$t" > ~/.config/shinan/token'`,
    )
    expect(screen.getByText("opencode mcp list")).toBeTruthy()
  })

  it("copies the configuration", async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, "writeText")
    renderApp("/account/agents/setup")

    await user.click(
      await screen.findByRole("button", {
        name: "Copy OpenCode configuration",
      }),
    )
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining(`"url": "${window.location.origin}/mcp"`),
    )
    expect(
      await screen.findByRole("button", {
        name: "Copied OpenCode configuration",
      }),
    ).toBeTruthy()
  })
})
