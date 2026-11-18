import { describe, expect, it } from "vitest"

import { agentTokenPrefix } from "../../tokens.js"
import { findSecrets } from "./secrets.js"

const kinds = (text: string) =>
  findSecrets(text).map((f) => [f.severity, f.kind])

describe("the check for secret-looking values (catalog §7.3)", () => {
  it.each([
    ["a private key block", "-----BEGIN RSA PRIVATE KEY-----", "private key"],
    [
      "an OpenSSH private key",
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "private key",
    ],
    [
      "a PGP private key",
      "-----BEGIN PGP PRIVATE KEY BLOCK-----",
      "private key",
    ],
    [
      "a Shinan agent token",
      `${agentTokenPrefix}0aZ9bY8cX7dW6eV5fU4gT3hS2iR1jQ0kP9lO8mN7nM6`,
      "Shinan agent token",
    ],
    [
      "a GitHub token",
      "ghp_0123456789abcdefghijABCDEFGHIJ012345",
      "GitHub token",
    ],
    [
      "a fine-grained GitHub token",
      `github_pat_${"A1b2C3d4E5".repeat(7)}`,
      "GitHub token",
    ],
    ["a GitLab token", "glpat-abcdefghij0123456789", "GitLab token"],
    ["a Slack token", "xoxb-1234567890-abcdefghij", "Slack token"],
    ["an AWS access key", "AKIAIOSFODNN7EXAMPLE", "AWS access key"],
    [
      "a Google API key",
      "AIzaSyD-0123456789abcdefghijABCDEFGHIJK",
      "Google API key",
    ],
    ["a Stripe key", "sk_live_0123456789abcdefghijABCD", "Stripe key"],
    [
      "an AI provider key",
      "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
      "AI provider key",
    ],
    ["an npm token", "npm_abcdefghijABCDEFGHIJ0123456789abcdef", "npm token"],
    [
      "a Hugging Face token",
      "hf_abcdefghijABCDEFGHIJ0123456789ab",
      "Hugging Face token",
    ],
    [
      "a URL with a password",
      "https://admin:s3cret-Pw@registry.example.com/v2",
      "URL with a password",
    ],
  ])("blocks %s", (_, text, kind) => {
    expect(kinds(`Before ${text} after`)).toEqual([["blocking", kind]])
  })

  it.each([
    ["password=", "password=hunter22"],
    ["an API key assignment", "API_KEY: 'abcd1234efgh'"],
    ["a token in a query string", "https://x.example/hook?token=Zm9vYmFyYmF6"],
    ["a long random-looking string", "kV9xQ2mZ7pL4tR8wB3nF6hJ1cY5dG0sAe"],
  ])("warns about %s", (_, text) => {
    expect(findSecrets(text).map((f) => f.severity)).toEqual(["warning"])
  })

  it.each([
    [
      "the catalog's secrets-in example",
      "secrets-in:\n  - to: service/obscuro\n    item: musashi/dockyard/registry-admin\n    note: Registry admin password",
    ],
    [
      "a commit in a pinned URL",
      "https://github.com/guneet-xyz/dockyard/blob/4f1c2e9a7b3d5e6f8a9b0c1d2e3f4a5b6c7d8e9f/AGENTS.md",
    ],
    [
      "an image digest",
      "cr.guneet.dev/shinan/shinan@sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    ],
    [
      "a host key fingerprint",
      "SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8",
    ],
    [
      "an SSH public key",
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl guneet@daedalus",
    ],
    [
      "a URL with a user and no password",
      "ssh://git@git.guneet.dev:2222/guneet/workspace.git",
    ],
    [
      "a placeholder password in a URL",
      "postgres://shinan:${PASSWORD}@localhost:5432/shinan",
    ],
    ["a masked password", "password: ****"],
    [
      "a sentence about tokens",
      "Rotate the token: see the runbook. The password lives in Obscuro.",
    ],
    ["a UUID", "550e8400-e29b-41d4-a716-446655440000"],
    [
      "kebab-case names",
      "docs-agent-instructions-for-the-whole-workspace-and-more",
    ],
    [
      "the bare agent-token prefix",
      `Tokens start with ${agentTokenPrefix} so they can be spotted.`,
    ],
  ])("passes %s", (_, text) => {
    expect(findSecrets(text)).toEqual([])
  })

  it("points at the value without repeating it, offset into the document", () => {
    const token = "ghp_0123456789abcdefghijABCDEFGHIJ012345"
    const [finding] = findSecrets(`x ${token}`, 100)
    expect(finding?.range).toEqual({ start: 102, end: 102 + token.length })
    expect(finding?.excerpt).toBe("ghp_01…")
    expect(finding?.excerpt).not.toContain(token.slice(8))
  })

  it("reports overlapping matches once, as the stronger kind", () => {
    expect(kinds("token=ghp_0123456789abcdefghijABCDEFGHIJ012345")).toEqual([
      ["blocking", "GitHub token"],
    ])
  })
})
