/**
 * The catalog document's examples (catalog §2.6, §3.9), as test fixtures.
 * Dockyard is as written there. Musashi wraps the §2.6 excerpt in a whole
 * entity. Kept as strings, not Markdown files, so formatting tools never
 * change their bytes.
 */

export const dockyard = `---
id: project/dockyard
type: project
title: Dockyard
summary: Self-hosted OCI registry with a web UI and access management.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-14
    by: guneet via opencode-daedalus
    scope: Repository, agent instructions and latest release exist
    source: https://github.com/guneet-xyz/dockyard/releases/tag/v0.3.1
    observed:
      repository: https://github.com/guneet-xyz/dockyard
      docs.agent_instructions: https://github.com/guneet-xyz/dockyard/blob/main/AGENTS.md
      release.latest: v0.3.1
  - checked: 2026-11-14
    by: guneet via opencode-daedalus
    scope: Checkouts on Daedalus and Musashi and their revisions
    source: Local git on Daedalus; filtered SSH reads on Musashi (infra/musashi#85)
    limits: The Daedalus infrastructure checkout's submodule was not initialized, so it was not read
    observed:
      checkout-on:
        - { to: machine/daedalus, path: /root/dockyard }
        - { to: machine/musashi, path: /mnt/musashi/stacks/dockyard }
        - { to: machine/musashi, path: /mnt/musashi/stacks/dockyard/dockyard }
      provides: service/container-registry
---

# Dockyard

Musashi builds Dockyard images locally from the source submodule; it does not
run the published images. Do not assume a newer checkout or release is
deployed. See the [container registry](service/container-registry) and the
[Musashi stack rules](https://git.guneet.dev/infra/musashi/src/branch/main/stacks/dockyard/README.md).

## Cautions

The infrastructure checkout on [Daedalus](machine/daedalus) records the
submodule but does not initialize it. Do not initialize it as a side effect of
reading context.
`

export const musashi = `---
id: machine/musashi
type: machine
title: Musashi
summary: Azure VM that runs the shared production stacks.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-13 # a fact check group
    by: guneet via opencode-daedalus
    scope: Read-only check of the VM platform
    source: Read-only SSH and Azure instance metadata (workspace issue 101)
    limits: Public IPs and network security group not inspected
    observed: # facts by state
      platform.vm_size: Standard_D2ps_v6
      platform.arch: aarch64
      disk.root.used: 93%
  - checked: 2026-11-14
    by: guneet via opencode-daedalus
    scope: Online data-disk grow; partition, filesystem and fstab after the change
    source: https://git.guneet.dev/infra/musashi/issues/93
    observed:
      disk.data.size: { value: 128 GiB, via: filesystem }
      disk.data.free: 74 GiB
  - checked: 2026-11-14
    by: guneet via opencode-daedalus
    scope: Azure instance metadata right after the resize
    source: Azure instance metadata (non-sensitive fields), infra/musashi#93
    observed:
      disk.data.size:
        value: 64 GB
        via: instance-metadata
        note: Metadata lags after a resize
  - unknown:
      network.public_ipv6: Reachability not tested
      recovery.tested: The rebuild runbook has not been run
---

# Musashi

Production host for the shared stacks. Grown to 128 GiB online on 2026-11-14
(infra/musashi#93).

## Access prerequisites

Read-only SSH through [ingress](service/ingress) rules; never with a shared
key.
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
  nameservers: { many: true, recheck: 90d }
  served-by: { relation: [service], many: true, inverse: domains }
  configured-by: { relation: [project], inverse: domains }
required: [registrar, served-by]
sections: [Role, Cautions]
---

# Domain

One entity per registered domain, such as \`domain/guneet-dev\`. Records belong
in the DNS configuration repository; link it through \`configured-by\`.
Registrar credentials belong in the secrets manager.
`

/** A \`domain\` entity, to check the schema applies. */
export const guneetDev = `---
id: domain/guneet-dev
type: domain
title: guneet.dev
summary: The team's main domain.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-15T10:30Z
    by: guneet
    scope: Registrar dashboard and DNS lookups
    source: Registrar account page; dig NS guneet.dev
    observed:
      registrar: Cloudflare
      nameservers:
        - ada.ns.cloudflare.com
        - bob.ns.cloudflare.com
      served-by: service/cloudflare-dns
  - planned:
      expires_on: { value: 2027-11-15, task: T-12 }
---

# guneet.dev
`

/** The start-here document, in the shape M2-1 proposes (catalog §11). */
export const startHere = `---
id: start-here
title: Start here
summary: The paths through this workspace's catalog for people and agents.
owner: person/guneet
people:
  - to: project/dockyard
    note: What the container registry is and where it is checked out.
  - list: discrepancies
    note: Facts that disagree and need someone to look.
agents:
  - url: https://git.guneet.dev/guneet/workspace/src/branch/main/docs/access-and-safety.md
    note: The access and safety policy; follow it before touching any machine.
  - to: machine/musashi
    note: Production host; read its cautions before any change.
---

# Start here
`

/**
 * Fails the test if reading hit the never-throws backstop (`read-failed`):
 * that is a bug in Shinan or a dependency, not a refusal.
 */
export function noReadFailure<
  T extends { problems: { code: string; message: string }[] },
>(document: T): T {
  const failed = document.problems.find((p) => p.code === "read-failed")
  if (failed) throw new Error(`Reading failed unexpectedly: ${failed.message}`)
  return document
}
