CREATE TABLE "agent_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"installation_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"first_used_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"last_network_address" "inet",
	"request_count" bigint DEFAULT 0 NOT NULL,
	"summarized_count" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "agent_tokens_hash_only" CHECK ("agent_tokens"."token_hash" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "agent_tokens_known_scopes" CHECK (cardinality("agent_tokens"."scopes") > 0 and "agent_tokens"."scopes" <@ array['catalog:read', 'catalog:propose', 'tasks:read', 'tasks:write', 'presence']::text[]),
	CONSTRAINT "agent_tokens_reason_when_revoked" CHECK (("agent_tokens"."revoked_at" is null) = ("agent_tokens"."revoked_reason" is null)),
	CONSTRAINT "agent_tokens_known_reason" CHECK ("agent_tokens"."revoked_reason" in ('revoked', 'replaced', 'agent-disabled', 'member-removed', 'member-left', 'allowlist-removed', 'signed-out-everywhere'))
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"coding_tool" text NOT NULL,
	"machine" text NOT NULL,
	"handle" text NOT NULL,
	"name" text NOT NULL,
	"machine_entity_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "agents_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "agents_coding_tool_format" CHECK ("agents"."coding_tool" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "agents_machine_format" CHECK ("agents"."machine" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "agents_handle_from_tool_and_machine" CHECK ("agents"."handle" = "agents"."coding_tool" || '-' || "agents"."machine"),
	CONSTRAINT "agents_name_not_blank" CHECK (btrim("agents"."name") <> ''),
	CONSTRAINT "agents_disabled_at_when_disabled" CHECK ("agents"."enabled" = ("agents"."disabled_at" is null))
);
--> statement-breakpoint
-- Moved by hand ahead of the foreign key that needs it.
ALTER TABLE "members" ADD CONSTRAINT "members_workspace_id_id_person_id" UNIQUE("workspace_id","id","person_id");--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_agent_same_workspace" FOREIGN KEY ("workspace_id","agent_id") REFERENCES "public"."agents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_member_same_workspace_and_person" FOREIGN KEY ("workspace_id","member_id","person_id") REFERENCES "public"."members"("workspace_id","id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tokens_one_active" ON "agent_tokens" USING btree ("agent_id") WHERE "agent_tokens"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "agent_tokens_workspace_id" ON "agent_tokens" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_member_handle" ON "agents" USING btree ("member_id","handle");--> statement-breakpoint
CREATE INDEX "agents_workspace_id" ON "agents" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agents_person_id" ON "agents" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_actor_agent_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;