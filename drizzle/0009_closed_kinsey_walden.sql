CREATE TABLE "isin_last_close_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"isin" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "isin_manual_mute" (
	"isin" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"muted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "isin_last_close_log_isin_date_idx" ON "isin_last_close_log" USING btree ("isin","snapshot_date");