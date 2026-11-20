import { describe, expect, it } from "vitest"

import { agentTokenPrefix } from "../../tokens.js"
import {
  findPushSecrets,
  findSecrets,
  maxCheckedLength,
  scanSecrets,
  secretFingerprint,
} from "./secrets.js"

const kinds = (text: string) =>
  findSecrets(text).map((f) => [f.severity, f.kind])

const rsaKey =
  "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDIxGTUDnmZeCWNORargoJZ1+x39J4IOqlG5z2LxzJfAz5AllQLMYGQinhWIYVW7hsstjW55Cd9rbi4Qrj/ag6uRCnViGM5JCZB+mnxSGmmnGnqb2M3Y49jS03v2eXZdnxRrORGBrUfppC6XJZr3R8lRem5iiAVt5rLmfiBRxljlqMPbofsDMNLnxZshK/VNfGuLUGjn6Huat/OdRQO+fFdltsil5ozHkUaPA67b/bxNv5lhd5HrjuAUJgRo+S2Le5Apfyax2IWNJy7EezcYO8T4BtLOhMyqrBqOQFFbTrmWajNySC+sQGrTtNu2FeQsJLj5j+eHsrZvcUEc5+pVYUL test@example"

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
      "an age secret key",
      `AGE-SECRET-KEY-1${"QZ8V".repeat(14)}QZ`,
      "age secret key",
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
    [
      "a GitLab token ending in -",
      "glpat-abcdefghij012345678-",
      "GitLab token",
    ],
    ["a Slack token", "xoxb-1234567890-abcdefghij", "Slack token"],
    [
      "a Slack app token",
      "xapp-1-A0123456789-0123456789-abcdef",
      "Slack token",
    ],
    [
      "a Slack webhook",
      "https://hooks.slack.com/services/T0123ABCD/B0123ABCD/AbCdEfGhIjKlMnOpQrStUvWx",
      "Slack webhook",
    ],
    [
      "a Discord webhook",
      "https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-",
      "Discord webhook",
    ],
    ["an AWS access key", "AKIAIOSFODNN7EXAMPLE", "AWS access key"],
    ["an AWS temporary access key", "ASIAIOSFODNN7EXAMPLE", "AWS access key"],
    [
      "a Google API key",
      "AIzaSyD-0123456789abcdefghijABCDEFGHIJK",
      "Google API key",
    ],
    [
      "a Google API key ending in -",
      "AIzaSyD-0123456789abcdefghijABCDEFGHIJ-",
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
      "a PyPI token",
      `pypi-AgEIcHlwaS5vcmc${"Ab3_Cd4-Ef5".repeat(5)}`,
      "PyPI token",
    ],
    [
      "a Docker Hub token",
      "dckr_pat_AbCdEfGhIjKlMnOpQrStUv01234",
      "Docker Hub token",
    ],
    [
      "a Hugging Face token",
      "hf_abcdefghijABCDEFGHIJ0123456789ab",
      "Hugging Face token",
    ],
    [
      "a SendGrid key",
      `SG.${"aB3_cD4-eF5".repeat(2)}.${"Ab3_Cd4-Ef5".repeat(3)}AbCdEfGhIj`,
      "SendGrid key",
    ],
    [
      "a JSON Web Token",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "JSON Web Token",
    ],
    [
      "a URL with a password",
      "https://admin:s3cret-Pw@registry.example.com/v2",
      "URL with a password",
    ],
    [
      "a URL with a password and no user",
      "redis://:Sup3rS3cretPass@redis.internal:6379",
      "URL with a password",
    ],
    [
      "a URL with a default password",
      "postgres://postgres:changeme@db:5432/app",
      "URL with a password",
    ],
  ])("blocks %s", (_, text, kind) => {
    expect(kinds(`Before ${text} after`)).toEqual([["blocking", kind]])
  })

  it.each([
    ["password=", "password=hunter22"],
    ["an API key assignment", "API_KEY: 'abcd1234efgh'"],
    ["a token in a query string", "https://x.example/hook?token=Zm9vYmFyYmF6"],
    ["an environment variable for a password", "DB_PASSWORD=Sup3rS3cretPass"],
    ["an environment variable for a token", "GITHUB_TOKEN=abcd1234efgh5678"],
    [
      "an AWS secret access key",
      "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    ],
    [
      "a YAML-style secret",
      "aws_secret_access_key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    ],
    ["a long random-looking string", "kV9xQ2mZ7pL4tR8wB3nF6hJ1cY5dG0sAe"],
    ["a random string with dashes", "kV9x-Q2mZ7pL4-tR8wB3nF6-hJ1cY5dG0sAe"],
    [
      "a random string in a URL path",
      "https://x.example/files/kV9xQ2mZ7pL4tR8wB3nF6hJ1cY5dG0sAe/get",
    ],
    // Prose that reads like an assignment is held for a person to confirm.
    ["a sentence with `password:`", "The password: stored in Obscuro"],
    [
      "a secret's location written as `secret:`",
      "secret: musashi/dockyard/registry-admin",
    ],
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
      "a pinned link to a decision record (#157)",
      "https://github.com/guneet-xyz/shinan/blob/3e6860a1b2c3d4e5f60718293a4b5c6d7e8f9012/docs/decisions/D-054-public-image-registry-project.md",
    ],
    [
      "commit, tree and compare links on code hosts (#157)",
      "https://github.com/guneet-xyz/shinan/commit/3e6860a1b2c3d4e5f60718293a4b5c6d7e8f9012 https://git.guneet.dev/guneet/workspace/src/commit/4f1c2e9a7b3d5e6f8a9b0c1d2e3f4a5b6c7d8e9f https://gitlab.com/g/p/-/tree/4f1c2e9a7b3d5e6f8a9b0c1d2e3f4a5b6c7d8e9f/docs https://github.com/g/p/compare/4f1c2e9a7b3d5e6f8a9b0c1d2e3f4a5b6c7d8e9f...3e6860a1b2c3d4e5f60718293a4b5c6d7e8f9012",
    ],
    [
      "names of words and numbers",
      "D-066-By-Names-The-First-Pusher_2026_11_20 RFC-9110-HTTP-Semantics-Section-13",
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
      "a host key fingerprint with /",
      "SHA256:nT/bg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8",
    ],
    [
      "a subresource integrity hash",
      "sha512-Kq5sNclPz7QV2+lfQIuEZ8k7rJ3uGvz9x2F8/DLwYp1HgQn4mR6tS0eWcA9bVjXkLyM3oP5iU7aZ1dC2fE4gH6==",
    ],
    [
      "an ed25519 public key",
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl guneet@daedalus",
    ],
    ["an RSA public key", rsaKey],
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
    expect(JSON.stringify(finding)).not.toContain(token.slice(6))
    expect(finding && "secret" in finding).toBe(false)
  })

  it("keeps the value for validation only, and only the value of an assignment or URL", () => {
    const token = "ghp_0123456789abcdefghijABCDEFGHIJ012345"
    expect(scanSecrets(`x ${token}`)[0]?.secret).toBe(token)
    expect(scanSecrets("DB_PASSWORD=Sup3rS3cretPass")[0]?.secret).toBe(
      "Sup3rS3cretPass",
    )
    expect(
      scanSecrets("redis://:Sup3rS3cretPass@redis.internal")[0]?.secret,
    ).toBe("Sup3rS3cretPass")
  })

  it.each([
    "RSA PRIVATE KEY",
    "PRIVATE KEY",
    "EC PRIVATE KEY",
    "ENCRYPTED PRIVATE KEY",
    "OPENSSH PRIVATE KEY",
  ])("blocks a %s written in base64", (type) => {
    const pem = `-----BEGIN ${type}-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\n-----END ${type}-----\n`
    const encoded = Buffer.from(pem).toString("base64")
    expect(kinds(`tls.key: ${encoded}`)).toEqual([
      ["blocking", "private key (base64)"],
    ])
  })

  it("blocks a private key after a certificate in a base64 bundle, or after a line break", () => {
    const certificate =
      "-----BEGIN CERTIFICATE-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu1SU1L\n-----END CERTIFICATE-----\n"
    const key =
      "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\n-----END PRIVATE KEY-----\n"
    for (const pem of [certificate + key, `\n${key}`, `ab${key}`]) {
      const encoded = Buffer.from(pem).toString("base64")
      expect(kinds(`tls.key: ${encoded}`)).toEqual([
        ["blocking", "private key (base64)"],
      ])
    }
    const url = Buffer.from(`\n${key}`).toString("base64url")
    expect(kinds(url)).toEqual([["blocking", "private key (base64)"]])
  })

  it("does not block a certificate or public key written in base64", () => {
    for (const type of ["CERTIFICATE", "PUBLIC KEY"]) {
      const pem = `-----BEGIN ${type}-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu1SU1L\n-----END ${type}-----\n`
      const encoded = Buffer.from(pem).toString("base64")
      expect(
        findSecrets(`tls.crt: ${encoded}`).filter(
          (f) => f.severity === "blocking",
        ),
      ).toEqual([])
    }
  })

  it("reports overlapping matches once, as the stronger kind", () => {
    expect(kinds("token=ghp_0123456789abcdefghijABCDEFGHIJ012345")).toEqual([
      ["blocking", "GitHub token"],
    ])
  })

  it("reads at most maxCheckedLength characters", () => {
    const token = "ghp_0123456789abcdefghijABCDEFGHIJ012345"
    expect(findSecrets(`${" ".repeat(maxCheckedLength)}${token}`)).toEqual([])
  })
})

describe("the check on hostile input", () => {
  const size = 200_000
  const fill = (unit: string) =>
    unit.repeat(Math.ceil(size / unit.length)).slice(0, size)
  let seed = 1
  const random = (alphabet: string) =>
    Array.from({ length: size }, () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return alphabet[seed % alphabet.length]
    }).join("")

  // Each input targets the start or a repeated part of a pattern.
  const inputs: Record<string, string> = {
    "dotted run": fill("a."),
    "dashed run": fill("a-"),
    "plus run": fill("a+"),
    "scheme-like run": `a${fill("a")}://`,
    "repeated schemes": fill("a://"),
    "colons after a scheme": `a://${fill(":")}`,
    "users without a password": fill("a://b@"),
    "private key starts": fill("-----BEGIN A "),
    "private key with long words": `-----BEGIN ${fill("A")}`,
    "slack-like dashes": `xoxb-${fill("-")}`,
    assignments: fill("pwd=abcd "),
    "assignment names": fill("DB_PASSWORD_"),
    "assignment values": `password=${fill("a")}`,
    "token prefixes": fill("ghp_"),
    "AI key starts": fill("sk-"),
    "JWT starts": fill("eyJa."),
    "long JWT": `eyJ${fill("a")}`,
    "webhook starts": fill("https://hooks.slack.com/services/"),
    "SSH key starts": fill("ssh-rsa AAAA "),
    "fingerprint starts": fill("SHA256:"),
    "agent-token prefixes": fill(agentTokenPrefix),
    "base64 PEM starts": fill("LS0tLS1CRUdJTi"),
    "one long base64 run with a BEGIN marker": `LS0tLS1CRUdJTi${fill("QUFB")}`,
    base64: random(
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
    ),
    "words and spaces": random("abcXYZ019 _-=:/@."),
  }

  it.each(Object.entries(inputs))("finishes quickly on %s", (_, text) => {
    const started = performance.now()
    findSecrets(text)
    expect(performance.now() - started).toBeLessThan(1000)
  })
})

describe("findPushSecrets", () => {
  const token = "ghp_0123456789abcdefghijABCDEFGHIJ012345"

  it("gives each value's fingerprint, never the value", () => {
    const [finding] = findPushSecrets(`x ${token}`)
    expect(finding).toMatchObject({
      severity: "blocking",
      kind: "GitHub token",
      fingerprint: secretFingerprint(token),
    })
    expect(finding!.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(finding)).not.toContain(token.slice(6))
  })

  it("leaves out exactly the allowed values", () => {
    const allowed = new Set([secretFingerprint(token)])
    expect(findPushSecrets(`x ${token}`, allowed)).toEqual([])
    const changed = `${token.slice(0, -1)}6`
    expect(findPushSecrets(`x ${changed}`, allowed)).toHaveLength(1)
  })

  it("reads a whole file past one scan's length, each finding once", () => {
    const filler = "word ".repeat(200_000)
    const text = `${token}\n${filler}${token}\n${filler.slice(0, maxCheckedLength - 3)}${token}`
    const found = findPushSecrets(text)
    expect(found.map((f) => f.range.start)).toEqual([
      0,
      token.length + 1 + filler.length,
      text.length - token.length,
    ])
  })
})
