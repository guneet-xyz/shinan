---
id: D-054
title: The shinan image project on cr.guneet.dev is public; Musashi pulls without a key
status: accepted
date: 2026-11-17
decided_by: owner
evidence: "Owner, in conversation on 2026-11-17; recorded on https://github.com/guneet-xyz/shinan/issues/73"
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-054: The `shinan` image project on `cr.guneet.dev` is public; Musashi pulls without a key

Status: **Accepted** by the owner on 2026-11-17, in conversation (recorded on
[issue #73](https://github.com/guneet-xyz/shinan/issues/73)).

## Context

- The owner's answer O-66 on
  [issue #25](https://github.com/guneet-xyz/shinan/issues/25) made the
  `shinan` project on `cr.guneet.dev` (Dockyard) private, with a
  project-scoped pull key stored in Obscuro on Musashi. O-66 had no decision
  record; it was decided in
  [architecture §11.4](../architecture.md#114-building-and-releasing) (see the
  [mapping for issue #25](README.md#owner-answers-on-issue-25)).
- The release workflow (`.github/workflows/release.yml`, M1-7) pushes the
  image to `cr.guneet.dev/shinan/shinan` with the repository secrets
  `REGISTRY_USERNAME` and `REGISTRY_PASSWORD`, and attaches BuildKit build
  provenance (`mode=max`) and an SBOM to each image in the registry.
- mon and easyshell images on Musashi are already pulled anonymously from
  public projects on `cr.guneet.dev`
  ([architecture §11.1](../architecture.md#111-facts-about-musashi-that-matter)).
- Checked on 2026-11-17: the registry hands out an anonymous pull token for
  `shinan/shinan`, and with it lists the tags `latest`, `v0.1` and `v0.1.0`
  without any credentials.
- The source repository `guneet-xyz/shinan` is private
  ([D-011](D-011-private-repository-and-brand.md)).

## Decision

The `shinan` project on `cr.guneet.dev` is public. Musashi pulls Shinan's
image anonymously; there is no pull key in Obscuro. This reverses O-66 for the
image registry only; the source repository stays private (D-011).

## Reasons

Owner's choice: simpler than storing a pull key on Musashi.

## Consequences

- **Decided:** anyone can download the image, and with it Shinan's built
  server and web code, while the source repository is private. The provenance
  and SBOM attached to each image (the release commit, the build steps and
  the list of dependencies) are public too.
- **Decided:** the push key is unchanged: the repository secrets
  `REGISTRY_USERNAME` and `REGISTRY_PASSWORD` stay in GitHub, and the release
  workflow pushes with them. Making the project public does not let anyone
  else push.
- **Decided:** no registry credential is stored on Musashi, so the deploying
  agent does not log in to pull.
- **Open:** licensing stays deferred
  ([D-013](D-013-business-model-deferred.md)); a public image does not settle
  it. Owned by the [product overview](../product-overview.md) and the
  [roadmap](../roadmap.md).

## Alternatives considered

- **Recorded:** a private project with a project-scoped pull key stored in
  Obscuro on Musashi (O-66). Not chosen.

## Owning documents

- [Architecture and operations](../architecture.md#114-building-and-releasing):
  building, releasing and pulling the image; what needs deployment approval.
- [Build plan](../build-plan.md#6-owner-actions-for-m1): the owner's actions
  for M1.
- [Operator guide](../operator-guide.md): where the image is published.

## Related open questions

None.

## History

- 2026-11-17: accepted by the owner in conversation; recorded in
  [issue #73](https://github.com/guneet-xyz/shinan/issues/73).
