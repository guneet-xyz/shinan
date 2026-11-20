ALTER TYPE "public"."event_origin" ADD VALUE 'git_push';--> statement-breakpoint
CREATE TABLE "catalog_allowed_values" (
	"workspace_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"allowed_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_allowed_values_workspace_id_fingerprint_pk" PRIMARY KEY("workspace_id","fingerprint"),
	CONSTRAINT "catalog_allowed_values_fingerprint" CHECK ("catalog_allowed_values"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "catalog_commit_first_pushes" (
	"workspace_id" uuid NOT NULL,
	"commit" text NOT NULL,
	"push_id" uuid,
	"ref" text,
	"first_pushed_at" timestamp with time zone NOT NULL,
	"pusher_kind" text NOT NULL,
	"agent_id" uuid,
	"person_id" uuid,
	"by_label" text NOT NULL,
	"replaces_commit" text,
	CONSTRAINT "catalog_commit_first_pushes_workspace_id_commit_pk" PRIMARY KEY("workspace_id","commit"),
	CONSTRAINT "catalog_commit_first_pushes_commit" CHECK ("commit" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
	CONSTRAINT "catalog_commit_first_pushes_pusher" CHECK (("catalog_commit_first_pushes"."pusher_kind" = 'shinan' and "catalog_commit_first_pushes"."push_id" is null and "catalog_commit_first_pushes"."agent_id" is null) or ("catalog_commit_first_pushes"."pusher_kind" = 'agent' and "catalog_commit_first_pushes"."push_id" is not null and "catalog_commit_first_pushes"."agent_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "catalog_journals" (
	"journal_id" uuid PRIMARY KEY NOT NULL,
	"last_stored" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_push_refs" (
	"push_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"ref" text NOT NULL,
	"old_commit" text,
	"new_commit" text,
	"kind" text NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "catalog_push_refs_push_id_position_pk" PRIMARY KEY("push_id","position"),
	CONSTRAINT "catalog_push_refs_kind" CHECK ("catalog_push_refs"."kind" in ('create', 'update', 'forced-update', 'delete')),
	CONSTRAINT "catalog_push_refs_commits" CHECK (("catalog_push_refs"."old_commit" is null or "old_commit" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$') and ("catalog_push_refs"."new_commit" is null or "new_commit" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'))
);
--> statement-breakpoint
CREATE TABLE "catalog_pushes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"journal_id" uuid NOT NULL,
	"journal_entry" bigint NOT NULL,
	"pushed_at" timestamp with time zone NOT NULL,
	"agent_id" uuid NOT NULL,
	"token_id" uuid,
	"member_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"by_label" text NOT NULL,
	"network_address" "inet",
	"outcome" text NOT NULL,
	"codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"warnings" integer DEFAULT 0 NOT NULL,
	"received_bytes" bigint NOT NULL,
	"received_objects" integer NOT NULL,
	"new_commits" integer NOT NULL,
	CONSTRAINT "catalog_pushes_outcome" CHECK ("catalog_pushes"."outcome" in ('accepted', 'refused', 'check-only'))
);
--> statement-breakpoint
ALTER TABLE "catalog_allowed_values" ADD CONSTRAINT "catalog_allowed_values_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_allowed_values" ADD CONSTRAINT "catalog_allowed_values_allowed_by_person_id_people_id_fk" FOREIGN KEY ("allowed_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_commit_first_pushes" ADD CONSTRAINT "catalog_commit_first_pushes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_commit_first_pushes" ADD CONSTRAINT "catalog_commit_first_pushes_push_id_catalog_pushes_id_fk" FOREIGN KEY ("push_id") REFERENCES "public"."catalog_pushes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_push_refs" ADD CONSTRAINT "catalog_push_refs_push_id_catalog_pushes_id_fk" FOREIGN KEY ("push_id") REFERENCES "public"."catalog_pushes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_pushes" ADD CONSTRAINT "catalog_pushes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_commit_first_pushes_push" ON "catalog_commit_first_pushes" USING btree ("push_id");--> statement-breakpoint
CREATE INDEX "catalog_pushes_workspace_pushed_at" ON "catalog_pushes" USING btree ("workspace_id","pushed_at");--> statement-breakpoint
-- The push log (Git-based catalog plan §2.6) is append-only, like events:
-- pushes and first pushes are never changed or deleted. A push's ref rows
-- change only once, when Git's update of the ref is confirmed. A purge
-- (GC-8) will narrow these triggers for ref names.
CREATE TRIGGER "catalog_pushes_append_only"
  BEFORE UPDATE OR DELETE ON "catalog_pushes"
  FOR EACH ROW EXECUTE FUNCTION "shinan_refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "catalog_pushes_no_truncate"
  BEFORE TRUNCATE ON "catalog_pushes"
  FOR EACH STATEMENT EXECUTE FUNCTION "shinan_refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "catalog_commit_first_pushes_append_only"
  BEFORE UPDATE OR DELETE ON "catalog_commit_first_pushes"
  FOR EACH ROW EXECUTE FUNCTION "shinan_refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "catalog_commit_first_pushes_no_truncate"
  BEFORE TRUNCATE ON "catalog_commit_first_pushes"
  FOR EACH STATEMENT EXECUTE FUNCTION "shinan_refuse_change"();
--> statement-breakpoint
CREATE FUNCTION "shinan_refuse_push_ref_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD."confirmed" = false
    AND NEW."confirmed" = true
    AND (to_jsonb(NEW) - 'confirmed') = (to_jsonb(OLD) - 'confirmed')
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "catalog_push_refs_append_only"
  BEFORE UPDATE OR DELETE ON "catalog_push_refs"
  FOR EACH ROW EXECUTE FUNCTION "shinan_refuse_push_ref_change"();
--> statement-breakpoint
CREATE TRIGGER "catalog_push_refs_no_truncate"
  BEFORE TRUNCATE ON "catalog_push_refs"
  FOR EACH STATEMENT EXECUTE FUNCTION "shinan_refuse_change"();
