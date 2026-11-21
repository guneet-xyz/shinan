/**
 * A small workspace catalog for the agent index's tests: entities of most
 * built-in types, a custom type and a built-in extension, policies and a
 * runbook applying through `applies-to` (to an entity, a type and the whole
 * workspace), a discrepancy, unknowns, and the start-here document. Kept as
 * strings so formatting tools never change their bytes.
 */

/**
 * The date `days` before the day the tests run (UTC), as a fact check
 * writes it. Freshness is judged against the real clock (in SQL as well),
 * so fact checks meant to be fresh are dated from today, never on a fixed
 * date that a recheck period runs out on (#201).
 */
export function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}

/** When most of these fact checks were made: two days ago. */
export const checkedOn = daysAgo(2)
/** When the policies and the runbook were checked: four days before that. */
export const checkedBefore = daysAgo(6)

export const guneet = `---
id: person/guneet
type: person
title: Guneet
summary: Owner of the workspace.
status: active
owner: person/guneet
---

# Guneet

Owns everything here.
`

export const musashi = `---
id: machine/musashi
type: machine
title: Musashi
summary: Azure VM that runs the shared production stacks.
status: active
owner: person/guneet
aliases: [machine/takezo-old]
facts:
  - checked: ${checkedOn}
    by: guneet via opencode-daedalus
    scope: Online data-disk grow
    source: https://git.guneet.dev/infra/musashi/issues/93
    observed:
      disk.data.size: { value: 128 GiB, via: filesystem }
      disk.data.free: 74 GiB
      role: Production host
  - checked: ${checkedOn}
    by: guneet via opencode-daedalus
    scope: Azure instance metadata right after the resize
    source: Azure instance metadata (non-sensitive fields)
    observed:
      disk.data.size:
        value: 64 GB
        via: instance-metadata
        note: Metadata lags after a resize
  - unknown:
      network.public_ipv6: Reachability not tested
---

# Musashi

The shared production host. Grown to 128 GiB on 2026-11-14.

## Cautions

Every deployment change needs the owner's approval.
`

export const daedalus = `---
id: machine/daedalus
type: machine
title: Daedalus
summary: Development host where agents work.
status: active
owner: person/guneet
facts:
  - checked: ${new Date().toISOString().slice(0, 10)}
    by: guneet
    scope: Hostname and role
    source: hostnamectl on Daedalus
    observed:
      hostname: daedalus
      role: Development host
---

# Daedalus

Agents work here.
`

export const takezo = `---
id: machine/takezo
type: machine
title: Takezo
summary: Retired machine kept for its history.
status: retired
owner: person/guneet
---

# Takezo

Replaced long ago.
`

export const dockyard = `---
id: project/dockyard
type: project
title: Dockyard
summary: Self-hosted OCI registry with a web UI and access management.
status: active
owner: person/guneet
facts:
  - checked: ${checkedOn}
    by: guneet via opencode-daedalus
    scope: Checkouts and the registry it provides
    source: Local git on Daedalus
    observed:
      repository: https://github.com/guneet-xyz/dockyard
      checkout-on:
        - { to: machine/daedalus, path: /root/dockyard }
        - { to: machine/takezo-old, path: /mnt/stacks/dockyard }
      provides: service/container-registry
---

# Dockyard

Musashi builds Dockyard images locally. See the
[container registry](service/container-registry).

## Cautions

Do not initialize the submodule as a side effect of reading context.
`

export const registry = `---
id: service/container-registry
type: service
title: Container registry
summary: The registry Dockyard serves on Musashi.
status: active
owner: person/guneet
facts:
  - checked: ${checkedOn}
    by: guneet
    scope: Where it runs
    source: docker ps on Musashi
    observed:
      runs-on: machine/musashi
  - planned:
      endpoint: { value: https://registry.guneet.dev, task: T-12 }
---

# Container registry

Images for every stack.
`

export const deployApproval = `---
id: policy/deploy-approval
type: policy
title: Deployment approval
summary: Every deployment change needs the owner's approval.
status: active
owner: person/guneet
facts:
  - checked: ${checkedBefore}
    by: guneet
    scope: The rule as the owner set it
    source: Owner's statement
    intended:
      enforcement: convention
      applies-to: schema/machine
---

# Deployment approval

Ask before changing anything that is deployed.
`

export const noSecrets = `---
id: policy/no-secrets
type: policy
title: No secrets in the catalog
summary: Secret values never go in the catalog.
status: active
owner: person/guneet
facts:
  - checked: ${checkedBefore}
    by: guneet
    scope: The rule as the owner set it
    source: Owner's statement
    intended:
      enforcement: convention
      applies-to: workspace
---

# No secrets in the catalog

Record where a secret lives, never its value.
`

export const rebuildRunbook = `---
id: runbook/rebuild-musashi
type: runbook
title: Rebuild Musashi
summary: How to rebuild the production host from scratch.
status: active
owner: person/guneet
facts:
  - checked: ${checkedBefore}
    by: guneet
    scope: Which machine it is for
    source: The runbook's own text
    observed:
      changes_deployment: true
      applies-to: machine/musashi
  - unknown:
      last_successful_run: Never run
---

# Rebuild Musashi

## Procedure

Restore the stacks from the infrastructure repository.
`

export const domainSchema = `---
id: schema/domain
title: Domain
summary: A DNS domain the team owns, and where it is registered and served.
status: active
owner: person/guneet
keys:
  registrar: {}
  expires_on: { recheck: 30d }
  served-by: { relation: [service], many: true, inverse: domains }
required: [registrar, served-by]
sections: [Role, Cautions]
---

# Domain

One entity per registered domain.
`

export const guneetDev = `---
id: domain/guneet-dev
type: domain
title: guneet.dev
summary: The main domain.
status: active
owner: person/guneet
facts:
  - checked: 2020-01-01
    by: guneet
    scope: Registrar dashboard
    source: Registrar
    observed:
      registrar: Cloudflare
      expires_on: 2027-01-01
---

# guneet.dev

Served by Cloudflare.
`

export const machineExtension = `---
id: schema/machine
title: Machine
summary: Machines, with what this workspace adds.
status: active
owner: person/guneet
keys:
  ups: {}
---

# Machine

This workspace records the UPS a machine is on.
`

export const startHere = `---
id: start-here
title: Start here
summary: The short path through this catalog.
owner: person/guneet
people:
  - to: machine/musashi
    note: The production host.
agents:
  - to: policy/deploy-approval
    note: Follow it before touching any machine.
  - list: discrepancies
    note: Facts that disagree.
  - url: https://git.guneet.dev/guneet/workspace
    note: The workspace repository, during the trial.
---

# Start here
`

export const allDocuments = [
  guneet,
  musashi,
  daedalus,
  takezo,
  dockyard,
  registry,
  deployApproval,
  noSecrets,
  rebuildRunbook,
  domainSchema,
  guneetDev,
  startHere,
]
