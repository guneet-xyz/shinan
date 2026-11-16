CREATE TYPE "public"."email_kind" AS ENUM('magic_link', 'invitation', 'security_alert');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('queued', 'sent', 'rejected', 'given_up', 'throttled');--> statement-breakpoint
CREATE TABLE "email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "email_kind" NOT NULL,
	"recipient" text NOT NULL,
	"network_address" "inet",
	"status" "email_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_message_id" text,
	"not_after" timestamp with time zone NOT NULL,
	"message" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "email_deliveries_recipient_lower_case" CHECK ("email_deliveries"."recipient" = lower("email_deliveries"."recipient")),
	CONSTRAINT "email_deliveries_message_only_while_queued" CHECK (("email_deliveries"."status" = 'queued') = ("email_deliveries"."message" is not null)),
	CONSTRAINT "email_deliveries_finished_unless_queued" CHECK (("email_deliveries"."status" = 'queued') = ("email_deliveries"."finished_at" is null))
);
--> statement-breakpoint
CREATE INDEX "email_deliveries_recipient_created_at" ON "email_deliveries" USING btree ("recipient","created_at");--> statement-breakpoint
CREATE INDEX "email_deliveries_network_address_created_at" ON "email_deliveries" USING btree ("network_address","created_at") WHERE "email_deliveries"."network_address" is not null;--> statement-breakpoint
CREATE INDEX "email_deliveries_status_created_at" ON "email_deliveries" USING btree ("status","created_at");