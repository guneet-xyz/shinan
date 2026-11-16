# Shinan: high-level plan

Status: **draft for owner review** ([issue #1](https://github.com/guneet-xyz/shinan/issues/1)).
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
  server and a skill. Shinan does not run a model.

The first user is us. Shinan should replace the `workspace` repository's catalog
and its cross-project coordination issues.

### The name

Shinan (指南) means instruction or guidance. It comes from the south-pointing
chariot, an ancient Chinese compass, and was the title of the shogun's sword
instructors (剣術指南役). Read as `shinan.ai`, it also sounds like *shinanai*,
"won't die".

## 2. Who it is for

1. **Now:** us. One owner, several agents, many repositories on GitHub and Forgejo,
   and a small fleet of machines.
2. **Later, if it proves itself:** small teams that run many projects or
   machines, such as agencies, consultancies and small infrastructure teams.

Building a business is not a goal of this phase (decision D-013).

## 3. What Shinan does not do

- Replace git hosts. No code review, CI, PR interface or per-repository issue
  tracker.
- Run models or host agents (at least until a later phase).
- Copy facts that another system owns. The catalog links to the owning source.
- Track human versus agent identity as a selling point. Attribution is
  necessary, but every competitor has it.

## 4. Product pillars

| Pillar | Summary | Owning document |
|---|---|---|
| Catalog | Typed entities (project, machine, service, runbook, decision, policy, person, agent). Each fact has a state (intended, observed, proposed, unknown), a source and a last-checked time. Agents propose changes; people approve where needed. | Catalog |
| Tasks | Host-neutral task with a stable ID (for example `T-123`). It holds the intent, acceptance criteria and decisions. Its status is calculated from linked work, not maintained by hand, apart from states only a person can set, such as "needs a person" (today's `human-effort` label). | Tasks and work |
| Timeline | One stream of events across hosts, with each action credited to a person or to an agent acting for a person. Human activity stands out; agent activity is compact. | Human experience |
| Agent presence | Which agent sessions are running, what task and repository each is on, and when each was last seen. Sessions connected only through MCP are marked "self-reported". | Agent integrations |
| Nudges | When a person comments, the agent session working on the task is told. Sessions with a tool plugin get the message live; others pick it up the next time they check in. If no session is active, the person can ask for a new one. | Tasks and work, agent integrations |
| Wiki and onboarding | The catalog rendered for people, including a "start here" path for a new person or a new agent. | Human experience |

## 5. Integration points

| Integration | Direction | First version |
|---|---|---|
| Git hosts: **GitHub**, **Forgejo** (GitLab later) | Webhooks in, API calls out, periodic reconciliation | Read PRs, issues, comments, checks and merges. Link them to tasks. Post links back where appropriate. |
| Coding agents: actions | MCP server and a skill (plus a CLI), for any agent | Read the catalog, propose catalog changes, create, claim, update and complete tasks, report progress, link work. |
| Coding agents: presence and nudges | A plugin inside each coding tool, starting with OpenCode, then Claude Code | Report session start, busy, idle, waiting and end; attach the session to its task; deliver nudges into the running session. |
| Coding agents: launching | A small program on each machine that starts agents (phase 3) | Start new agent sessions from the website. |
| People | Web app at `shinan.guneet.dev` | Browse the catalog, follow tasks and the timeline, comment, nudge. |
| Identity | Sign-in for people, scoped tokens for agents | To be decided in the identity document. |
| Notifications | Later | Email or chat, not in the first version. |

## 6. Decisions so far

Each decision becomes a decision record with its reasoning. "Accepted" means
agreed in conversation with the owner. "Proposed" means the owning document
must confirm or change it.

| ID | Decision | Why | Status |
|---|---|---|---|
| D-001 | Shinan sits above git hosts and does not replace their issues or PRs. | Work spans GitHub and Forgejo; neither can manage the other, and copying issues creates two sources of truth. | Accepted |
| D-002 | The task is the core object and has a host-neutral ID used in branch names and PR descriptions. | Issue numbers only mean something inside one repository; a host-neutral ID ties work on any host to one story. | Accepted |
| D-003 | A task starts where the intent starts, not where the code lands. Outside issues become tasks automatically. | Every story needs one home, even when its first chapter was written elsewhere. | Accepted |
| D-004 | Agent-driven work links PRs directly; repository issues are created only when people need them there. | Avoids duplicate issues. | Accepted |
| D-005 | Task status is calculated from linked work, not copied by hand. | Copied status goes stale; this matches the current workspace rule. | Accepted |
| D-006 | The catalog is document-first: Markdown with structured fields at the top is the source of truth, and an index for agents is generated from it. | People must be able to read it; this is where Port is weakest and our workspace repository already works well. | Proposed |
| D-007 | Every catalog fact records its state, source and last-checked time. | Trust in the catalog is the main differentiator. | Accepted |
| D-008 | Agents connect from outside through MCP and a skill; Shinan runs no model in the first phases. | Users already pay for and choose their agents; hosting agents is costly and offers little advantage early. | Accepted |
| D-009 | GitHub and Forgejo are the first git hosts. | They are the hosts we use. | Accepted |
| D-010 | Integrate with tools such as Multica, Linear and Plane through their APIs; do not embed them. | Multica's license forbids embedding or hosting for others; integrating keeps Shinan host-neutral. | Accepted |
| D-011 | Private repository, internal brand "Shinan", first deployment at `shinan.guneet.dev`. | `shinan.ai` is too expensive for now; the product is for our own use first. | Accepted |
| D-012 | Self-hostable by design. | We self-host, and it is the clearest gap left by Port and Chartroom. | Proposed |
| D-013 | Business model, open-source licensing and pricing are deferred until Shinan has proved itself in our own use. | No evidence yet of demand outside our own use. | Accepted |
| D-014 | Agents connect at three levels: MCP and a skill for actions (any agent); a plugin per coding tool for presence and live nudges (OpenCode first, then Claude Code); a launcher on each machine for starting agents (phase 3). | MCP alone depends on the agent choosing to report and cannot reach an idle or crashed session. A plugin reports from the tool itself; OpenCode's plugin API can follow session events and send messages into a running session. | Proposed |

## 7. Open questions

These are for the in-depth documents to answer:

1. Technology stack, storage and how the catalog's Markdown and its index stay in sync.
2. How agents get an identity on git hosts (bot accounts, app identities, commit notes) so their actions are not credited to a person.
3. Permissions when a user can see a task but not a private repository it links to.
4. Reconciliation when webhooks are missed, and how freshness is shown.
5. Catalog schema: entity types, required fields and how relationships are expressed.
6. Which machine hosts `shinan.guneet.dev`, and how DNS and deployment are managed. Any deployment needs the owner's approval.
7. How the `workspace` repository's catalog and coordination issues move into Shinan, and what happens to the workspace afterwards.
8. Licensing if the project is ever made public.
9. How far Claude Code and other tools can receive a message in a running session, and how presence works for tools with no plugin.

## 8. Documents to write next

Each document has one owning agent. Documents go under `docs/` and decision
records under `docs/decisions/`.

| Document | Owns |
|---|---|
| Product overview | Vision, users, scope, non-goals, positioning against competitors (Multica, Linear, Port, Chartroom, OpsLevel and others) |
| Domain model and glossary | Shared vocabulary and the core objects (task, work link, catalog entity, fact, actor, agent, agent session, event). Every other document uses these terms. |
| Catalog | Entity types, fact states, provenance, editing and approval, the human view and the agent index |
| Tasks and work | Task lifecycle, IDs and linking conventions, calculated status, nudges, triage of outside issues |
| Identity, agents and permissions | People, agents acting for people, tokens, attribution on git hosts, access rules |
| Git host integrations | GitHub and Forgejo: events, API use, reconciliation, rate limits, what is written back |
| Agent integrations | MCP tools, the skill and the CLI; agent sessions and presence; plugins for each coding tool (OpenCode first); nudge delivery; the conventions agents must follow |
| Human experience | Wiki, onboarding path, task pages, timeline, board, nudges |
| Architecture and operations | System design, storage, sync, deployment at `shinan.guneet.dev`, self-hosting, security, backups |
| Roadmap and migration | Phases, first version scope, moving the `workspace` repository into Shinan, success criteria |
| Decision log | One record per decision in section 6 and any new ones |

## 9. How the documents are produced

1. **Owner review of this plan.** Changes are made here before anything else starts.
2. **Authors.** One agent per document, each with its own issue, branch and pull
   request. The domain model and glossary is written first because every other
   document depends on it.
3. **Per-document review.** A separate reviewer agent checks each document for
   completeness, clarity, unsupported claims and decisions without reasons.
4. **Integration review.** One agent reads every document together and checks that
   terms, objects, decisions and integration points agree. It reports
   contradictions and gaps as issues.
5. **Owner review** of the full set before anything is merged as accepted.

Conventions for all documents:

- Use the glossary's terms exactly.
- Mark every statement as decided, proposed or open.
- Give the reason for every decision.
- Link to other documents rather than repeating them.

## 10. Phases after the documents

| Phase | Outcome |
|---|---|
| 0. Documents | This plan and the in-depth documents above, reviewed and merged. |
| 1. First version | Catalog (wiki and agent index), tasks, GitHub and Forgejo connectors, timeline, MCP server and skill, OpenCode plugin for presence. We use it for our own work. |
| 2. Collaboration | Board, nudges, triage inbox, notifications. |
| 3. Agents run by Shinan | Optional: start agents from the website. Depends on how phases 1 and 2 go. |
