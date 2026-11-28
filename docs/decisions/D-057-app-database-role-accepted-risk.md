---
id: D-057
title: The application's database role can turn off the append-only triggers; an accepted risk for v0.3.0
status: accepted
date: 2026-11-19
decided_by: owner
evidence: "Owner, in conversation on 2026-11-19; recorded on https://github.com/guneet-xyz/shinan/issues/92#issuecomment-6999453136 (M2-Q14)"
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-057: The application's database role can turn off the append-only triggers; an accepted risk for v0.3.0

Status: **Accepted** by the owner on 2026-11-19, in conversation (recorded on
[issue #92](https://github.com/guneet-xyz/shinan/issues/92#issuecomment-6999453136); M2-Q14 in the
[M2 build plan](../build-plan-m2.md#71-answers)): option B of the
[security checklist](../security-checklist.md#owner-decisions-for-the-m2-release),
as recommended.

## Context

- The security log, events, catalog revision text and purge records are
  append-only because database triggers refuse other changes
  ([security checklist](../security-checklist.md) 6.2 and 6.5).
- `web`, `worker` and `migrate` all connect as `shinan`. In the reference
  Compose file and in Musashi's stack, that role is the PostgreSQL image's
  `POSTGRES_USER`, so it is a superuser that owns every table.
- Such a role can bypass the triggers with `ALTER TABLE … DISABLE TRIGGER`,
  or with no DDL at all with `SET session_replication_role = replica`, which
  skips ordinary triggers. As a superuser it can also reach the database
  container, for example with `COPY … TO PROGRAM`.
- So the triggers stop Shinan's own code from rewriting history by mistake,
  but not someone who has taken over the `web` or `worker` process. Found in
  the review of [#132](https://github.com/guneet-xyz/shinan/pull/132)
  (checklist 6.7).

## Decision

For v0.3.0, `web` and `worker` keep connecting as the owner role. This is
recorded as an accepted risk (checklist 6.7). Running them as a non-owner,
non-superuser role is the first work of M3, before git host credentials or
a second member's data are stored
([#156](https://github.com/guneet-xyz/shinan/issues/156)).

## Reasons

- The risk is to audit integrity after a full compromise of `web` or
  `worker`, which already gives the attacker the session secret, the
  database password and every row. It opens no new way in.
- Every query has parameters (Drizzle), the database is on an internal
  network with no published port, and nothing known lets a request run SQL
  of its choosing.
- The trial has one member and a small catalog.
- The change is not small (below). Doing it under release pressure would put
  the deployment at more risk than the risk it removes.

## Consequences

- **Decided:** checklist 6.7 is an accepted risk for v0.3.0, linked to this
  record and to [#156](https://github.com/guneet-xyz/shinan/issues/156).
- **Decided:** #156 is done before M3 stores git host credentials or a
  second member's data.
- The append-only triggers still guard against mistakes in Shinan's code,
  and their tests stay.

## Alternatives considered

- **Option A: a non-owner role for `web` and `worker` now.** `migrate`
  would keep the owner role; `web` and `worker` would get only row rights.
  Not chosen for v0.3.0, because it needs, besides grants and default
  privileges for later tables:
  - `CREATE` on pg-boss's schema, since pg-boss 12's `createQueue`, which
    the worker calls when it starts, creates a partition table per queue;
  - `MAINTAIN` on the tables purge vacuums (PostgreSQL 17 and later);
  - tests that run as the app role;
  - changes to both the reference Compose file and Musashi's stack, with a
    second role and a new secret on Musashi, a deployment change that needs
    the owner's approval.

## Owning documents

- [Security checklist](../security-checklist.md): item 6.7 and the owner
  decisions for the M2 release.
- [Architecture and operations](../architecture.md): security (section 10).
- [M2 build plan](../build-plan-m2.md): the answer M2-Q14.

## Related open questions

None.

## History

- 2026-11-19: accepted by the owner in conversation, for the M2 release,
  and recorded on [issue #92](https://github.com/guneet-xyz/shinan/issues/92#issuecomment-6999453136) (M2-Q14). Recorded in the M2-12 pull request that completes the security
  checklist ([#155](https://github.com/guneet-xyz/shinan/pull/155)).
- 2026-11-28: accepted again by the owner for v0.4.0, the Git-based
  catalog, with the decision unchanged: the app's database role still owns
  its tables, and #156 fixes it in M3. Asked in GC-11's security review
  ([#173](https://github.com/guneet-xyz/shinan/issues/173)), recorded on
  [#173](https://github.com/guneet-xyz/shinan/issues/173#issuecomment-7239872729),
  and in the checklist's 6.7 by GC-11's pull request
  ([#210](https://github.com/guneet-xyz/shinan/pull/210)).
