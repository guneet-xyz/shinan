CREATE TABLE "catalog_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"current_revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_documents_workspace_id_id" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "catalog_index_discrepancies" (
	"document_id" uuid NOT NULL,
	"key" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parser_version" integer NOT NULL,
	"entity_id" text NOT NULL,
	"values" jsonb NOT NULL,
	"identities" text[] NOT NULL,
	"accepted" boolean NOT NULL,
	CONSTRAINT "catalog_index_discrepancies_document_id_key_pk" PRIMARY KEY("document_id","key")
);
--> statement-breakpoint
CREATE TABLE "catalog_index_documents" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"parser_version" integer NOT NULL,
	"kind" text NOT NULL,
	"catalog_id" text,
	"type" text,
	"title" text,
	"summary" text,
	"status" text,
	"owner" text,
	"replaced_by" text,
	"aliases" text[] NOT NULL,
	"imported_from" text,
	"decision_state" text,
	"decided_on" text,
	"decided_by" text,
	"missing_keys" text[] NOT NULL,
	"problems" jsonb NOT NULL,
	"data" jsonb,
	"search_text" text NOT NULL,
	"body" text NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(summary, '')), 'B') || setweight(to_tsvector('english', search_text), 'C') || setweight(to_tsvector('english', body), 'D')) STORED NOT NULL,
	"search_simple" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(to_tsvector('simple', coalesce(summary, '')), 'B') || setweight(to_tsvector('simple', search_text), 'C') || setweight(to_tsvector('simple', body), 'D')) STORED NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_index_facts" (
	"document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parser_version" integer NOT NULL,
	"entity_id" text NOT NULL,
	"identity" text NOT NULL,
	"key" text NOT NULL,
	"state" text NOT NULL,
	"form" text NOT NULL,
	"value" jsonb,
	"to" text,
	"via" text,
	"note" text,
	"task" text,
	"remove" boolean NOT NULL,
	"accepted" text,
	"attributes" jsonb NOT NULL,
	"group_index" integer NOT NULL,
	"many" boolean NOT NULL,
	"relation" boolean NOT NULL,
	"in_schema" boolean NOT NULL,
	"recheck_days" integer,
	"has_check" boolean NOT NULL,
	"checked" text,
	"checked_at" timestamp with time zone,
	"by" text,
	"scope" text,
	"source" text,
	"limits" text,
	"due_at" timestamp with time zone,
	CONSTRAINT "catalog_index_facts_document_id_position_pk" PRIMARY KEY("document_id","position")
);
--> statement-breakpoint
CREATE TABLE "catalog_index_relations" (
	"document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parser_version" integer NOT NULL,
	"from_id" text NOT NULL,
	"from_type" text,
	"key" text NOT NULL,
	"to_id" text NOT NULL,
	"state" text,
	"identity" text,
	"attributes" jsonb NOT NULL,
	"inverse" text,
	"field" boolean NOT NULL,
	CONSTRAINT "catalog_index_relations_document_id_position_pk" PRIMARY KEY("document_id","position")
);
--> statement-breakpoint
CREATE TABLE "catalog_index_sections" (
	"document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parser_version" integer NOT NULL,
	"catalog_id" text,
	"heading" text,
	"level" integer NOT NULL,
	"anchor" text,
	"text" text NOT NULL,
	"start" integer NOT NULL,
	"end" integer NOT NULL,
	"changed_revision" integer NOT NULL,
	"author_kind" "actor_kind" NOT NULL,
	"author" text NOT NULL,
	"least_trusted_kind" "actor_kind" NOT NULL,
	"least_trusted" text NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(heading, '')), 'A') || setweight(to_tsvector('english', text), 'B')) STORED NOT NULL,
	"search_simple" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(heading, '')), 'A') || setweight(to_tsvector('simple', text), 'B')) STORED NOT NULL,
	CONSTRAINT "catalog_index_sections_document_id_position_pk" PRIMARY KEY("document_id","position")
);
--> statement-breakpoint
CREATE TABLE "catalog_index_state" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"parser_version" integer NOT NULL,
	"rebuild_requested_at" timestamp with time zone,
	"rebuilt_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"checked_revision" integer,
	"check_differences" integer,
	"check_details" jsonb
);
--> statement-breakpoint
CREATE TABLE "catalog_revision_documents" (
	"workspace_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"document_id" uuid NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "catalog_revision_documents_document_id_revision_pk" PRIMARY KEY("document_id","revision")
);
--> statement-breakpoint
CREATE TABLE "catalog_revisions" (
	"workspace_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_person_id" uuid,
	"actor_agent_id" uuid,
	"actor_agent_session_id" uuid,
	"actor_label" text NOT NULL,
	"confidence" "attribution_confidence" NOT NULL,
	CONSTRAINT "catalog_revisions_workspace_id_number_pk" PRIMARY KEY("workspace_id","number"),
	CONSTRAINT "catalog_revisions_actor_known" CHECK (("catalog_revisions"."actor_kind" not in ('person', 'agent') or "catalog_revisions"."actor_person_id" is not null) and ("catalog_revisions"."actor_kind" <> 'agent' or "catalog_revisions"."actor_agent_id" is not null)),
	CONSTRAINT "catalog_revisions_number_positive" CHECK ("catalog_revisions"."number" > 0)
);
--> statement-breakpoint
ALTER TABLE "catalog_documents" ADD CONSTRAINT "catalog_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_documents" ADD CONSTRAINT "catalog_documents_current_revision_fk" FOREIGN KEY ("workspace_id","current_revision") REFERENCES "public"."catalog_revisions"("workspace_id","number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_index_discrepancies" ADD CONSTRAINT "catalog_index_discrepancies_document_fk" FOREIGN KEY ("document_id") REFERENCES "public"."catalog_index_documents"("document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_index_documents" ADD CONSTRAINT "catalog_index_documents_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."catalog_documents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_index_facts" ADD CONSTRAINT "catalog_index_facts_document_fk" FOREIGN KEY ("document_id") REFERENCES "public"."catalog_index_documents"("document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_index_relations" ADD CONSTRAINT "catalog_index_relations_document_fk" FOREIGN KEY ("document_id") REFERENCES "public"."catalog_index_documents"("document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_index_sections" ADD CONSTRAINT "catalog_index_sections_document_fk" FOREIGN KEY ("document_id") REFERENCES "public"."catalog_index_documents"("document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_index_state" ADD CONSTRAINT "catalog_index_state_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_revision_documents" ADD CONSTRAINT "catalog_revision_documents_revision_fk" FOREIGN KEY ("workspace_id","revision") REFERENCES "public"."catalog_revisions"("workspace_id","number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_revision_documents" ADD CONSTRAINT "catalog_revision_documents_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."catalog_documents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_revisions" ADD CONSTRAINT "catalog_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_revisions" ADD CONSTRAINT "catalog_revisions_actor_person_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_revisions" ADD CONSTRAINT "catalog_revisions_actor_agent_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_index_discrepancies_workspace_id" ON "catalog_index_discrepancies" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "catalog_index_documents_catalog_id" ON "catalog_index_documents" USING btree ("workspace_id","catalog_id");--> statement-breakpoint
CREATE INDEX "catalog_index_documents_type_status" ON "catalog_index_documents" USING btree ("workspace_id","kind","type","status");--> statement-breakpoint
CREATE INDEX "catalog_index_documents_aliases" ON "catalog_index_documents" USING gin ("aliases");--> statement-breakpoint
CREATE INDEX "catalog_index_documents_search" ON "catalog_index_documents" USING gin ("search");--> statement-breakpoint
CREATE INDEX "catalog_index_documents_search_simple" ON "catalog_index_documents" USING gin ("search_simple");--> statement-breakpoint
CREATE INDEX "catalog_index_facts_entity" ON "catalog_index_facts" USING btree ("workspace_id","entity_id");--> statement-breakpoint
CREATE INDEX "catalog_index_facts_due_at" ON "catalog_index_facts" USING btree ("workspace_id","due_at") WHERE "catalog_index_facts"."due_at" is not null;--> statement-breakpoint
CREATE INDEX "catalog_index_facts_unknown" ON "catalog_index_facts" USING btree ("workspace_id") WHERE "catalog_index_facts"."state" = 'unknown';--> statement-breakpoint
CREATE INDEX "catalog_index_relations_from" ON "catalog_index_relations" USING btree ("workspace_id","from_id");--> statement-breakpoint
CREATE INDEX "catalog_index_relations_to" ON "catalog_index_relations" USING btree ("workspace_id","to_id");--> statement-breakpoint
CREATE INDEX "catalog_index_sections_workspace_id" ON "catalog_index_sections" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "catalog_index_sections_search" ON "catalog_index_sections" USING gin ("search");--> statement-breakpoint
CREATE INDEX "catalog_index_sections_search_simple" ON "catalog_index_sections" USING gin ("search_simple");--> statement-breakpoint
CREATE INDEX "catalog_revision_documents_workspace_id_revision" ON "catalog_revision_documents" USING btree ("workspace_id","revision");--> statement-breakpoint
-- Catalog revisions are never edited (catalog §9): a change is a new
-- revision, and a revert is a new catalog proposal. Purge (M2-10) will
-- narrow these triggers in its own migration, as for events.
CREATE TRIGGER "catalog_revisions_append_only"
  BEFORE UPDATE OR DELETE ON "catalog_revisions"
  FOR EACH ROW EXECUTE FUNCTION "shinan_refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "catalog_revisions_no_truncate"
  BEFORE TRUNCATE ON "catalog_revisions"
  FOR EACH STATEMENT EXECUTE FUNCTION "shinan_refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "catalog_revision_documents_append_only"
  BEFORE UPDATE OR DELETE ON "catalog_revision_documents"
  FOR EACH ROW EXECUTE FUNCTION "shinan_refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "catalog_revision_documents_no_truncate"
  BEFORE TRUNCATE ON "catalog_revision_documents"
  FOR EACH STATEMENT EXECUTE FUNCTION "shinan_refuse_change"();
