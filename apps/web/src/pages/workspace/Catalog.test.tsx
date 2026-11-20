import { createHash } from "node:crypto"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import {
  fakeApi,
  ownerMember,
  reauthenticationRequired,
  renderApp,
  workspace,
  workspaceId,
} from "../../test/render"

const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex")

describe("Settings › Catalog", () => {
  it("gives every member the address agents clone from, to copy", async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    renderApp(
      `/w/${workspaceId}/settings/catalog`,
      fakeApi({ catalogAllowedValues: () => Promise.resolve([]) }),
    )
    const address = `${window.location.origin}/git/${workspaceId}.git`
    // Shown whole, to read; copied exactly.
    expect(await screen.findByText(address)).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Copy" }))
    expect(writeText).toHaveBeenCalledWith(address)
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "Set up an agent →" })
        .getAttribute("href"),
    ).toBe("/account/agents/setup")
    expect(
      screen
        .getByRole("navigation", { name: "Workspace settings" })
        .querySelector('[aria-current="page"]')?.textContent,
    ).toBe("Catalog")
    // Nothing promised for later.
    expect(screen.queryByText(/coming soon/i)).toBeNull()
  })

  const fingerprint = "3f9a1c2d4e5f".padEnd(64, "0")
  const allowed = {
    fingerprint,
    allowedByPersonId: ownerMember.personId,
    createdAt: "2026-11-20T10:00:00.000Z",
  }

  it("lists the values owners allowed as not a secret, by fingerprint only", async () => {
    renderApp(
      `/w/${workspaceId}/settings/catalog`,
      fakeApi({ catalogAllowedValues: () => Promise.resolve([allowed]) }),
    )
    expect(
      await screen.findByRole("heading", {
        name: "Values that aren't secrets",
      }),
    ).toBeTruthy()
    const list = await screen.findByRole("list", { name: "Allowed values" })
    expect(list.textContent).toContain("by Guneet · sha256:3f9a1c2d4e5f…")
    expect(list.textContent).toMatch(/^Allowed Nov 20 by/)
  })

  it("allows a value, or the fingerprint a refusal showed, and removes one", async () => {
    let values = [allowed]
    const fake = fakeApi({
      catalogAllowedValues: () => Promise.resolve(values),
      allowCatalogValue: () => {
        values = [...values]
        return Promise.resolve(allowed)
      },
      removeCatalogAllowedValue: () => {
        values = []
        return Promise.resolve()
      },
    })
    renderApp(`/w/${workspaceId}/settings/catalog`, fake)
    const field = await screen.findByLabelText("The value, or its fingerprint")
    await userEvent.type(field, `sha256:${"a".repeat(64)}`)
    await userEvent.click(screen.getByRole("button", { name: "Allow" }))
    await waitFor(() =>
      expect(fake.allowCatalogValue).toHaveBeenLastCalledWith(workspaceId, {
        fingerprint: `sha256:${"a".repeat(64)}`,
      }),
    )
    expect((field as HTMLInputElement).value).toBe("")
    // A value: only its fingerprint, worked out on the page, is sent.
    await userEvent.type(field, "registry.guneet.dev")
    await userEvent.click(screen.getByRole("button", { name: "Allow" }))
    await waitFor(() =>
      expect(fake.allowCatalogValue).toHaveBeenLastCalledWith(workspaceId, {
        fingerprint: `sha256:${sha256("registry.guneet.dev")}`,
      }),
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Remove sha256:3f9a1c2d4e5f…" }),
    )
    expect(fake.removeCatalogAllowedValue).toHaveBeenCalledWith(
      workspaceId,
      fingerprint,
    )
    expect(await screen.findByText("No values allowed yet.")).toBeTruthy()
  })

  it("asks the owner to sign in again before allowing a value", async () => {
    renderApp(
      `/w/${workspaceId}/settings/catalog`,
      fakeApi({
        catalogAllowedValues: () => Promise.resolve([]),
        allowCatalogValue: () => Promise.reject(reauthenticationRequired()),
      }),
    )
    await userEvent.type(
      await screen.findByLabelText("The value, or its fingerprint"),
      "registry.guneet.dev",
    )
    await userEvent.click(screen.getByRole("button", { name: "Allow" }))
    expect(
      await screen.findByRole("dialog", { name: "Sign in again to continue" }),
    ).toBeTruthy()
  })

  it("shows contributors only the address", async () => {
    const fake = fakeApi({
      workspace: () => Promise.resolve({ ...workspace, role: "contributor" }),
    })
    renderApp(`/w/${workspaceId}/settings/catalog`, fake)
    expect(
      await screen.findByRole("heading", { name: "Address for agents" }),
    ).toBeTruthy()
    expect(
      screen.queryByRole("heading", { name: "Values that aren't secrets" }),
    ).toBeNull()
    expect(fake.catalogAllowedValues).not.toHaveBeenCalled()
  })

  it("sends a pasted key only as its fingerprint, and masks it while typed", async () => {
    // 64 hexadecimal characters: what a key looks like, not a fingerprint.
    const key = "0f344e".padEnd(64, "9")
    const fake = fakeApi({
      catalogAllowedValues: () => Promise.resolve([]),
      allowCatalogValue: () => Promise.resolve(allowed),
    })
    renderApp(`/w/${workspaceId}/settings/catalog`, fake)
    const field = await screen.findByLabelText("The value, or its fingerprint")
    expect(field.getAttribute("type")).toBe("password")
    // Show unmasks it, to check what was pasted; Hide masks it again.
    await userEvent.click(screen.getByRole("button", { name: "Show" }))
    expect(field.getAttribute("type")).toBe("text")
    await userEvent.click(screen.getByRole("button", { name: "Hide" }))
    expect(field.getAttribute("type")).toBe("password")
    expect(field.getAttribute("placeholder")).toBe(
      "The value, or sha256:… from the refusal",
    )
    await userEvent.type(field, ` ${key} `)
    await userEvent.click(screen.getByRole("button", { name: "Allow" }))
    await waitFor(() =>
      expect(fake.allowCatalogValue).toHaveBeenCalledWith(workspaceId, {
        fingerprint: `sha256:${sha256(key)}`,
      }),
    )
    expect(JSON.stringify(fake.allowCatalogValue.mock.calls)).not.toContain(key)
  })

  it("says what is wrong with a mistyped fingerprint, and sends nothing", async () => {
    const fake = fakeApi({ catalogAllowedValues: () => Promise.resolve([]) })
    renderApp(`/w/${workspaceId}/settings/catalog`, fake)
    await userEvent.type(
      await screen.findByLabelText("The value, or its fingerprint"),
      "sha256:3f9a",
    )
    await userEvent.click(screen.getByRole("button", { name: "Allow" }))
    expect((await screen.findByRole("alert")).textContent).toBe(
      "That isn't a whole fingerprint: it is sha256: and 64 hexadecimal characters (0–9, a–f), as the refusal shows it.",
    )
    expect(fake.allowCatalogValue).not.toHaveBeenCalled()
  })

  it("marks hidden characters in the name of who allowed a value", async () => {
    renderApp(
      `/w/${workspaceId}/settings/catalog`,
      fakeApi({
        catalogAllowedValues: () => Promise.resolve([allowed]),
        members: () =>
          Promise.resolve([{ ...ownerMember, name: "Guneet \u202Egnp.exe" }]),
      }),
    )
    const list = await screen.findByRole("list", { name: "Allowed values" })
    expect(list.textContent).toContain(
      "Guneet ⟨U+202E⟩ (hidden character: right-to-left override) gnp.exe",
    )
  })
})
