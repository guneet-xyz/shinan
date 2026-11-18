import { render, screen } from "@testing-library/react"
import type { RenderResult } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router"
import { vi } from "vitest"

import { ApiError } from "@shinan/api-client"
import type {
  Account,
  Agent,
  ApiClient,
  ErrorBody,
  Member,
  Workspace,
} from "@shinan/api-client"

import { ApiContext } from "../api"
import { App } from "../App"

export const workspaceId = "11111111-1111-4111-8111-111111111111"

export const person: Account["person"] = {
  id: "22222222-2222-4222-8222-222222222222",
  handle: "guneet",
  name: "Guneet",
  email: "guneet@example.com",
  createdAt: "2026-11-01T10:00:00.000Z",
}

export const account: Account = {
  person,
  workspaces: [
    {
      id: workspaceId,
      name: "Team",
      role: "owner",
      memberId: "33333333-3333-4333-8333-333333333333",
      joinedAt: "2026-11-01T10:00:00.000Z",
    },
  ],
  signInMethods: {
    email: person.email,
    github: null,
    githubAvailable: true,
  },
  operator: false,
}

export const workspace: Workspace = {
  id: workspaceId,
  name: "Team",
  createdAt: "2026-11-01T10:00:00.000Z",
  role: "owner",
}

export const ownerMember: Member = {
  id: "33333333-3333-4333-8333-333333333333",
  personId: person.id,
  handle: "guneet",
  name: "Guneet",
  role: "owner",
  joinedAt: "2026-11-01T10:00:00.000Z",
  invitedByHandle: null,
  agents: [],
}

export const contributorMember: Member = {
  id: "44444444-4444-4444-8444-444444444444",
  personId: "55555555-5555-4555-8555-555555555555",
  handle: "sam",
  name: "Sam",
  role: "contributor",
  joinedAt: "2026-11-02T10:00:00.000Z",
  invitedByHandle: "guneet",
  agents: [],
}

/** One of the signed-in person's agents, with a token in use. */
export const agent: Agent = {
  id: "66666666-6666-4666-8666-666666666666",
  workspaceId,
  workspaceName: "Team",
  memberId: account.workspaces[0]!.memberId,
  personId: person.id,
  personHandle: person.handle,
  personName: person.name,
  codingTool: "opencode",
  machine: "daedalus",
  handle: "opencode-daedalus",
  name: "OpenCode on Daedalus",
  machineEntityId: null,
  enabled: true,
  createdAt: "2026-11-10T10:00:00.000Z",
  disabledAt: null,
  token: {
    id: "77777777-7777-4777-8777-777777777777",
    access: "full",
    scopes: ["catalog:read"],
    createdAt: "2026-11-10T10:00:00.000Z",
    firstUsedAt: "2026-11-10T11:00:00.000Z",
    lastUsedAt: "2026-11-16T09:30:00.000Z",
    lastNetworkAddress: "203.0.113.7",
    requestCount: 1234,
    unused: false,
  },
}

export function apiError(status: number, body: ErrorBody): ApiError {
  return new ApiError(status, body.message, body)
}

export const signedOut = () =>
  apiError(401, { error: "sign-in-required", message: "Sign in to continue" })

export const reauthenticationRequired = () =>
  apiError(403, {
    error: "reauthentication-required",
    message: "Sign in again to continue",
  })

type Fake = { [K in keyof ApiClient]: ReturnType<typeof vi.fn<ApiClient[K]>> }

/**
 * An API client whose methods are mocks. A signed-in owner of one workspace
 * by default; anything a test does not set up fails loudly.
 */
export function fakeApi(overrides: Partial<ApiClient> = {}): Fake {
  const notSetUp = (name: string) => () =>
    Promise.reject(new Error(`${name} was not set up in this test`))
  const defaults: Partial<ApiClient> = {
    installation: () =>
      Promise.resolve({ name: "Shinan", signInMethods: { github: true } }),
    account: () => Promise.resolve(account),
    signInSessions: () => Promise.resolve([]),
    invitationsForYou: () => Promise.resolve([]),
    workspace: () => Promise.resolve(workspace),
    members: () => Promise.resolve([ownerMember, contributorMember]),
    // A workspace opens on the wiki's home page.
    catalogTypes: () =>
      Promise.resolve({ catalog_revision: 0, index_behind: false, items: [] }),
    markCatalogPageOpened: () => Promise.resolve(),
  }
  const names: (keyof ApiClient)[] = [
    "status",
    "installation",
    "requestSignInLink",
    "startGitHubSignIn",
    "signOut",
    "pendingGitHubSignIn",
    "openSignInLink",
    "createWorkspace",
    "startSetup",
    "account",
    "signInSessions",
    "endSignInSession",
    "signOutEverywhere",
    "addGitHub",
    "removeGitHub",
    "invitationsForYou",
    "acceptInvitationById",
    "declineInvitationById",
    "findInvitation",
    "acceptInvitation",
    "declineInvitation",
    "allowlist",
    "addToAllowlist",
    "removeFromAllowlist",
    "workspace",
    "renameWorkspace",
    "leaveWorkspace",
    "members",
    "changeRole",
    "removeMember",
    "invitations",
    "invite",
    "resendInvitation",
    "withdrawInvitation",
    "events",
    "securityLog",
    "yourAgents",
    "agents",
    "createAgentToken",
    "issueAgentToken",
    "revokeAgentToken",
    "renameAgent",
    "disableAgent",
    "enableAgent",
    "catalogEntity",
    "catalogTypes",
    "catalogType",
    "catalogTypeIndex",
    "catalogSearch",
    "catalogList",
    "catalogChanges",
    "catalogStartHere",
    "catalogAgentPreview",
    "catalogHistory",
    "catalogText",
    "catalogPagesOpened",
    "markCatalogPageOpened",
  ]
  const fake = {} as Record<string, unknown>
  for (const name of names) {
    fake[name] = vi.fn(overrides[name] ?? defaults[name] ?? notSetUp(name))
  }
  return fake as Fake
}

/** Shows the current address, so tests can check where navigation went. */
function Location() {
  const location = useLocation()
  return (
    <output data-testid="location">
      {location.pathname + location.search + location.hash}
    </output>
  )
}

export function renderApp(
  path: string,
  api: Fake = fakeApi(),
): RenderResult & { api: Fake } {
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <ApiContext value={api as unknown as ApiClient}>
        <App />
        <Location />
      </ApiContext>
    </MemoryRouter>,
  )
  return { ...result, api }
}

export function currentPath(): string {
  return screen.getByTestId("location").textContent
}
