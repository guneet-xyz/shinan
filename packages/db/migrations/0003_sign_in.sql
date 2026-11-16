CREATE TYPE "public"."invitation_state" AS ENUM('pending', 'accepted', 'declined', 'expired', 'withdrawn');--> statement-breakpoint
CREATE TABLE "email_allowlist" (
	"email" text PRIMARY KEY NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_allowlist_email_lower_case" CHECK ("email_allowlist"."email" = lower("email_allowlist"."email"))
);
--> statement-breakpoint
CREATE TABLE "installation_operators" (
	"email" text PRIMARY KEY NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installation_operators_email_lower_case" CHECK ("installation_operators"."email" = lower("installation_operators"."email"))
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "role" NOT NULL,
	"state" "invitation_state" DEFAULT 'pending' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"member_id" uuid,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitations_email_lower_case" CHECK ("invitations"."email" = lower("invitations"."email")),
	CONSTRAINT "invitations_decided_unless_pending" CHECK (("invitations"."state" = 'pending') = ("invitations"."decided_at" is null)),
	CONSTRAINT "invitations_member_when_accepted" CHECK (("invitations"."state" = 'accepted') = ("invitations"."member_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "known_browsers" (
	"person_id" uuid NOT NULL,
	"browser_hash" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "known_browsers_person_id_browser_hash_pk" PRIMARY KEY("person_id","browser_hash")
);
--> statement-breakpoint
CREATE TABLE "pending_github_sign_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"github_account_id" text NOT NULL,
	"github_login" text,
	"email" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_github_sign_ins_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "pending_github_sign_ins_email_lower_case" CHECK ("pending_github_sign_ins"."email" = lower("pending_github_sign_ins"."email"))
);
--> statement-breakpoint
CREATE TABLE "setup_links" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setup_links_single_row" CHECK ("setup_links"."id" = 1),
	CONSTRAINT "setup_links_email_lower_case" CHECK ("setup_links"."email" = lower("setup_links"."email"))
);
--> statement-breakpoint
CREATE TABLE "sign_in_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"account_id" text NOT NULL,
	"login" text,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sign_in_accounts_github_only" CHECK ("sign_in_accounts"."provider_id" = 'github'),
	CONSTRAINT "sign_in_accounts_no_credentials" CHECK ("sign_in_accounts"."access_token" is null and "sign_in_accounts"."refresh_token" is null and "sign_in_accounts"."id_token" is null and "sign_in_accounts"."password" is null)
);
--> statement-breakpoint
CREATE TABLE "sign_in_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"person_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	CONSTRAINT "sign_in_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "sign_in_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "installation" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "email_verified" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_same_workspace" FOREIGN KEY ("workspace_id","invited_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_member_same_workspace" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "known_browsers" ADD CONSTRAINT "known_browsers_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_in_accounts" ADD CONSTRAINT "sign_in_accounts_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_in_sessions" ADD CONSTRAINT "sign_in_sessions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_one_pending" ON "invitations" USING btree ("workspace_id","email") WHERE "invitations"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "invitations_email" ON "invitations" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "sign_in_accounts_provider_account" ON "sign_in_accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sign_in_accounts_person_provider" ON "sign_in_accounts" USING btree ("person_id","provider_id");--> statement-breakpoint
CREATE INDEX "sign_in_sessions_person_id" ON "sign_in_sessions" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "sign_in_verifications_identifier" ON "sign_in_verifications" USING btree ("identifier");