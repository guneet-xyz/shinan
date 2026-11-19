# Trial guide

Status: **Proposed** (M2-13, [#93](https://github.com/guneet-xyz/shinan/issues/93)).
This guide is the how-to for the trial of Shinan on its own projects. The
[roadmap](roadmap.md#4-proof-of-concept) owns the rules of the trial and the
[M2 build plan](build-plan-m2.md#4-starting-the-catalog-part-of-the-trial)
owns the order of the start steps; this guide links to them and adds the
detail people and agents need to carry them out. It covers the **catalog part**
of the trial, which starts with milestone M2. The task part (M3) and the
presence part (M4) are added when those milestones are built.

Every path, tool name, command and limit here was checked against what M2
built (`main` at `3d0bf3e`, 2026-11-19): the MCP server (M2-6), the skill and
the **Set up OpenCode** page (M2-9), the catalog's limits (M2-4) and the
operator guide (M2-12).

## Contents

1. [What the trial is](#1-what-the-trial-is)
2. [Who takes part](#2-who-takes-part)
3. [Starting the catalog part, step by step](#3-starting-the-catalog-part-step-by-step)
4. [OpenCode configuration on Daedalus](#4-opencode-configuration-on-daedalus)
5. [Seeding the trial entities](#5-seeding-the-trial-entities)
6. [During the trial](#6-during-the-trial)
7. [How the trial ends and is judged](#7-how-the-trial-ends-and-is-judged)
8. [Appendix: draft of the `workspace` trial note](#appendix-draft-of-the-workspace-trial-note)

## 1. What the trial is

Shinan starts empty and is tried on real work while the `workspace` repository
stays the source of truth for the catalog (decided,
[D-018](decisions/D-018-start-empty-migrate-later.md)). The trial shows
whether Shinan is ready to replace that repository; the owner judges this
from the readiness criteria ([roadmap §5](roadmap.md#5-readiness-criteria)).

- **One workspace,** the trial workspace, holding only the catalog entities the
  trial projects need (decided, owner, O-71,
  [roadmap §4.3](roadmap.md#43-the-catalog-during-the-trial)).
- **The catalog part starts with M2** and the trial widens at M3 (tasks) and
  M4 (presence), as [roadmap §3.3](roadmap.md#33-build-milestones) says. The
  trial's length (R1) counts from M4.
- **Entries are a map, not a source.** Agents fill the trial catalog by
  checking facts where they are owned, using `workspace` repository entries
  only to find those places, and copy nothing (O-71 as amended by the owner
  on 2026-11-18, [section 5](#5-seeding-the-trial-entities)).
- **Both are kept in step.** When a trial entity's facts change, the agent
  doing the work updates the `workspace` repository as today and also makes a
  catalog proposal in Shinan (decided, owner, O-72). A weekly comparison
  reports differences ([6.2](#62-the-weekly-comparison)).
- **During the trial agents act on the `workspace` repository's version** when
  the two disagree (proposed, [roadmap §4.3](roadmap.md#43-the-catalog-during-the-trial)).

## 2. Who takes part

| Who                                                | Role in the trial                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The owner (Guneet)                                 | The only member. Approves the deployment, makes the agent token, approves gated catalog proposals (`person/guneet`, the start-here document), spot-checks samples and judges readiness. Recurring trial work is capped at one hour a week (decided, owner, O-77, [roadmap §4.6](roadmap.md#46-running-the-trial)). |
| OpenCode on Daedalus (`opencode-daedalus`)         | The only agent at trial start (decided, owner, M2-Q5). One full token made by hand. Every agent session started in a trial project's folder on Daedalus uses it ([section 4](#4-opencode-configuration-on-daedalus)).                                                                                              |
| Trial projects: Shinan, mon and easyshell          | Decided (owner, O-70, [roadmap §4.2](roadmap.md#42-trial-projects)). Walls, and guneet.dev with Resume, are in reserve.                                                                                                                                                                                            |
| `infra/musashi`, `infra/anzen`, `guneet/terraform` | Not trial projects; their machine and service entities are added only as far as the trial projects need them ([roadmap §4.2](roadmap.md#42-trial-projects)).                                                                                                                                                       |

Not taking part: other projects, other machines and other coding tools, and
agent sessions on Daedalus started outside the trial folders (for example in
`/root/shinan` or `~/workspace`). They carry on as today.

## 3. Starting the catalog part, step by step

The steps follow [build plan M2 §4](build-plan-m2.md#4-starting-the-catalog-part-of-the-trial).
**Owner** marks a step only the owner can do: a deployment approval, a secret,
or a catalog approval. Agents prepare everything else.

**Before step 1:** all M2 packages are merged; the M2 release is published
and the deployment request M2-12 prepared is ready in `infra/musashi`.

1. **Owner: approve the M2 deployment** to Musashi
   ([D-039](decisions/D-039-deploy-as-needed.md), [D-016](decisions/D-016-musashi-and-deployment-approval.md)),
   through the request M2-12 prepares. An agent then verifies it as the
   request says, including that `https://shinan.guneet.dev/skills/index.json`
   answers without sign-in and `/mcp` refuses a request without a token.
2. **Owner: make the agent and its token, and write the token file.** In
   Shinan, signed in:
   1. Open **Your agents** (`/account/agents`) and go to **Create a token by
      hand**.
   2. Choose the trial workspace and coding tool **OpenCode**, type the
      machine **Daedalus** (the handle becomes `opencode-daedalus`) and access
      **Full**. Leave **Name** empty to take the name the form suggests,
      **OpenCode on Daedalus**. Select **Create token** and sign in again
      when asked.
   3. The token is shown once, with a link to **Set up OpenCode**
      (`/account/agents/setup`). On Daedalus, as root, store it with the
      command in [4.2](#42-the-token-file-owner), the same one that page
      shows. Steps 3 and 4 of that page are replaced on Daedalus by
      [4.3](#43-the-configuration-files) and [4.5](#45-checking-the-setup).
      Do not paste the token into an agent session, an issue or any other
      file.

   Agents never see, copy or relay the token
   ([authentication requirement 3](agent-integrations.md#authentication-requirements)).

3. **Agent: write the three configuration files** of
   [4.3](#43-the-configuration-files) and check them as [4.5](#45-checking-the-setup)
   says. The agent may check the token file's permissions with `stat`, but
   never reads it. Agent sessions on Daedalus run as root, so the file's
   permissions do not stop an agent reading it; only the rule does
   ([4.1](#41-where-the-files-go)).
4. **Owner approves: `person/guneet`.** An agent proposes it (or the owner
   writes it in the wiki): the person entity that owns every trial entity,
   linked to the owner's member record, with responsibilities as prose and no
   contact details ([catalog, person](catalog.md#person)). It is gated
   ([catalog §8.2](catalog.md#82-when-catalog-approval-is-needed)), so it
   applies when the owner approves it. It comes first because every entity
   names it as `owner`, and references must resolve.
5. **Agents: seed the 17 trial entities** ([section 5](#5-seeding-the-trial-entities)).
   These apply on their own (new entities and observed facts are not gated).
6. **Owner: check the seeded entities, right after seeding** and before the
   start-here document: read a few entities in the wiki and the **recent
   changes** list, where every seeding proposal is listed with **Revert**.
   This is the only review the seeded facts get before agents rely on them
   (the strict setting is off, see below); it is part of the M2 milestone
   review. The first accuracy sample is taken from the seeded entities too
   ([6.4](#64-what-to-record)).
7. **Owner approves: the start-here document.** An agent proposes it after
   seeding (see below); the owner reads both paths in the wiki and approves
   it. It has two paths
   ([catalog §11](catalog.md#11-start-here)):
   - **For agents:** the `workspace` repository's policies by URL, because
     policies stay there during the trial (D-018): `AGENTS.md`,
     `docs/access-and-safety.md`, `docs/maintenance.md` and
     `docs/collaboration.md`; then the trial note
     ([appendix](#appendix-draft-of-the-workspace-trial-note)); then how to
     find context for a task in Shinan, and the lists of discrepancies and
     known unknowns.
   - **For people:** the three projects and their deployments, the three
     machines, the services the projects depend on, and the owner, as entity
     steps.

   Decided (owner, M2-Q11, [build plan §7.3](build-plan-m2.md#73-answers-on-the-trial-start-kit)):
   the start-here document is written after seeding, with one approval.
   Reason: its steps point to the trial entities, which must exist for
   validation to pass.

8. **Agent: the trial note.** A `workspace` repository pull request, through
   that repository's own workflow (a Forgejo issue, a task worktree and
   review), adds the catalog part of the trial note and records the
   configuration files in the Daedalus machine entry. The draft is in the
   [appendix](#appendix-draft-of-the-workspace-trial-note). The owner reviewing
   it is recommended, because it changes what agents do; merging it needs no
   deployment approval.
9. **From then on:** [section 6](#6-during-the-trial).

**The strict setting at trial start: off (recommended).** The strict setting
(workspace settings, **Catalog settings**; off by default) holds every agent
proposal that is more than a recheck for catalog approval
([catalog §8.2](catalog.md#82-when-catalog-approval-is-needed)). The owner
decided that only gated changes need approval from the start of the trial,
switching to strict if accuracy slips (O-3, R6), so the trial starts with it
off. The seeded entities are still reviewed: in step 6, right after seeding,
the owner reads them in the wiki, where **recent changes** lists every proposal that applied on its
own, with **Revert**. Leaving it off also keeps seeding moving without the
owner. Turning it on just for seeding would be the other choice: each seeding
session's proposals would then wait, and the owner would clear them with bulk
approval (at most 50 at a time) before the next session, whose relations
point to them. That adds an owner step between sessions and is not needed
while O-3 stands. A bad seeding run still reaches strict early: the first R6
sample comes from the seeded entities ([6.4](#64-what-to-record)), and a
slip there is O-3's signal to switch it on.

## 4. OpenCode configuration on Daedalus

Decided (owner, M2-Q3, implementing O-38): Shinan's MCP server and skill are
enabled by machine-level OpenCode configuration on Daedalus, scoped to the
trial projects' folders, with the token in a root-only file. Nothing is
committed to any repository, and nothing to mon or easyshell. How the scoping
works is in [build plan M2-13](build-plan-m2.md#313-m2-13-trial-start-kit).

### 4.1 Where the files go

| File                                     | Covers                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `/mnt/projects/shinan/opencode.jsonc`    | Shinan's task worktrees (`/mnt/projects/shinan/<issue>-<slug>`) and sessions started in that folder |
| `/mnt/projects/mon/opencode.jsonc`       | mon's clone (`/mnt/projects/mon/mon`), its task worktrees and sessions started in that folder       |
| `/mnt/projects/easyshell/opencode.jsonc` | easyshell's task worktrees and sessions started in that folder                                      |
| `/root/.config/shinan/token`             | The token, root only (`0600` in a `0700` folder), written by the owner                              |

OpenCode merges every `opencode.json(c)` from the session's folder up to the
filesystem root on top of the global configuration
([OpenCode config](https://opencode.ai/docs/config)), so each file reaches
every session below its folder and nothing else. Sessions started elsewhere,
including the canonical checkout `/root/shinan`, do not get Shinan. Trial work
therefore starts in `/mnt/projects/<project>` or a task worktree there, which
is already Daedalus's convention.

"Root only" protects the token from other users, not from agents: agent
sessions on Daedalus run as root, so an agent could read the file. Only the
rule stops it (never read, print or copy the token; the skill and the trial
note say so), and revocation is the remedy if it is broken
([4.6](#46-if-the-token-leaks-or-the-trial-pauses)). The plugin (M4) moves
the token to the machine's credential store where possible
([build plan M2, risks](build-plan-m2.md#5-risks-and-the-hardest-design-points)).

### 4.2 The token file (owner)

As root on Daedalus, in a terminal (not an agent session), run this, then paste
the token and press Enter. Nothing is shown while you paste. It is the command
the **Set up OpenCode** page shows (M2-9, [#119](https://github.com/guneet-xyz/shinan/pull/119);
final form from [#122](https://github.com/guneet-xyz/shinan/pull/122)); as
root, `~/.config/shinan/token` is `/root/.config/shinan/token`.

```sh
bash -c 'umask 077; mkdir -p ~/.config/shinan && chmod 700 ~/.config/shinan && IFS= read -rs t && : > ~/.config/shinan/token && chmod 600 ~/.config/shinan/token && printf "%s\n" "$t" > ~/.config/shinan/token'
```

- It runs in bash whatever shell it is pasted into, so a shell without
  `read -s` never reads the pasted token as a command or keeps it in its
  history.
- The token is read without echo, so it is not on screen, in scrollback or
  terminal logs; `printf` is a bash builtin, so it is never on a command line
  or in the process list.
- The folder ends at 700 and the file at 600 even if they existed before; the
  file is emptied and locked down before the token is written, and ends with
  one newline, which OpenCode drops (4.4).

Agent integrations explains the reasons
([Setting up OpenCode](agent-integrations.md#setting-up-opencode-with-a-hand-made-token)).
Then check, without printing the token:

```sh
stat -c '%a %U %n' /root/.config/shinan /root/.config/shinan/token
grep -cxE 'shinan_agent_[A-Za-z0-9]{43}' /root/.config/shinan/token
```

The first command shows `700 root` and `600 root`; the second prints `1`: an
agent token is `shinan_agent_` followed by 43 letters and digits, 56
characters in all ([identity §7.4](identity.md#74-handling)). If a token is
ever replaced, the same command overwrites the file; OpenCode uses the new
token on its next connection, and `opencode reload` forces it.

### 4.3 The configuration files

The same content in all three files:

```jsonc
// Shinan trial: Shinan's MCP server and skill for this project's folder only.
// Owned by docs/trial.md in guneet-xyz/shinan; recorded in the workspace
// repository's Daedalus entry. The token is read from a root-only file; never
// write it here.
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "shinan": {
        "type": "remote",
        "url": "https://shinan.guneet.dev/mcp",
        "oauth": false,
        "headers": {
          "Authorization": "Bearer {file:/root/.config/shinan/token}",
        },
      },
    },
  },
  "skills": ["https://shinan.guneet.dev/skills/"],
}
```

- `mcp.servers` is OpenCode V2's shape; V2 does not put server names directly
  under `mcp` ([MCP servers](https://opencode.ai/docs/mcp-servers)).
- `oauth: false`, because Shinan has no MCP OAuth in the first version
  (decided, owner, NO-1); the token is the only credential.
- No `protocol` setting (proposed). Shinan's MCP server accepts exactly two
  protocol revisions, 2026-07-28 and 2025-11-25
  ([architecture §8.1](architecture.md#81-mcp-server); M2-6,
  [PR #115](https://github.com/guneet-xyz/shinan/pull/115)). M2-6 checked
  both with OpenCode v2.3.0 against a local server: the default (`legacy`)
  connects over 2025-11-25, and `"protocol": "auto"` connects over 2026-07-28
  (through `server/discover`); both call the tools. Reason for the default:
  one setting fewer, and nothing the trial uses needs 2026-07-28. Adding
  `"protocol": "auto"` later changes nothing else.
- The comment does not contain a file reference on purpose, so nothing in it
  is ever substituted.
- This is the **Set up OpenCode** page's configuration with this
  installation's address, plus the comment. The page writes the token path
  as `~/.config/shinan/token`; the absolute path here is the same file for
  root and does not depend on whose home OpenCode resolves.
- The endpoint is `https://<installation>/mcp` (M2-6,
  [#115](https://github.com/guneet-xyz/shinan/pull/115) and
  [#122](https://github.com/guneet-xyz/shinan/pull/122)). Its tools appear
  as `shinan_<tool>`, or as `tools.shinan.<tool>` under OpenCode's Code Mode:
  - read (any token): `workspace_context`, `search_catalog`, `get_entity`,
    `catalog_lists`, `get_catalog_proposal`;
  - write (a full token): `propose_catalog_change`, `record_fact_check`,
    `withdraw_catalog_proposal`, `comment_on_catalog_proposal`.
- The skill catalog is `https://<installation>/skills/`, served without
  sign-in with its `index.json` ([D-056](decisions/D-056-public-skill-path.md));
  it holds one skill, ID **`shinan`** (M2-9,
  [#119](https://github.com/guneet-xyz/shinan/pull/119)).

### 4.4 OpenCode behaviour this relies on

Checked on **2026-11-18** with OpenCode **v2.3.0** on Daedalus, against its
[config](https://opencode.ai/docs/config),
[MCP servers](https://opencode.ai/docs/mcp-servers) and
[skills](https://opencode.ai/docs/skills) documentation, and by a local test:
a throwaway server on `127.0.0.1` that recorded the `Authorization` header it
received, with a dummy value in a test file (no real token was used).

| Behaviour                                                                                                                                                                                     | How it was checked                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `{file:…}` is substituted **inside a longer string**: `"Bearer {file:/path}"` sent `Bearer <file contents>`. The plan's fallback (the file holding `Bearer …`) also works, and is not needed. | Test. The docs say references go "inside JSON strings" and show `"Bearer {env:MCP_API_KEY}"` for environment variables, but show `{file:…}` only as a whole value. |
| The file's trailing newline is dropped.                                                                                                                                                       | Test: a file written with `printf '%s\n'` gave a header with no newline.                                                                                           |
| A missing file is replaced by an empty string, so the header becomes `Bearer ` and Shinan refuses the request.                                                                                | Docs ("If the file does not exist, it will be replaced with an empty string").                                                                                     |
| A file above a Git checkout applies to sessions in the checkout and in the folder itself, and not to a sibling folder.                                                                        | Test: the server was listed from `<folder>/repo` and `<folder>`, and not from a sibling folder.                                                                    |
| `skills` arrays from every configuration file are combined, so the global `~/workspace/.opencode/skills` entry stays.                                                                         | Docs (skills, "Sources").                                                                                                                                          |
| `opencode debug config` shows the `Authorization` header as `***`.                                                                                                                            | Test.                                                                                                                                                              |
| After the token file changes, the next connection uses the new value; `opencode reload` reloads configuration explicitly.                                                                     | Test.                                                                                                                                                              |
| The first `opencode mcp list` in a folder OpenCode has not loaded yet can print "No MCP servers configured"; a second run a few seconds later shows the server.                               | Test (both with the background service and `--standalone`).                                                                                                        |

### 4.5 Checking the setup

From each folder below, run `opencode mcp list` (twice if the first run says
"No MCP servers configured", see 4.4):

| Folder                                                    | Expected              |
| --------------------------------------------------------- | --------------------- |
| A Shinan task worktree, `/mnt/projects/shinan/<task>`     | `✓ shinan  connected` |
| `/mnt/projects/mon/mon`                                   | `✓ shinan  connected` |
| `/mnt/projects/easyshell` (or a task worktree there)      | `✓ shinan  connected` |
| `/root`, `/root/shinan`, `/root/workspace`                | `shinan` not listed   |
| Another project's folder, such as `/mnt/projects/musashi` | `shinan` not listed   |

Then, from a trial folder, an agent session loads the `shinan` skill and
calls `workspace_context`; the answer names the agent `opencode-daedalus`
(OpenCode on Daedalus) and the trial workspace. Record the
results in [#93](https://github.com/guneet-xyz/shinan/issues/93).

### 4.6 If the token leaks or the trial pauses

The owner revokes the token in Your agents; it stops working at once
([identity §7.5](identity.md#75-revocation)). To switch Shinan off for the
trial folders without deleting anything, set `"disabled": true` on the
`shinan` server in the three files, or remove them. A leaked token is a pause
condition ([roadmap §4.6](roadmap.md#46-running-the-trial), RM-10).

## 5. Seeding the trial entities

### 5.1 The entities

Decided (owner, O-71, widened by M2-Q9 on 2026-11-18,
[roadmap §4.3](roadmap.md#43-the-catalog-during-the-trial),
[build plan §7.3](build-plan-m2.md#73-answers-on-the-trial-start-kit)): 17
entities. The map entry is the `workspace` repository file an agent reads to
find the owning sources. The four deployment services have no entry of their
own there; their map is the deployment part of the project entry, which links
the owning stack documentation in `infra/musashi` (and `infra/anzen` for mon's
agents).

| Entity                       | Map entry in the `workspace` repository                                 | Seeding session |
| ---------------------------- | ----------------------------------------------------------------------- | --------------- |
| `machine/musashi`            | `catalog/machines/musashi.md`                                           | 1. Machines     |
| `machine/anzen`              | `catalog/machines/anzen.md`                                             | 1. Machines     |
| `machine/daedalus`           | `catalog/machines/daedalus.md`                                          | 1. Machines     |
| `service/ingress`            | `catalog/services/ingress.md`                                           | 2. Services     |
| `service/container-registry` | `catalog/services/container-registry.md`                                | 2. Services     |
| `service/cloudflare-dns`     | `catalog/services/cloudflare-dns.md`                                    | 2. Services     |
| `service/obscuro`            | `catalog/services/obscuro.md`                                           | 2. Services     |
| `service/email`              | `catalog/services/email.md`                                             | 2. Services     |
| `service/forgejo`            | `catalog/services/forgejo.md`                                           | 2. Services     |
| `service/monitoring`         | `catalog/services/monitoring.md`                                        | 2. Services     |
| `service/shinan`             | `catalog/projects/shinan.md`, "Deployment"                              | 3. Deployments  |
| `service/mon-private`        | `catalog/projects/mon.md`, private board                                | 3. Deployments  |
| `service/mon-public`         | `catalog/projects/mon.md`, public board                                 | 3. Deployments  |
| `service/easyshell`          | `catalog/projects/easyshell.md`, "Deployment and cross-project context" | 3. Deployments  |
| `project/shinan`             | `catalog/projects/shinan.md`                                            | 4. Projects     |
| `project/mon`                | `catalog/projects/mon.md`                                               | 4. Projects     |
| `project/easyshell`          | `catalog/projects/easyshell.md`                                         | 4. Projects     |

Rechecked against the `workspace` repository at `e3daaba` (2026-11-19, read
only): the 13 map entries exist and are all `active`, the other entries there
are outside the trial, and the four deployments still have no entry of their
own, so their map stays the project entries' deployment parts. Seeding reads
the entries again at the `origin/main` of the day (5.3).

Every entity has `owner: person/guneet` and keeps the entry's status
(`active`). The old IDs (`musashi`, `shinan` and so on) are not added as
aliases, because these are not imports. Deployment facts (version, endpoint,
where it runs) go only on the deployment services; each project `provides`
its deployment services (O-16, [catalog, service](catalog.md#service)).

### 5.2 Sessions and order

**Proposed:** four agent sessions, one per group, run in the order of the
table, each started from `/mnt/projects/shinan` (so it has Shinan) with the
issue for its group. Reason: relations point from projects to services and
machines, and from services to machines and other services, and their targets
must exist first ([catalog §8.3](catalog.md#83-validation)); a group per
session keeps each session's context small (build plan, risks: seeding cost).
Each session reads the skill before starting.

### 5.3 How each fact is recorded

The rules are the build plan's ([M2 §4, step 4](build-plan-m2.md#4-starting-the-catalog-part-of-the-trial))
and the catalog's ([§4](catalog.md#4-facts), [§13](catalog.md#13-mapping-from-the-workspace-repositorys-catalog));
as a procedure, for each entity:

1. **Read the map entry** at the current `origin/main` of the `workspace`
   repository and note its revision. Use it only to find owning sources: the
   linked repositories, stack READMEs, issues and documented observations.
2. **Check each fact at its owning source,** within the agent's existing
   access: read the repository or its README, the infrastructure
   repository's stack documentation, the git host, a public HTTPS request, a
   public DNS query. Record it as `observed` (or `intended`, when the source
   states intent, such as a Compose file pinned to a revision) in a fact check
   with the real check time, a narrow scope and the source
   ([catalog §4.5](catalog.md#45-fact-checks)).
3. **Pointers** (repository URLs, issue trackers, documentation links, IDs)
   are checked by opening them, which makes them ordinary `observed` facts.
   Nothing is copied from the entry; a pointer the agent cannot open is
   `unknown` (decided, owner, M2-Q10). Reason: every trial pointer is a link an
   agent can normally open, so checking costs little and gives real check
   times. Validation is unchanged: `checked: null` and `by: unknown` are only
   for imports ([catalog §8.3](catalog.md#83-validation)), which trial
   entities are not.
4. **What cannot be checked within existing access is `unknown`**
   ([catalog §4.8](catalog.md#48-unknowns)), with a short note of why.
   Seeding never widens access (P6): no new SSH connections, no scanning, no
   new logins or credentials. A fact whose only evidence is the map entry's
   own prose, with no owning source the agent can read, is `unknown`.
5. **No secrets.** Only where a secret lives, as a `secrets-in` relation to
   `service/obscuro` with the namespace as its `item`
   ([catalog §7.2](catalog.md#72-where-secrets-live)). Tailnet addresses and
   SSH host-key fingerprints are not secrets and may be facts.
6. **Relations only between trial entities.** Relations to entities outside
   the 17 (for example `configured-by project/musashi`, or `on-network
service/tailscale`) are not written, because their targets do not exist.
   The body says it in prose with a link to the owning repository, and the
   session lists them in its report. Adding more entities needs the owner
   (O-71 and M2-Q9 fixed the list).
7. **Dated history stays in the body**; current-state claims become facts
   ([catalog §2.5](catalog.md#25-body)).
8. **No `imported_from`:** trial entities are not imports.
9. **Propose** through `propose_catalog_change` with an explanation naming the map entry's path and revision, and
   check the answer: applied, or waiting for approval and why. A validation
   warning (for example a secret-looking value) holds the proposal for the
   owner; fix the cause rather than asking for approval where possible.

Each session ends with a short report in its issue: the entities created, the
facts recorded as `unknown` and why, the relations left out, and anything in
the map entry that the owning source contradicted (a trial finding,
[6.3](#63-trial-findings)).

### 5.4 Limits an agent may hit

As built in M2 (catalog §8 and the [operator guide](operator-guide.md#agents-the-mcp-endpoint-tokens-and-the-skill)).
Seeding 17 entities, one proposal or a few per entity, stays far below all of
them; they matter for a session that tries to do everything in one call.

| Limit                                                                                                                                                                                                                     | What happens                                                                                                                     | What the agent does                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| One proposal: at most 50 operations naming at most 100 facts, an explanation of 4,000 characters, 256 KiB                                                                                                                 | Refused before anything is stored                                                                                                | Split the change into several proposals (for example one per entity)              |
| A proposal that takes more than 20 seconds to apply                                                                                                                                                                       | Stopped; error `invalid-input`, rule `too-complex`                                                                               | Split it                                                                          |
| 60 catalog proposals (and 60 comments) per agent in 10 minutes                                                                                                                                                            | Tool error `busy`, with `retry_after_seconds`                                                                                    | Send the same call, with the **same idempotency key**, after that many seconds    |
| Other proposals for the workspace are being applied                                                                                                                                                                       | Tool error `busy` ("send this one again in a few seconds")                                                                       | The same: same key, after `retry_after_seconds`                                   |
| 300 MCP requests a minute per address (shared with `/api` from that address) and 600 per token. Every session on Daedalus comes from one address, so **300 a minute across all trial sessions** is the trial's real limit | HTTP 429, "Too many attempts. Wait a minute and try again.", with `Retry-After` giving the seconds left in the minute (up to 60) | Wait that long (up to a minute) before calling again; calling at once fails again |
| 8 requests in flight per token, 16 per address                                                                                                                                                                            | HTTP 429 with `Retry-After: 1`, before the body is read                                                                          | Call again after a second; in practice only many parallel tool calls reach it     |
| A catalog of at most 20,000 documents and 50 MiB of text                                                                                                                                                                  | Error `catalog-full`                                                                                                             | Not reachable by the trial catalog                                                |

For either 429, OpenCode retries twice (after 250 ms and 1 s) only while
connecting and listing tools; a **tool call** that gets 429 fails at once,
and the agent sees the error and decides when to call again
([operator guide](operator-guide.md#agents-the-mcp-endpoint-tokens-and-the-skill)).
The skill tells agents how to handle `busy`
(`references/changing.md` in [`packages/skill`](../packages/skill/skill/shinan/)).
A `busy` error or a 429 is not a trial finding by itself; repeated ones that
block work are.

## 6. During the trial

### 6.1 Keeping both in step

Decided (owner, O-72): when an agent updates a trial entity's entry in the
`workspace` repository, it also makes a catalog proposal in Shinan with the
same change, checked the same way, within two days (the R7 window). Agents in
trial folders are told this by the trial note; agents elsewhere are not, so
the weekly comparison catches what they change.

### 6.2 The weekly comparison

**Proposed** agent procedure, run once a week by an agent session started in
`/mnt/projects/shinan` (by the owner, until the readiness report automates it
in M3, O-75). It reads only, except for the proposals and findings it files.

1. Fetch the `workspace` repository and use an isolated snapshot of
   `origin/main`; note its revision. Take the previous comparison's
   `workspace` revision and Shinan catalog revision from the last comparison
   comment (below).
2. List the commits since the previous revision that touch the map entries
   of [5.1](#51-the-entities) (`git log <previous>..origin/main -- <their paths>`), with their merge
   dates.
3. For each, find the matching catalog proposal in Shinan (the catalog
   changes since the previous catalog revision). Count it as **matched in
   time** (applied within two days of the merge), **late** or **missing**.
4. For each missing change, make the catalog proposal now, checked at the
   owning source as in [5.3](#53-how-each-fact-is-recorded) (not copied from
   the entry).
5. Compare each trial entity's current facts with its entry. Where they
   disagree: if Shinan's fact check is newer, the entry may be the error; if
   the entry's evidence is newer, Shinan may be. Recheck at the owning source
   if access allows, record the result in Shinan (a discrepancy if the two
   facts conflict, [catalog §4.7](catalog.md#47-discrepancies)), and file a
   trial finding. The fix goes wherever the evidence shows the error, which
   may be a `workspace` repository pull request. Agents keep acting on the
   `workspace` repository's version meanwhile.
6. Note the facts due for recheck and the known unknowns in Shinan's lists.
7. Post the result as a comment on the trial's tracking issue: one
   long-lived GitHub issue in `guneet-xyz/shinan` labelled `trial`, opened at
   trial start, with a comment per week so the history stays in one place
   (proposed). The comment gives both
   revisions, the counts from step 3, the disagreements found and the
   findings filed. No secret values and no token in it.

### 6.3 Trial findings

Bugs, gaps and friction found during the trial are GitHub issues in
`guneet-xyz/shinan` with the **`trial`** label (proposed,
[roadmap §4.4](roadmap.md#44-tasks-during-the-trial)), plus `bug` or
`enhancement` where they fit. Reason: findings must be recordable even when
Shinan is down. Each says what happened, where (entity, tool or screen), the
evidence (without secret values or tokens), which readiness criterion it
touches if any, and whether it is a pause condition (below).

### 6.4 What to record

From M2, the catalog part produces evidence for these criteria
([roadmap §5](roadmap.md#5-readiness-criteria)); agents prepare every sample
and the owner spot-checks (decided, owner, O-77):

| Criterion               | What is recorded                                                                                                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R5 Provenance           | That every fact has a state, a source and a check time, or is `unknown`. Validation enforces most of it; any exception is a finding.                                                                                                                                                                   |
| R6 Catalog accuracy     | Samples of 30 facts rechecked at their owning sources: correct, correctly stale or `unknown`, or wrong with the reason. **The first sample is taken from the seeded entities, in the first trial week**, so a bad seeding run shows early. A slip is the signal to switch on the strict setting (O-3). |
| R7 Catalog kept current | The weekly comparison's counts, and stale or `unknown` facts fixed as a side effect of task work.                                                                                                                                                                                                      |
| R11 Security            | Findings from secret scans of catalog content; any secret in the catalog is a pause condition, and is purged ([catalog §9](catalog.md#9-history-and-purge)) and rotated at its source.                                                                                                                 |
| R12 Useful to the owner | Each time the owner falls back to the `workspace` repository for a trial question, a finding or a note in the tracking issue.                                                                                                                                                                          |
| R13 Useful to agents    | Partly measurable from M2: sessions that took context from Shinan or from the `workspace` repository. Agent sessions are recorded only from M4.                                                                                                                                                        |
| The owner's time        | Minutes spent on trial work each week, against the one-hour cap (O-77).                                                                                                                                                                                                                                |

### 6.5 If Shinan is down or wrong

Agents carry on from the `workspace` repository, which stays the source of
truth (D-018), and file a finding; nothing in the trial may block real work
([roadmap §4.4](roadmap.md#44-tasks-during-the-trial)). The pause conditions
are in [roadmap §4.6](roadmap.md#46-running-the-trial) (RM-10): a secret
exposed through Shinan, data loss, Shinan blocking real work for more than a
working day, or an access rule failing. On a pause the owner revokes the token
or disables the server ([4.6](#46-if-the-token-leaks-or-the-trial-pauses));
resuming is the owner's decision.

## 7. How the trial ends and is judged

The [roadmap](roadmap.md) owns this; in short:

- **G1** ([roadmap §2](roadmap.md#2-phases)): two weeks after M4 is deployed,
  no pause condition is active and R2, R5 and R11 are met; the owner decides
  whether to continue into phase 2.
- **Length:** at least four weeks with M4 deployed (R1,
  [roadmap §4.6](roadmap.md#46-running-the-trial)).
- **G2:** the owner judges readiness from the weekly readiness report: every
  must-pass criterion met (R2, R3, R5, R10, R11, R14, R15, R16), the judged
  ones reviewed, and the backup and emergency-access risk reviewed again
  ([roadmap §5](roadmap.md#5-readiness-criteria)). Thresholds are revisited
  after two trial weeks.
- **Then the migration** of the `workspace` repository, a 30-day rollback
  window, and **G3** ([roadmap §6](roadmap.md#6-migrating-the-workspace-repository)).
- **Or a pause** (6.5), or extending the trial with a reserve project if it is
  too small (R1).

## Appendix: draft of the `workspace` trial note

Text only; not yet proposed. At step 8 an agent opens a Forgejo issue in
`guneet/workspace` and a pull request with these changes, through that
repository's [collaboration](https://git.guneet.dev/guneet/workspace/src/branch/main/docs/collaboration.md)
workflow. The task and plugin parts of the note are added at M3 and M4
([roadmap §4.5](roadmap.md#45-agents-in-the-trial)). Placement is proposed:
the note in `docs/collaboration.md`, because that is where agents read how to
work; a pointer in the Shinan project entry; the files in the Daedalus machine
entry, as the build plan says.

### A. New section in `docs/collaboration.md`, after "Task authority"

```markdown
## Shinan trial (catalog part)

Since <date>, [Shinan](../catalog/projects/shinan.md) is being trialled on
itself, [mon](../catalog/projects/mon.md) and
[easyshell](../catalog/projects/easyshell.md). Its
[trial guide](https://github.com/guneet-xyz/shinan/blob/main/docs/trial.md)
owns the details. This repository stays the source of truth for the catalog
until the owner decides Shinan is ready.

For work on a trial project:

- **Use Shinan.** On [Daedalus](../catalog/machines/daedalus.md) it is already
  configured for sessions started in `/mnt/projects/shinan`,
  `/mnt/projects/mon` and `/mnt/projects/easyshell` and their task worktrees:
  its MCP server (`shinan`) and skill load there and nowhere else. Load the
  `shinan` skill before using the catalog. Never read, print or copy the token.
- **Keep both in step.** Whenever you update a trial entity here, also make a
  catalog proposal in Shinan with the same change, checked at the owning
  source, within two days. The trial entities are the three projects above,
  the machines [Musashi](../catalog/machines/musashi.md),
  [Anzen](../catalog/machines/anzen.md) and Daedalus, and the services
  [ingress](../catalog/services/ingress.md),
  [container registry](../catalog/services/container-registry.md),
  [Cloudflare DNS](../catalog/services/cloudflare-dns.md),
  [Obscuro](../catalog/services/obscuro.md),
  [email](../catalog/services/email.md),
  [Forgejo](../catalog/services/forgejo.md) and
  [monitoring](../catalog/services/monitoring.md), plus the deployments of the
  three trial projects (Shinan, mon's private and public boards, easyshell),
  which are described in their project entries here.
- **When the two disagree,** act on this repository's version, and record the
  disagreement as the trial guide says.
- **If Shinan is down,** carry on with this repository alone and file a
  finding in Shinan's issue tracker with the `trial` label.

Coordination issues, task worktrees and the rest of this document are
unchanged for now. Tasks move to Shinan later in the trial, with their own
note.
```

### B. Addition to `catalog/machines/daedalus.md`, under "Storage and agent work placement"

```markdown
- **Shinan trial configuration** (owner decision, <date>,
  [shinan#93](https://github.com/guneet-xyz/shinan/issues/93)): OpenCode files
  `/mnt/projects/shinan/opencode.jsonc`, `/mnt/projects/mon/opencode.jsonc`
  and `/mnt/projects/easyshell/opencode.jsonc` enable Shinan's MCP server and
  skill for sessions in those folders only. They hold no secret; the agent
  token is in the root-only file `/root/.config/shinan/token`, written by the
  owner. Their content is owned by Shinan's
  [trial guide](https://github.com/guneet-xyz/shinan/blob/main/docs/trial.md#4-opencode-configuration-on-daedalus).
  Observed <date>: `opencode mcp list` shows `shinan` connected from those
  folders and absent from `/root` and other project folders.
```

### C. Shinan project entry, "Cross-project context"

Replace "a note will be added when the trial starts" with a link to the new
collaboration section, and change "trial not started" in the phase line to
"catalog part of the trial running since <date>". The facts in that entry are
updated by that day's deployment record as usual.

### D. Changelog entry

```markdown
## <date> (Shinan trial: catalog part)

- Add the [Shinan trial note](docs/collaboration.md#shinan-trial-catalog-part):
  for Shinan, mon and easyshell, agents use Shinan, keep the 17 trial entities
  in step with catalog proposals, and fall back to this repository if Shinan is
  down. Record the machine-level OpenCode files in the
  [Daedalus entry](catalog/machines/daedalus.md). See
  [shinan#93](https://github.com/guneet-xyz/shinan/issues/93) and
  [issue #<n>](https://git.guneet.dev/guneet/workspace/issues/<n>).
```
