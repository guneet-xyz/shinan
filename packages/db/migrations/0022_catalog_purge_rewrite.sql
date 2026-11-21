CREATE TABLE "catalog_ref_fingerprint_keys" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"key" text DEFAULT gen_random_uuid()::text || gen_random_uuid()::text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_rewrites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"journal_id" uuid NOT NULL,
	"journal_entry" bigint NOT NULL,
	"rewritten_at" timestamp with time zone NOT NULL,
	"refs" jsonb NOT NULL,
	"counts" jsonb NOT NULL,
	"ids" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_ref_fingerprint_keys" ADD CONSTRAINT "catalog_ref_fingerprint_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_rewrites" ADD CONSTRAINT "catalog_rewrites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_rewrites_workspace_rewritten_at" ON "catalog_rewrites" USING btree ("workspace_id","rewritten_at");
--> statement-breakpoint
-- A purge as a history rewrite (GC-8, Git-based catalog plan §2.9). Rewrites
-- are append-only like the push log; a later purge may replace text in the
-- branch names they list.
CREATE TRIGGER "catalog_rewrites_append_only"
  BEFORE UPDATE OR DELETE ON "catalog_rewrites"
  FOR EACH ROW EXECUTE FUNCTION "shinan_refuse_change_except_purge"('refs');
--> statement-breakpoint
CREATE TRIGGER "catalog_rewrites_no_truncate"
  BEFORE TRUNCATE ON "catalog_rewrites"
  FOR EACH STATEMENT EXECUTE FUNCTION "shinan_refuse_change"();
--> statement-breakpoint
-- The first-pusher record stays append-only, except that a purge may replace
-- text in a row's branch name, in the transaction that records the purge.
DROP TRIGGER "catalog_commit_first_pushes_append_only" ON "catalog_commit_first_pushes";
--> statement-breakpoint
CREATE TRIGGER "catalog_commit_first_pushes_append_only"
  BEFORE UPDATE OR DELETE ON "catalog_commit_first_pushes"
  FOR EACH ROW EXECUTE FUNCTION "shinan_refuse_change_except_purge"('ref');
--> statement-breakpoint
-- A push's ref rows change once when Git's update is confirmed (false to
-- true), and otherwise only by a purge of their workspace, in its own
-- transaction, which may replace text in the branch name alone. The rows
-- have no workspace of their own: it is their push's.
CREATE OR REPLACE FUNCTION "shinan_refuse_push_ref_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD."confirmed" = false
    AND NEW."confirmed" = true
    AND (to_jsonb(NEW) - 'confirmed') = (to_jsonb(OLD) - 'confirmed')
  THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
    AND (to_jsonb(NEW) - 'ref') = (to_jsonb(OLD) - 'ref')
    AND EXISTS (
      SELECT 1 FROM "catalog_purges" p
      JOIN "catalog_pushes" s ON s."workspace_id" = p."workspace_id"
      WHERE s."id" = OLD."push_id"
        AND p."transaction_id" = pg_current_xact_id()
    )
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
-- The record of each workspace's move into Git (GC-6) holds catalog IDs,
-- which a purged text can be part of: a purge of that workspace may
-- replace text in them, in its own transaction, and nothing else changes.
DROP TRIGGER "catalog_moves_append_only" ON "catalog_moves";
--> statement-breakpoint
CREATE TRIGGER "catalog_moves_append_only"
  BEFORE UPDATE OR DELETE ON "catalog_moves"
  FOR EACH ROW EXECUTE FUNCTION "shinan_refuse_change_except_purge"('waiting_proposals', 'problems');
