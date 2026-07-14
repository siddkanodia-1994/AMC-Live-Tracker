CREATE TABLE "daily_data_quality" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_date" date NOT NULL,
	"total_holdings" integer NOT NULL,
	"debt_instruments" integer NOT NULL,
	"foreign_holdings" integer NOT NULL,
	"indian_stocks_and_cash" integer NOT NULL,
	"live_considered" integer NOT NULL,
	"coverage_pct" numeric(6, 3) NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "daily_data_quality_date_idx" ON "daily_data_quality" USING btree ("snapshot_date");