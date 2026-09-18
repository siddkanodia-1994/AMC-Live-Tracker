CREATE TABLE "stale_mapping_unresolved_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"isin" text NOT NULL,
	"company_name" text NOT NULL,
	"old_security_id" text,
	"old_exchange_segment" text,
	"first_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stale_mapping_correction_log" ADD COLUMN "backfill_dates_count" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "stale_mapping_unresolved_log_isin_idx" ON "stale_mapping_unresolved_log" USING btree ("isin");