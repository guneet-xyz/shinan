import { screen } from "@testing-library/react"
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
    expect(fake.allowCatalogValue).toHaveBeenLastCalledWith(workspaceId, {
      fingerprint: `sha256:${"a".repeat(64)}`,
    })
    expect((field as HTMLInputElement).value).toBe("")
    await userEvent.type(field, "registry.guneet.dev")
    await userEvent.click(screen.getByRole("button", { name: "Allow" }))
    expect(fake.allowCatalogValue).toHaveBeenLastCalledWith(workspaceId, {
      value: "registry.guneet.dev",
    })
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
})
