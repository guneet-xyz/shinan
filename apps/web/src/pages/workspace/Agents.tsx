import { useState } from "react"
import { Link } from "react-router"

import type { IssuedAgentToken } from "@shinan/api-client"

import { useAccount } from "../../account"
import { useApi, useResource } from "../../api"
import { AgentCard, TokenShownOnce } from "../../components/AgentCard"
import { Rows, Section } from "../../components/page"
import { ErrorMessage, Loading } from "../../components/status"
import { useWorkspace } from "./context"

/**
 * Agents (human experience, Workspace settings): every agent in the
 * workspace with the member it acts for, its state and its token's use. A
 * workspace owner can disable any agent and revoke any token (identity
 * §7.5); their own agents are managed in full, as in Your agents.
 */
export function Agents() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const { account } = useAccount()
  const agents = useResource(`agents:${workspace.id}`, () =>
    api.agents(workspace.id),
  )
  const [issued, setIssued] = useState<IssuedAgentToken>()
  const owner = workspace.role === "owner"
  const memberId = account.workspaces.find(
    (w) => w.id === workspace.id,
  )?.memberId

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {issued && (
        <TokenShownOnce
          issued={issued}
          onDismiss={() => setIssued(undefined)}
        />
      )}
      <Section
        title="Agents"
        description={
          <>
            {owner
              ? "Every member's agents in this workspace. You can disable any agent or revoke its token; its member makes new tokens."
              : "Your agents in this workspace."}{" "}
            Make a token in{" "}
            <Link
              to="/account/agents"
              className="text-foreground underline underline-offset-4"
            >
              Your agents
            </Link>
            .
          </>
        }
      >
        {agents.data ? (
          agents.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No agents in this workspace yet.
            </p>
          ) : (
            <Rows>
              {agents.data.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  control={
                    agent.memberId === memberId
                      ? "own"
                      : owner
                        ? "owner"
                        : "none"
                  }
                  showPerson
                  reload={agents.reload}
                  onIssued={setIssued}
                />
              ))}
            </Rows>
          )
        ) : agents.error ? (
          <ErrorMessage error={agents.error} />
        ) : (
          <Loading />
        )}
      </Section>
    </div>
  )
}
