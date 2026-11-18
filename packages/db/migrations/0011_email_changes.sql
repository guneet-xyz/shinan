ALTER TYPE "public"."email_kind" ADD VALUE 'email_change';--> statement-breakpoint
CREATE TABLE "email_changes" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_changes_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "email_changes_email_lower_case" CHECK ("email_changes"."email" = lower("email_changes"."email"))
);
--> statement-breakpoint
ALTER TABLE "email_changes" ADD CONSTRAINT "email_changes_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;