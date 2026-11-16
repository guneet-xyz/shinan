-- Unlogged (written by hand): the counts are disposable and written on most
-- requests, so they skip the write-ahead log and are emptied after a crash.
CREATE UNLOGGED TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
