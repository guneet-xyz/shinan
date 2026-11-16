---
id: D-031
title: An agent is per person, coding tool and machine; every subagent is its own agent session
status: accepted
date: 2026-11-16
decided_by: owner
evidence: "https://github.com/guneet-xyz/shinan/issues/25 (O-37, O-40)"
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-031: An agent is per person, coding tool and machine; every subagent is its own agent session

Status: **Accepted** by the owner on 2026-11-16
([issue #25, batch 5](https://github.com/guneet-xyz/shinan/issues/25#issuecomment-6911739666):
O-37 and O-40, not as recommended).

## Context

- Agents connect from outside and act for a person
  ([D-008](D-008-agents-connect-from-outside.md),
  [D-017](D-017-shared-git-host-accounts.md)); presence is tracked per agent
  session ([D-014](D-014-three-connection-levels.md)).
- Identity recommended one agent per person and coding tool, with tokens per
  machine. Agent integrations recommended folding subagents into their parent
  agent session unless they claim their own task.

## Decision

An agent is per person, coding tool and machine, for example "Guneet's
OpenCode on Daedalus". Every subagent is its own agent session, not folded into
its parent.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- Registration, tokens and display: see
  [identity, agents and permissions](../identity.md),
  [agent integrations](../agent-integrations.md) and
  [human experience](../human-experience.md).

## Alternatives considered

- **Recorded:** one agent per person and coding tool, tokens per machine
  (O-40's recommendation). Not chosen.
- **Recorded:** subagents part of the parent agent session unless they claim
  their own task (O-37's recommendation). Not chosen.

## Owning documents

- [Identity, agents and permissions](../identity.md): agents and tokens.
- [Agent integrations](../agent-integrations.md): agent sessions and presence.
- [Domain model and glossary](../domain-model.md): the terms.

## Related open questions

None.

## History

- 2026-11-16: accepted by the owner on issue #25. Recorded in the decision
  log's pull request as part of the issue #25 batch (see
  [README, history](README.md#history)).
