# Shinan: high-level plan

Status: **approved by the owner on 2026-11-16** ([issue #1](https://github.com/guneet-xyz/shinan/issues/1)).
Nothing here is a specification. Each section names the in-depth document that
will own it.

## 1. What Shinan is

Shinan is the place where the story of work and the context behind it live, for
teams where coding agents do much of the work and people set direction.

- **Catalog.** One trusted, always-current record of everything a team runs and
  works on: projects, machines, services, runbooks, decisions and policies.
  Agents keep it accurate as part of their work. People can read it like a wiki.
  Every fact shows how fresh it is and where it came from.
- **Tasks.** The story of a piece of work, from intent to verified outcome,
  across any number of repositories and git hosts. The code work (branches,
  pull requests, reviews, CI) stays on GitHub, Forgejo and similar hosts. Shinan
  links to it and shows one timeline.
- **Agents connect from outside.** People keep using their own coding agents
  (OpenCode, Claude Code, Codex and others). Agents reach Shinan through an MCP
  server, a skill and plugins for their coding tools. Shinan does not run a model.

The first user is the owner. Shinan starts empty and is tried on a few projects
first. Once it is ready, it replaces the `workspace` repository's catalog and its
cross-project coordination issues. Until then the `workspace` repository stays
the source of truth (D-018).

### The name

Shinan (指南) means instruction or guidance. It comes from the south-pointing
chariot, an ancient Chinese compass, and was the title of the shogun's sword
instructors (剣術指南役). Read as `shinan.ai`, it also sounds like _shinanai_,
"won't die".

## 2. Who it is for

1. **Now:** the owner alone, with several agents, many repositories on GitHub and
   Forgejo, and a small fleet of machines.
2. **Designed in from the start:** teams. Users create workspaces and invite
   people to them (D-019), even though only one person uses Shinan at first.
3. **Later, if it proves itself:** small teams that run many projects or
   machines, such as agencies, consultancies and small infrastructure teams.

Building a business is not a goal of this phase (D-013).

## 3. What Shinan does not do

- Replace git hosts. No code review, CI, PR interface or per-repository issue
  tracker.
- Run models or host agents (at least until a later phase).
- Copy facts that another system owns. The catalog links to the owning source.
- Track human versus agent identity as a selling point. Attribution is
  necessary, but every competitor has it.

## 4. Product pillars

| Pillar              | Summary                                                                                                                                                                                                                                                                                | Owning document                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Catalog             | Typed entities (project, machine, service, runbook, decision, policy, person, agent). Each fact has a state (intended, observed, proposed, unknown), a source and a last-checked time. Agents propose changes; people approve where needed.                                            | Catalog                            |
| Tasks               | Host-neutral task with a stable ID (for example `T-123`). It holds the intent, acceptance criteria and decisions. Its status is calculated from linked work, not maintained by hand, apart from states only a person can set, such as "needs a person" (today's `human-effort` label). | Tasks and work                     |
| Timeline            | One stream of events across hosts, with each action credited to a person or to an agent acting for a person. Human activity stands out; agent activity is compact.                                                                                                                     | Human experience                   |
| Agent presence      | Which agent sessions are running, what task and repository each is on, and when each was last seen. Sessions connected only through MCP are marked "self-reported".                                                                                                                    | Agent integrations                 |
| Nudges              | When a person comments, the agent session working on the task is told. Sessions with a tool plugin get the message live; others pick it up the next time they check in. If no session is active, the person can ask for a new one.                                                     | Tasks and work, agent integrations |
| Wiki and onboarding | The catalog rendered for people, including a "start here" path for a new person or a new agent.                                                                                                                                                                                        | Human experience                   |
| Workspaces          | A workspace holds a team's catalog, tasks, connections to git hosts and members. People are invited to it.                                                                                                                                                                             | Identity, agents and permissions   |

## 5. Integration points

| Integration                                       | Direction                                                                          | First version                                                                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Git hosts: **GitHub**, **Forgejo** (GitLab later) | Webhooks in, API calls out, periodic reconciliation                                | Read PRs, issues, comments, checks and merges. Link them to tasks. Post links back where appropriate.                       |
| Coding agents: actions                            | MCP server and a skill (plus a CLI), for any agent                                 | Read the catalog, propose catalog changes, create, claim, update and complete tasks, report progress, link work.            |
| Coding agents: presence and nudges                | A plugin inside each coding tool, starting with OpenCode, then Claude Code         | Report session start, busy, idle, waiting and end; attach the session to its task; deliver nudges into the running session. |
| Coding agents: launching                          | A small program on each machine that starts agents (phase 3)                       | Start new agent sessions from the website.                                                                                  |
| People                                            | Web app at `shinan.guneet.dev`, on the public internet behind a login              | Browse the catalog, follow tasks and the timeline, comment, nudge.                                                          |
| Identity                                          | Sign-in for people, scoped tokens for agents, workspace membership and invitations | Details in the identity document.                                                                                           |
| Notifications                                     | Later                                                                              | Email or chat, not in the first version.                                                                                    |

## 6. Decisions so far

This table is the approved snapshot from 2026-11-16. Later decisions (D-021
onwards) and amendments to these are in the [decision log](decisions/README.md),
which is the current source for every decision.

Each decision becomes a decision record with its reasoning. "Accepted" means
agreed with the owner. "Proposed" means the owning document must confirm or
change it.

| ID    | Decision                                                                                                                                                                                                                     | Why                                                                                                                                                                                                                             | Status   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| D-001 | Shinan sits above git hosts and does not replace their issues or PRs.                                                                                                                                                        | Work spans GitHub and Forgejo; neither can manage the other, and copying issues creates two sources of truth.                                                                                                                   | Accepted |
| D-002 | The task is the core object and has a host-neutral ID used in branch names and PR descriptions.                                                                                                                              | Issue numbers only mean something inside one repository; a host-neutral ID ties work on any host to one story.                                                                                                                  | Accepted |
| D-003 | A task starts where the intent starts, not where the code lands. Outside issues become tasks automatically.                                                                                                                  | Every story needs one home, even when its first chapter was written elsewhere.                                                                                                                                                  | Accepted |
| D-004 | Agent-driven work links PRs directly; repository issues are created only when people need them there.                                                                                                                        | Avoids duplicate issues.                                                                                                                                                                                                        | Accepted |
| D-005 | Task status is calculated from linked work, not copied by hand.                                                                                                                                                              | Copied status goes stale; this matches the current workspace rule.                                                                                                                                                              | Accepted |
| D-006 | The catalog is document-first: Markdown with structured fields at the top is the source of truth, and an index for agents is generated from it.                                                                              | People must be able to read it; this is where Port is weakest and our workspace repository already works well.                                                                                                                  | Accepted |
| D-007 | Every catalog fact records its state, source and last-checked time.                                                                                                                                                          | Trust in the catalog is the main differentiator.                                                                                                                                                                                | Accepted |
| D-008 | Agents connect from outside; Shinan runs no model in the first phases.                                                                                                                                                       | Users already pay for and choose their agents; hosting agents is costly and offers little advantage early.                                                                                                                      | Accepted |
| D-009 | GitHub and Forgejo are the first git hosts.                                                                                                                                                                                  | They are the hosts we use.                                                                                                                                                                                                      | Accepted |
| D-010 | Integrate with tools such as Multica, Linear and Plane through their APIs; do not embed them.                                                                                                                                | Multica's license forbids embedding or hosting for others; integrating keeps Shinan host-neutral.                                                                                                                               | Accepted |
| D-011 | Private repository, internal brand "Shinan", first deployment at `shinan.guneet.dev`.                                                                                                                                        | `shinan.ai` is too expensive for now; the product is for our own use first.                                                                                                                                                     | Accepted |
| D-012 | Self-hostable by design.                                                                                                                                                                                                     | We self-host, and it is the clearest gap left by Port and Chartroom.                                                                                                                                                            | Accepted |
| D-013 | Business model, open-source licensing and pricing are deferred until Shinan has proved itself in our own use.                                                                                                                | No evidence yet of demand outside our own use.                                                                                                                                                                                  | Accepted |
| D-014 | Agents connect at three levels: MCP and a skill for actions (any agent); a plugin per coding tool for presence and live nudges (OpenCode first, then Claude Code); a launcher on each machine for starting agents (phase 3). | MCP alone depends on the agent choosing to report and cannot reach an idle or crashed session. A plugin reports from the tool itself; OpenCode's plugin API can follow session events and send messages into a running session. | Accepted |
| D-015 | The web app is on the public internet and requires sign-in.                                                                                                                                                                  | The owner wants to reach it from anywhere. Because it holds infrastructure details, sign-in, access rules and security get extra attention in the identity and architecture documents.                                          | Accepted |
| D-016 | `shinan.guneet.dev` runs on Musashi. Every deployment needs the owner's approval.                                                                                                                                            | Musashi already runs the owner's public applications.                                                                                                                                                                           | Accepted |
| D-017 | Agents use the same git host account as the person they work for. Shinan must tell people and agents apart from its own records (agent sessions, task links, markers in commits and PRs), not from git host accounts.        | Asking every user to create bot accounts is a barrier, and other adopters will have the same setup. This is a known limitation to design around.                                                                                | Accepted |
| D-018 | Shinan starts empty. It is tried on a few projects first; the `workspace` repository moves over only when Shinan is judged ready, and stays the source of truth until then.                                                  | Testing on a small scope limits risk and avoids two sources of truth during early changes.                                                                                                                                      | Accepted |
| D-019 | One user at first, but workspaces and invitations are part of the design from the start.                                                                                                                                     | Adding multi-user support later would mean reworking data, permissions and sign-in.                                                                                                                                             | Accepted |
| D-020 | The technology stack is chosen from options that the architecture document proposes, with trade-offs, for the owner to decide.                                                                                               | The owner has no fixed preference; options with reasons give a better decision than a single pick.                                                                                                                              | Accepted |

## 7. Open questions

These are for the in-depth documents to answer:

1. Technology stack options, storage, and how the catalog's Markdown and its index stay in sync (D-020).
2. How Shinan credits each action to a person or an agent when both use the same git host account (D-017), and how reliable that can be.
3. Permissions when a user can see a task but not a private repository it links to.
4. Reconciliation when webhooks are missed, and how freshness is shown.
5. Catalog schema: entity types, required fields and how relationships are expressed.
6. How DNS and deployment to Musashi are managed (D-016).
7. Sign-in method and protections for a public web app holding infrastructure details (D-015).
8. Which projects the proof of concept uses, what counts as "ready", and how the `workspace` repository is then moved over (D-018).
9. How far Claude Code and other tools can receive a message in a running session, and how presence works for tools with no plugin.
10. Licensing if the project is ever made public.

## 8. Documents to write next

Each document has one owning agent. Documents go under `docs/` and decision
records under `docs/decisions/`. All of them are now written and merged; the
links below go to them.

| Document                                        | Owns                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Product overview](product-overview.md)         | Vision, users, scope, non-goals, positioning against competitors (Multica, Linear, Port, Chartroom, OpsLevel and others)                                                                                                                                         |
| [Domain model and glossary](domain-model.md)    | Shared vocabulary and the core objects (workspace, member, task, work link, catalog entity, fact, actor, agent, agent session, event). Every other document uses these terms. It must keep a Shinan workspace distinct from the existing `workspace` repository. |
| [Catalog](catalog.md)                           | Entity types, fact states, provenance, editing and approval, the human view and the agent index                                                                                                                                                                  |
| [Tasks and work](tasks.md)                      | Task lifecycle, IDs and linking conventions, calculated status, nudges, triage of outside issues                                                                                                                                                                 |
| [Identity, agents and permissions](identity.md) | Sign-in, workspaces, members and invitations, agents acting for people, tokens, attribution when agents share a person's git host account, access rules                                                                                                          |
| [Git host integrations](git-hosts.md)           | GitHub and Forgejo: events, API use, reconciliation, rate limits, what is written back                                                                                                                                                                           |
| [Agent integrations](agent-integrations.md)     | MCP tools, the skill and the CLI; agent sessions and presence; plugins for each coding tool (OpenCode first); nudge delivery; the conventions agents must follow                                                                                                 |
| [Human experience](human-experience.md)         | Wiki, onboarding path, task pages, timeline, board, nudges, workspace and member management, what notifications are sent and personal notification settings                                                                                                      |
| [Architecture and operations](architecture.md)  | Technology stack options with trade-offs, system design, storage, sync, deployment on Musashi at `shinan.guneet.dev`, self-hosting, security for a public sign-in app, backups, sending notifications (email first)                                              |
| [Roadmap and migration](roadmap.md)             | Phases, first version scope, proof-of-concept projects and readiness criteria, moving the `workspace` repository into Shinan                                                                                                                                     |
| [Decision log](decisions/README.md)             | One record per decision in section 6 and any new ones                                                                                                                                                                                                            |

### Later changes to this plan's text

The plan is kept as approved. These parts of it were later changed by decisions;
the linked records and documents are current:

- §1: during the trial, cross-project coordination for trial projects moves into
  Shinan ([D-040](decisions/D-040-trial-coordination-in-shinan.md)).
- §4: the fact state `proposed` is now `planned`
  ([D-025](decisions/D-025-fact-state-planned.md)); agents may set `needs a person`
  and task flags are managed per workspace
  ([D-028](decisions/D-028-task-flags.md)); task ID prefixes are per workspace
  ([D-027](decisions/D-027-workspace-task-id-prefix.md)).
- §5: Shinan writes back only on GitHub, as its app; Forgejo connections are
  read-only ([D-032](decisions/D-032-no-writes-as-a-person-on-github.md),
  [D-042](decisions/D-042-no-writes-on-forgejo.md)). Agents "complete" tasks by
  recording verification ([D-021](decisions/D-021-status-from-work-and-events.md)).
  Email is sent from the first version for sign-in
  ([D-044](decisions/D-044-sign-in-magic-link-or-github.md)); notifications are
  still later.
- §7: questions 1, 3 and 7 are answered
  ([D-037](decisions/D-037-typescript-node-react.md),
  [D-043](decisions/D-043-no-git-mirror-for-now.md),
  [D-023](decisions/D-023-workspace-wide-visibility-no-secrets.md),
  [D-044](decisions/D-044-sign-in-magic-link-or-github.md)); question 8 is
  answered in the [roadmap](roadmap.md).
- §8: there are no built-in backups for now
  ([D-038](decisions/D-038-no-built-in-backups.md)); notifications are owned as
  shown in the table above (owner, NO-3,
  [#26](https://github.com/guneet-xyz/shinan/issues/26)).
- §9: the documents were written in parallel rather than glossary first; shared
  terms were kept aligned by re-reading the glossary draft and by the integration
  review ([#26](https://github.com/guneet-xyz/shinan/issues/26)).

## 9. How the documents are produced

1. **Owner review of this plan.** Changes are made here before anything else starts.
2. **Authors.** One agent per document, each with its own issue, branch and pull
   request. The domain model and glossary is written first because every other
   document depends on it.
3. **Per-document review.** A separate reviewer agent checks each document for
   completeness, clarity, unsupported claims and decisions without reasons. The
   author addresses its findings.
4. **Owner review of each document.** The owner reviews each document after its
   per-document review. A document merges once the owner approves it.
5. **Integration review.** Once every document is approved, one agent reads them
   all together and checks that terms, objects, decisions and integration points
   agree. It reports contradictions and gaps as issues, which are fixed through
   pull requests.
6. **Owner review of the final set.** The owner reviews the complete, integrated
   plan before it is treated as accepted.

Conventions for all documents:

- Use the glossary's terms exactly.
- Mark every statement as decided, proposed or open.
- Give the reason for every decision.
- Link to other documents rather than repeating them.

## 10. Phases after the documents

| Phase                                 | Outcome                                                                                                                                                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Documents                          | This plan and the in-depth documents above, reviewed and accepted.                                                                                                                                                      |
| 1. First version and proof of concept | Catalog (wiki and agent index), tasks, GitHub and Forgejo connectors, timeline, MCP server and skill, OpenCode plugin for presence. Tried on a few projects while the `workspace` repository stays the source of truth. |
| 2. Collaboration and migration        | Board, nudges, triage inbox, notifications. Move the `workspace` repository into Shinan once it is judged ready.                                                                                                        |
| 3. Agents run by Shinan               | Optional: start agents from the website. Depends on how phases 1 and 2 go.                                                                                                                                              |
