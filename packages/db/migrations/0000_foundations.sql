CREATE TYPE "public"."actor_kind" AS ENUM('person', 'agent', 'shinan', 'outside', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."attribution_confidence" AS ENUM('recorded', 'marked', 'inferred', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."event_origin" AS ENUM('shinan_action', 'webhook', 'reconciliation', 'plugin_report', 'mcp_call');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'contributor');--> statement-breakpoint
CREATE TYPE "public"."security_outcome" AS ENUM('succeeded', 'refused', 'failed');--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"origin" "event_origin" NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_person_id" uuid,
	"actor_agent_id" uuid,
	"actor_agent_session_id" uuid,
	"actor_label" text NOT NULL,
	"confidence" "attribution_confidence" NOT NULL,
	"subjects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"link" text,
	"idempotency_key" text,
	CONSTRAINT "events_actor_known" CHECK (("events"."actor_kind" not in ('person', 'agent') or "events"."actor_person_id" is not null) and ("events"."actor_kind" <> 'agent' or "events"."actor_agent_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "installation" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installation_single_row" CHECK ("installation"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invited_by_member_id" uuid,
	"removed_at" timestamp with time zone,
	CONSTRAINT "members_workspace_id_id" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handle" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_handle_unique" UNIQUE("handle"),
	CONSTRAINT "people_email_unique" UNIQUE("email"),
	CONSTRAINT "people_handle_format" CHECK ("people"."handle" ~ '^[a-z0-9-]+$'),
	CONSTRAINT "people_email_lower_case" CHECK ("people"."email" = lower("people"."email"))
);
--> statement-breakpoint
CREATE TABLE "security_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "security_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"workspace_id" uuid,
	"action" text NOT NULL,
	"outcome" "security_outcome" NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_person_id" uuid,
	"actor_agent_id" uuid,
	"actor_agent_session_id" uuid,
	"actor_label" text NOT NULL,
	"confidence" "attribution_confidence" NOT NULL,
	"subject_person_id" uuid,
	"network_address" "inet",
	"client" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "security_log_actor_known" CHECK (("security_log"."actor_kind" not in ('person', 'agent') or "security_log"."actor_person_id" is not null) and ("security_log"."actor_kind" <> 'agent' or "security_log"."actor_agent_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_name_not_blank" CHECK (btrim("workspaces"."name") <> '')
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_actor_person_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_invited_by_same_workspace" FOREIGN KEY ("workspace_id","invited_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_workspace_id_id" ON "events" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "events_subjects" ON "events" USING gin ("subjects");--> statement-breakpoint
CREATE UNIQUE INDEX "events_idempotency_key" ON "events" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "members_one_current_membership" ON "members" USING btree ("workspace_id","person_id") WHERE "members"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "members_person_id" ON "members" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "security_log_workspace_id_id" ON "security_log" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "security_log_actor_person_id" ON "security_log" USING btree ("actor_person_id");--> statement-breakpoint
CREATE INDEX "security_log_subject_person_id" ON "security_log" USING btree ("subject_person_id");