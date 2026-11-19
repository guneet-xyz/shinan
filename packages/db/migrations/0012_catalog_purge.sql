CREATE TABLE "catalog_purges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_person_id" uuid,
	"actor_agent_id" uuid,
	"actor_agent_session_id" uuid,
	"actor_label" text NOT NULL,
	"confidence" "attribution_confidence" NOT NULL,
	"reason" text NOT NULL,
	"counts" jsonb NOT NULL,
	"transaction_id" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	CONSTRAINT "catalog_purges_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "catalog_purges_workspace_id_number" UNIQUE("workspace_id","number"),
	CONSTRAINT "catalog_purges_actor_known" CHECK (("catalog_purges"."actor_kind" not in ('person', 'agent') or "catalog_purges"."actor_person_id" is not null) and ("catalog_purges"."actor_kind" <> 'agent' or "catalog_purges"."actor_agent_id" is not null)),
	CONSTRAINT "catalog_purges_number_positive" CHECK ("catalog_purges"."number" > 0)
);
--> statement-breakpoint
ALTER TABLE "catalog_revisions" ADD COLUMN "purge_id" uuid;--> statement-breakpoint
ALTER TABLE "catalog_purges" ADD CONSTRAINT "catalog_purges_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_purges" ADD CONSTRAINT "catalog_purges_actor_person_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_revisions" ADD CONSTRAINT "catalog_revisions_purge_fk" FOREIGN KEY ("workspace_id","purge_id") REFERENCES "public"."catalog_purges"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_revisions" ADD CONSTRAINT "catalog_revisions_one_source" CHECK ("catalog_revisions"."proposal_id" is null or "catalog_revisions"."purge_id" is null);
--> statement-breakpoint
-- Purge (catalog §9, architecture §4.4) narrows the append-only triggers on
-- events and on catalog revision text: an update may change only the named
-- columns, and only in the transaction that records a purge of the row's
-- workspace in catalog_purges. Deletes and truncation stay refused, as do
-- updates of catalog_revisions itself. The security log's triggers are
-- untouched: no entry can ever be purged (D-049).
CREATE FUNCTION "shinan_refuse_change_except_purge"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND (to_jsonb(NEW) - TG_ARGV) = (to_jsonb(OLD) - TG_ARGV)
    AND EXISTS (
      SELECT 1 FROM "catalog_purges" p
      WHERE p."workspace_id" = OLD."workspace_id"
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
DROP TRIGGER "events_append_only" ON "events";
--> statement-breakpoint
CREATE TRIGGER "events_append_only"
  BEFORE UPDATE OR DELETE ON "events"
  FOR EACH ROW EXECUTE FUNCTION "shinan_refuse_change_except_purge"('summary', 'data');
--> statement-breakpoint
DROP TRIGGER "catalog_revision_documents_append_only" ON "catalog_revision_documents";
--> statement-breakpoint
CREATE TRIGGER "catalog_revision_documents_append_only"
  BEFORE UPDATE OR DELETE ON "catalog_revision_documents"
  FOR EACH ROW EXECUTE FUNCTION "shinan_refuse_change_except_purge"('text');
--> statement-breakpoint
-- A purge's record is what lets its transaction rewrite events and revision
-- text, so it is append-only itself: never deleted, and updated only to
-- fill in its counts, in the transaction that made it.
CREATE FUNCTION "shinan_refuse_purge_record_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD."transaction_id" = pg_current_xact_id()
    AND (to_jsonb(NEW) - 'counts') = (to_jsonb(OLD) - 'counts')
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "catalog_purges_append_only"
  BEFORE UPDATE OR DELETE ON "catalog_purges"
  FOR EACH ROW EXECUTE FUNCTION "shinan_refuse_purge_record_change"();
--> statement-breakpoint
CREATE TRIGGER "catalog_purges_no_truncate"
  BEFORE TRUNCATE ON "catalog_purges"
  FOR EACH STATEMENT EXECUTE FUNCTION "shinan_refuse_change"();
