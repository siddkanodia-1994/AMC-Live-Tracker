CREATE TABLE "index_daily_level" (
	"id" serial PRIMARY KEY NOT NULL,
	"index_key" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"level_value" numeric(18, 4) NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "index_daily_level_key_date_idx" ON "index_daily_level" USING btree ("index_key","snapshot_date");