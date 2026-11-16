import { describe, expect, it } from "vitest"

import {
  invitationEmail,
  magicLinkEmail,
  securityAlertEmail,
} from "./templates.js"

const at = new Date("2026-11-16T17:43:12Z")

describe("magicLinkEmail", () => {
  it("says the link works once and when it expires", () => {
    const email = magicLinkEmail({
      installationName: "Shinan",
      link: "https://shinan.guneet.dev/sign-in/link?token=abc",
      expiresInMinutes: 15,
    })

    expect(email.subject).toBe("Sign in to Shinan")
    expect(email.text).toContain("It works once and expires in 15 minutes.")
    expect(email.text).toContain(
      "\n\nhttps://shinan.guneet.dev/sign-in/link?token=abc\n\n",
    )
    expect(email.html).toContain(
      '<a href="https://shinan.guneet.dev/sign-in/link?token=abc">Sign in to Shinan</a>',
    )
  })

  it("refuses links that are not web links", () => {
    for (const link of [
      "javascript:alert(1)",
      "/relative",
      "data:text/html,x",
    ]) {
      expect(() =>
        magicLinkEmail({
          installationName: "Shinan",
          link,
          expiresInMinutes: 15,
        }),
      ).toThrow(/link/)
    }
  })
})

describe("invitationEmail", () => {
  it("names the inviter, workspace, role and expiry", () => {
    const email = invitationEmail({
      installationName: "Shinan",
      workspaceName: "Guneet's infrastructure",
      invitedBy: "guneet",
      role: "contributor",
      link: "https://shinan.guneet.dev/invitations/123",
      expiresAt: at,
    })

    expect(email.subject).toBe(
      "guneet invited you to Guneet's infrastructure on Shinan",
    )
    expect(email.text).toContain(
      `guneet invited you to join the workspace "Guneet's infrastructure" on Shinan as a contributor.`,
    )
    expect(email.text).toContain("expires on 2026-11-16 17:43 UTC")
    expect(email.html).toContain("Guneet&#39;s infrastructure")
  })

  it("keeps names from outside on one line and escaped", () => {
    const email = invitationEmail({
      installationName: "Shinan",
      workspaceName: "<script>alert(1)</script>\r\nBcc: x@example.com",
      invitedBy: "guneet",
      role: "owner",
      link: "https://shinan.guneet.dev/invitations/123",
      expiresAt: at,
    })

    expect(email.subject).not.toMatch(/[\r\n]/)
    expect(email.html).not.toContain("<script>")
    expect(email.html).toContain("&lt;script&gt;")
    expect(email.text).toContain("as a workspace owner")
  })
})

describe("securityAlertEmail", () => {
  const base = {
    installationName: "Shinan",
    accountLink: "https://shinan.guneet.dev/account",
  }

  it("covers each alert identity names", () => {
    const subjects = [
      securityAlertEmail({
        ...base,
        alert: { kind: "new-browser-sign-in", client: "Firefox on Linux", at },
      }),
      securityAlertEmail({
        ...base,
        alert: { kind: "github-added", githubLogin: "guneet", at },
      }),
      securityAlertEmail({
        ...base,
        alert: { kind: "github-removed", githubLogin: "guneet", at },
      }),
      securityAlertEmail({
        ...base,
        alert: {
          kind: "agent-token-approved",
          agentHandle: "opencode-daedalus",
          workspaceName: "Infrastructure",
          at,
        },
      }),
    ].map((email) => {
      expect(email.text).toContain("2026-11-16 17:43 UTC")
      expect(email.text).toContain("https://shinan.guneet.dev/account")
      return email.subject
    })

    expect(subjects).toEqual([
      "New sign-in to Shinan",
      "GitHub sign-in added to your Shinan account",
      "GitHub sign-in removed from your Shinan account",
      "Agent token approved for opencode-daedalus",
    ])
  })

  it("shortens a long browser description", () => {
    const email = securityAlertEmail({
      ...base,
      alert: { kind: "new-browser-sign-in", client: "x".repeat(1000), at },
    })
    expect(email.text).not.toContain("x".repeat(201))
    expect(email.text).toContain("…")
  })
})
