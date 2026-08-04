CREATE TABLE "outage_reclaim_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"status" text NOT NULL,
	"last_close_isin_count" integer,
	"universe_isin_count" integer,
	"corrected_isin_count" integer,
	"index_keys_corrected" jsonb,
	"detail" text,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"corrected_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "outage_reclaim_log_kind_date_idx" ON "outage_reclaim_log" USING btree ("kind","snapshot_date");