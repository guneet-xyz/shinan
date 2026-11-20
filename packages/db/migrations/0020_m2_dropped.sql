-- The drop of M2's catalog tables (Git-based catalog plan §4.2, step 3):
-- the catalog now lives in each workspace's Git repository, moved there by
-- `migrate` (§4.1) after the migrations before this one. This refuses to
-- run unless every workspace with M2 documents has a verified move, so a
-- failed move can never be followed by a drop.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "catalog_documents" d
    WHERE NOT EXISTS (
      SELECT 1 FROM "catalog_moves" m WHERE m."workspace_id" = d."workspace_id"
    )
  ) THEN
    RAISE EXCEPTION 'M2''s catalog tables are kept: a workspace with catalog documents has no verified move into Git. Run migrate with the Git container reachable (SHINAN_GIT_URL).';
  END IF;
END $$;
--> statement-breakpoint
-- By name and in order, without CASCADE: anything else that still depended
-- on these tables would stop the drop rather than go with it.
DROP TABLE "catalog_page_visits";--> statement-breakpoint
DROP TABLE "catalog_proposal_comments";--> statement-breakpoint
DROP TABLE "catalog_revision_documents";--> statement-breakpoint
DROP TABLE "catalog_documents";--> statement-breakpoint
DROP TABLE "catalog_revisions";--> statement-breakpoint
DROP TABLE "catalog_proposals";--> statement-breakpoint
DROP TYPE "public"."catalog_proposal_state";--> statement-breakpoint
ALTER TABLE "workspaces" DROP COLUMN "catalog_strict";
