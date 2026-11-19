---
id: D-058
title: The repository guneet-xyz/shinan is public
status: accepted
date: 2026-11-19
decided_by: owner
evidence: "Owner, in conversation on 2026-11-19; recorded on https://github.com/guneet-xyz/shinan/issues/159#issuecomment-7002059477"
supersedes: []
superseded_by: []
amends: [D-011]
amended_by: []
---

# D-058: The repository `guneet-xyz/shinan` is public

Status: **Accepted** by the owner on 2026-11-19, in conversation (recorded on
[issue #159](https://github.com/guneet-xyz/shinan/issues/159#issuecomment-7002059477)).

## Context

- [D-011](D-011-private-repository-and-brand.md) decided "Private
  repository, internal brand "Shinan", first deployment at
  `shinan.guneet.dev`", and [AGENTS.md](../../AGENTS.md) said "The repository
  is private. Do not copy its content to public places."
- Checked on 2026-11-19: GitHub reports the visibility of
  `guneet-xyz/shinan` as public (`gh repo view --json visibility`). The owner
  confirmed the same day that this is on purpose.
- The image and the skill were already public
  ([D-054](D-054-public-image-registry-project.md),
  [D-056](D-056-public-skill-path.md)).
- Standard GitHub-hosted runners are free in public repositories, and GitHub's
  artifact attestations are available to public repositories on every plan
  ([GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
  checked 2026-11-19).

## Decision

The repository `guneet-xyz/shinan` is public. This amends only the "Private
repository" part of D-011; the internal brand "Shinan" and the first
deployment at `shinan.guneet.dev` are unchanged. Secrets, credentials and
private infrastructure details never go in the repository.

## Reasons

Owner's choice; no reason recorded.

## Consequences

- **Decided:** [AGENTS.md](../../AGENTS.md) says the repository is public and
  that secrets, credentials and private infrastructure details never go in it.
  The rule "do not copy its content to public places" is withdrawn.
- **Decided:** the statements in [D-011](D-011-private-repository-and-brand.md),
  [D-013](D-013-business-model-deferred.md),
  [D-054](D-054-public-image-registry-project.md) and
  [D-056](D-056-public-skill-path.md) that the source repository is or stays
  private no longer hold; each record has a dated note. The
  [roadmap](../roadmap.md) and
  [architecture §11.4](../architecture.md#114-building-and-releasing) are
  corrected the same way.
- **Decided:** the [plan's section 6](../plan.md#6-decisions-so-far) stays as
  the approved snapshot (O-96), so its D-011 row still reads "Private
  repository".
- **Open:** licensing. The repository is public without a licence chosen;
  licensing stays deferred ([D-013](D-013-business-model-deferred.md);
  [plan, question 10](../plan.md#7-open-questions)). Owned by the
  [product overview](../product-overview.md) and the [roadmap](../roadmap.md).
- **Open:** whether to adopt GitHub's artifact attestations or change CI
  runners now that they are available. Owned by
  [architecture §11.4](../architecture.md#114-building-and-releasing).

## Alternatives considered

- **Recorded:** keeping the repository private (D-011). Not chosen.

## Owning documents

- [AGENTS.md](../../AGENTS.md): the working rule.
- [Architecture and operations](../architecture.md#114-building-and-releasing):
  building and releasing.
- [Roadmap and migration](../roadmap.md): the trial projects.

## Related open questions

- Licensing now that the project is public
  ([plan, question 10](../plan.md#7-open-questions)).

## History

- 2026-11-19: accepted by the owner in conversation; recorded on
  [issue #159](https://github.com/guneet-xyz/shinan/issues/159#issuecomment-7002059477).
