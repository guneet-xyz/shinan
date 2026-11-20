-- The drop of M2's catalog tables (Git-based catalog plan §4.2, step 3):
-- the catalog now lives in each workspace's Git repository, moved there by
-- `migrate` (§4.1) after the migrations before this one. This refuses to
-- run unless every workspace with M2 documents or proposals has a verified
-- move of exactly what M2 holds now: its latest revision, its number of
-- documents and the proposals waiting. So a failed move, or anything
-- written to M2's tables after the move (0.3's web or worker still
-- running), can never be followed by a drop.
--
-- The tables are locked first, so nothing can write to them between the
-- check and the drop: a write committed before is seen by the check, and
-- one that comes later waits, then fails once they are gone. The lock is
-- waited for at most 15 seconds (for this transaction only): a session
-- that keeps one of the tables open, such as 0.3's web left running, makes
-- the drop fail with lock_not_available (55P03), which migrate explains,
-- rather than wait for ever.
SET LOCAL lock_timeout = '15s';
--> statement-breakpoint
LOCK TABLE "catalog_page_visits", "catalog_proposal_comments",
  "catalog_revision_documents", "catalog_documents", "catalog_revisions",
  "catalog_proposals" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "workspaces" w
    WHERE (
      EXISTS (SELECT 1 FROM "catalog_documents" d WHERE d."workspace_id" = w."id")
      OR EXISTS (SELECT 1 FROM "catalog_proposals" p WHERE p."workspace_id" = w."id")
    )
    AND NOT EXISTS (
      SELECT 1 FROM "catalog_moves" m
      WHERE m."workspace_id" = w."id"
        AND m."revision" = (
          SELECT coalesce(max(r."number"), 0) FROM "catalog_revisions" r
          WHERE r."workspace_id" = w."id")
        AND m."documents" = (
          SELECT count(*) FROM "catalog_documents" d
          WHERE d."workspace_id" = w."id")
        AND (
          SELECT coalesce(array_agg((e->>'number')::int ORDER BY (e->>'number')::int), '{}')
          FROM jsonb_array_elements(m."waiting_proposals") e
        ) = (
          SELECT coalesce(array_agg(p."number" ORDER BY p."number"), '{}')
          FROM "catalog_proposals" p
          WHERE p."workspace_id" = w."id" AND p."state" = 'pending')
    )
  ) THEN
    RAISE EXCEPTION 'M2''s catalog tables are kept: a workspace''s catalog was not moved into Git, or changed after it was moved (is 0.3''s web or worker still running?). See the operator guide, "Upgrading from 0.3 to 0.4".';
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
