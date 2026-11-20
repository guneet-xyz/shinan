DROP TABLE "catalog_index_discrepancies" CASCADE;--> statement-breakpoint
DROP TABLE "catalog_index_documents" CASCADE;--> statement-breakpoint
DROP TABLE "catalog_index_facts" CASCADE;--> statement-breakpoint
DROP TABLE "catalog_index_provenance" CASCADE;--> statement-breakpoint
DROP TABLE "catalog_index_relations" CASCADE;--> statement-breakpoint
DROP TABLE "catalog_index_sections" CASCADE;--> statement-breakpoint
DROP TABLE "catalog_index_state" CASCADE;--> statement-breakpoint
CREATE TABLE "catalog_index_discrepancies" (
	"workspace_id" uuid NOT NULL,
	"path" text NOT NULL,
	"key" text NOT NULL,
	"parser_version" integer NOT NULL,
	"entity_id" text NOT NULL,
	"values" jsonb NOT NULL,
	"identities" text[] NOT NULL,
	"accepted" boolean NOT NULL,
	CONSTRAINT "catalog_index_discrepancies_workspace_id_path_key_pk" PRIMARY KEY("workspace_id","path","key")
);
--> statement-breakpoint
CREATE TABLE "catalog_index_documents" (
	"workspace_id" uuid NOT NULL,
	"path" text NOT NULL,
	"blob" text NOT NULL,
	"parser_version" integer NOT NULL,
	"rules_version" integer NOT NULL,
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
	"search_simple" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(to_tsvector('simple', coalesce(summary, '')), 'B') || setweight(to_tsvector('simple', search_text), 'C') || setweight(to_tsvector('simple', body), 'D')) STORED NOT NULL,
	CONSTRAINT "catalog_index_documents_workspace_id_path_pk" PRIMARY KEY("workspace_id","path"),
	CONSTRAINT "catalog_index_documents_blob_format" CHECK ("catalog_index_documents"."blob" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$')
);
--> statement-breakpoint
CREATE TABLE "catalog_index_facts" (
	"workspace_id" uuid NOT NULL,
	"path" text NOT NULL,
	"position" integer NOT NULL,
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
	CONSTRAINT "catalog_index_facts_workspace_id_path_position_pk" PRIMARY KEY("workspace_id","path","position")
);
--> statement-breakpoint
CREATE TABLE "catalog_index_relations" (
	"workspace_id" uuid NOT NULL,
	"path" text NOT NULL,
	"position" integer NOT NULL,
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
	CONSTRAINT "catalog_index_relations_workspace_id_path_position_pk" PRIMARY KEY("workspace_id","path","position")
);
--> statement-breakpoint
CREATE TABLE "catalog_index_sections" (
	"workspace_id" uuid NOT NULL,
	"path" text NOT NULL,
	"position" integer NOT NULL,
	"parser_version" integer NOT NULL,
	"catalog_id" text,
	"heading" text,
	"level" integer NOT NULL,
	"anchor" text,
	"text" text NOT NULL,
	"start" integer NOT NULL,
	"end" integer NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(heading, '')), 'A') || setweight(to_tsvector('english', text), 'B')) STORED NOT NULL,
	"search_simple" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(heading, '')), 'A') || setweight(to_tsvector('simple', text), 'B')) STORED NOT NULL,
	CONSTRAINT "catalog_index_sections_workspace_id_path_position_pk" PRIMARY KEY("workspace_id","path","position")
);
--> statement-breakpoint
CREATE TABLE "catalog_index_state" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"commit" text,
	"main_commit" text,
	"parser_version" integer NOT NULL,
	"rules_version" integer NOT NULL,
	"rebuild_requested_at" timestamp with time zone,
	"rebuilt_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"checked_commit" text,
	"check_differences" integer,
	"check_details" jsonb,
	CONSTRAINT "catalog_index_state_commit_format" CHECK ("catalog_index_state"."commit" is null or "catalog_index_state"."commit" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
	CONSTRAINT "catalog_index_state_main_commit_format" CHECK ("catalog_index_state"."main_commit" is null or "catalog_index_state"."main_commit" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$')
);
--> statement-breakpoint
ALTER TABLE "catalog_index_discrepancies" ADD CONSTRAINT "catalog_index_discrepancies_document_fk" FOREIGN KEY ("workspace_id","path") REFERENCES "public"."catalog_index_documents"("workspace_id","path") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_index_documents" ADD CONSTRAINT "catalog_index_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_index_facts" ADD CONSTRAINT "catalog_index_facts_document_fk" FOREIGN KEY ("workspace_id","path") REFERENCES "public"."catalog_index_documents"("workspace_id","path") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_index_relations" ADD CONSTRAINT "catalog_index_relations_document_fk" FOREIGN KEY ("workspace_id","path") REFERENCES "public"."catalog_index_documents"("workspace_id","path") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_index_sections" ADD CONSTRAINT "catalog_index_sections_document_fk" FOREIGN KEY ("workspace_id","path") REFERENCES "public"."catalog_index_documents"("workspace_id","path") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_index_state" ADD CONSTRAINT "catalog_index_state_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_index_documents_catalog_id" ON "catalog_index_documents" USING btree ("workspace_id","catalog_id");--> statement-breakpoint
CREATE INDEX "catalog_index_documents_type_status" ON "catalog_index_documents" USING btree ("workspace_id","kind","type","status");--> statement-breakpoint
CREATE INDEX "catalog_index_documents_versions" ON "catalog_index_documents" USING btree ("workspace_id","parser_version","rules_version");--> statement-breakpoint
CREATE INDEX "catalog_index_documents_aliases" ON "catalog_index_documents" USING gin ("aliases");--> statement-breakpoint
CREATE INDEX "catalog_index_documents_search" ON "catalog_index_documents" USING gin ("search");--> statement-breakpoint
CREATE INDEX "catalog_index_documents_search_simple" ON "catalog_index_documents" USING gin ("search_simple");--> statement-breakpoint
CREATE INDEX "catalog_index_facts_entity" ON "catalog_index_facts" USING btree ("workspace_id","entity_id");--> statement-breakpoint
CREATE INDEX "catalog_index_facts_due_at" ON "catalog_index_facts" USING btree ("workspace_id","due_at") WHERE "catalog_index_facts"."due_at" is not null;--> statement-breakpoint
CREATE INDEX "catalog_index_facts_unknown" ON "catalog_index_facts" USING btree ("workspace_id") WHERE "catalog_index_facts"."state" = 'unknown';--> statement-breakpoint
CREATE INDEX "catalog_index_relations_from" ON "catalog_index_relations" USING btree ("workspace_id","from_id");--> statement-breakpoint
CREATE INDEX "catalog_index_relations_to" ON "catalog_index_relations" USING btree ("workspace_id","to_id");--> statement-breakpoint
CREATE INDEX "catalog_index_sections_search" ON "catalog_index_sections" USING gin ("search");--> statement-breakpoint
CREATE INDEX "catalog_index_sections_search_simple" ON "catalog_index_sections" USING gin ("search_simple");