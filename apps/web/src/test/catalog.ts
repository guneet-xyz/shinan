import type { CatalogEntity, CatalogFact } from "@shinan/api-client"

/*
 * A small catalog for the catalog pages' tests: the index answer, the
 * sidebar's tree, and Musashi's page with a disagreement, a fact due for a
 * recheck, an unknown, relations both ways and a body.
 */

export const answer = {
  catalog_commit: "1234567890abcdef1234567890abcdef12345678",
  index_behind: false,
}

/** A small catalog's tree, as the sidebar reads it. */
export const tree = {
  ...answer,
  attention: 2,
  items: [
    {
      path: "machine/musashi.md",
      id: "machine/musashi",
      title: "Musashi",
      kind: "entity",
      status: "active",
    },
    {
      path: "service/registry.md",
      id: "service/registry",
      title: "Container registry",
      kind: "entity",
      status: "active",
    },
  ],
}

export const check = {
  checked: "2026-11-14",
  by: "guneet via opencode-daedalus",
  scope: "df -h on the data disk",
  source: "https://git.guneet.dev/infra/musashi/issues/93",
  limits: "Root disk not inspected",
}

export function fact(
  over: Partial<CatalogFact> & { key: string },
): CatalogFact {
  return {
    identity: `${over.key}|${over.state ?? "observed"}`,
    state: "observed",
    many: false,
    relation: false,
    in_schema: true,
    check,
    freshness: { status: "fresh", age_days: 4, recheck_days: 30, due_at: null },
    ...over,
  }
}

export const musashi: CatalogEntity = {
  id: "machine/musashi",
  type: "machine",
  title: "Musashi",
  summary: "Azure VM that runs the shared production stacks.",
  status: "active",
  owner: "person/guneet",
  replaced_by: null,
  aliases: ["machine/old-musashi"],
  imported_from: null,
  path: "machine/musashi.md",
  blob: "abcdef1234567890abcdef1234567890abcdef12",
  facts: [
    fact({
      key: "disk.data.size",
      identity: "disk.data.size|observed|via=filesystem",
      value: "128 GiB",
      via: "filesystem",
    }),
    fact({
      key: "disk.data.size",
      identity: "disk.data.size|observed|via=instance-metadata",
      value: "64 GB",
      via: "instance-metadata",
      note: "Metadata lags after a resize",
    }),
    fact({
      key: "disk.data.free",
      value: "74 GiB",
      freshness: {
        status: "due",
        age_days: 40,
        recheck_days: 7,
        due_at: "2026-10-21T00:00:00.000Z",
      },
    }),
    fact({
      key: "network.public_ipv6",
      state: "unknown",
      note: "Reachability not tested",
      check: null,
      freshness: {
        status: "not-checked",
        age_days: null,
        recheck_days: null,
        due_at: null,
      },
    }),
    fact({
      key: "configured-by",
      identity: "configured-by|intended|to=project/infra",
      state: "intended",
      relation: true,
      many: true,
      to: "project/infra",
    }),
    fact({
      key: "secrets-in",
      identity: "secrets-in|observed|to=service/vault|item=musashi/ssh",
      relation: true,
      many: true,
      to: "service/vault",
      attributes: { item: "musashi/ssh" },
    }),
  ],
  relations: {
    outgoing: [
      {
        key: "configured-by",
        to: "project/infra",
        state: "intended",
        identity: "configured-by|intended|to=project/infra",
        attributes: {},
        entity: {
          id: "project/infra",
          type: "project",
          title: "Infrastructure",
          summary: null,
          status: "active",
          owner: null,
        },
      },
    ],
    incoming: [
      {
        key: "runs-on",
        inverse: "services",
        from: {
          id: "service/registry",
          type: "service",
          title: "Container registry",
          summary: null,
          status: "active",
          owner: null,
        },
        state: "intended",
        identity: "runs-on|intended|to=machine/musashi",
        attributes: {},
      },
    ],
  },
  discrepancies: [
    {
      key: "disk.data.size",
      values: ["128 GiB", "64 GB"],
      accepted: false,
      facts: [
        "disk.data.size|observed|via=filesystem",
        "disk.data.size|observed|via=instance-metadata",
      ],
    },
  ],
  known_unknowns: ["network.public_ipv6|unknown"],
  not_yet_recorded: { missing_keys: ["role"], not_checked: [] },
  applies: {
    policies: [
      {
        entity: {
          id: "policy/deploy-approval",
          type: "policy",
          title: "Deployment approval",
          summary: null,
          status: "active",
          owner: null,
        },
        through: "workspace",
        state: "intended",
        identity: "applies-to|intended|to=workspace",
      },
    ],
    runbooks: [],
  },
  body: [
    {
      heading: "Musashi",
      level: 1,
      anchor: "musashi",
      text: "# Musashi\n\nRuns the [registry](service/registry).\n\n",
    },
    {
      heading: "Cautions",
      level: 2,
      anchor: "cautions",
      text: "## Cautions\n\n<script>alert(1)</script> Never reboot on Fridays.\n",
    },
  ],
  problems: [],
}
