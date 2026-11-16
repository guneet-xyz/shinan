import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import type { SecurityLogEntry } from "@shinan/api-client"

import { fakeApi, renderApp, workspace, workspaceId } from "../../test/render"

const path = `/w/${workspaceId}/settings/security-log`

function entry(id: number, changes: Partial<SecurityLogEntry> = {}) {
  const base: SecurityLogEntry = {
    id,
    occurredAt: "2026-11-15T10:00:00.000Z",
    action: "member.role-changed",
    outcome: "succeeded",
    actorKind: "person",
    actorPersonId: "22222222-2222-4222-8222-222222222222",
    actorAgentId: null,
    actorAgentSessionId: null,
    actorLabel: "guneet",
    confidence: "recorded",
    subjectPersonId: "55555555-5555-4555-8555-555555555555",
    subjectHandle: "sam",
    networkAddress: "192.0.2.10",
    client: "Firefox",
    details: { from: "contributor", to: "owner" },
  }
  return { ...base, ...changes }
}

describe("the security log screen", () => {
  it("shows entries newest first and reads older pages", async () => {
    const api = fakeApi({
      securityLog: (_id, page) =>
        Promise.resolve(
          page?.before === undefined
            ? { entries: [entry(9)], next: 9 }
            : {
                entries: [
                  entry(4, {
                    action: "request.refused",
                    outcome: "refused",
                    actorLabel: "guneet via opencode-daedalus",
                    actorKind: "agent",
                    subjectHandle: null,
                    details: { action: "member.remove", reason: "people-only" },
                  }),
                ],
                next: null,
              },
        ),
    })
    renderApp(path, api)

    const first = (await screen.findByText("Changed a member's role")).closest(
      "li",
    )!
    expect(first.textContent).toContain("Succeeded")
    expect(first.textContent).toContain("Aboutsam")
    expect(first.textContent).toContain("From192.0.2.10")
    expect(first.textContent).toContain("ClientFirefox")
    expect(first.textContent).toContain("fromcontributortoowner")

    await userEvent.click(
      screen.getByRole("button", { name: "Show older entries" }),
    )
    expect(api.securityLog).toHaveBeenLastCalledWith(workspaceId, { before: 9 })
    const refused = (await screen.findByText("Request refused")).closest("li")!
    expect(within(refused).getByText("Refused")).toBeTruthy()
    expect(refused.textContent).toContain("guneet via opencode-daedalus")
    expect(refused.textContent).toContain("reasonpeople-only")
    expect(
      screen.queryByRole("button", { name: "Show older entries" }),
    ).toBeNull()
    expect(within(first.parentElement!).getAllByRole("listitem")).toHaveLength(
      2,
    )
  })

  it("tells contributors they see only their own entries", async () => {
    const api = fakeApi({
      workspace: () => Promise.resolve({ ...workspace, role: "contributor" }),
      securityLog: () =>
        Promise.resolve({
          entries: [entry(3, { networkAddress: null, client: null })],
          next: null,
        }),
    })
    renderApp(path, api)

    expect(
      await screen.findByText(/You see the entries you made and the entries/),
    ).toBeTruthy()
    const card = (await screen.findByText("Changed a member's role")).closest(
      "li",
    )!
    expect(card.textContent).not.toContain("From")
    expect(card.textContent).not.toContain("Client")
  })
})
