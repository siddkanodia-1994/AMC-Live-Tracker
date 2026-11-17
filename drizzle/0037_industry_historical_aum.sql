CREATE TABLE "industry_historical_aum_anchor" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_month" text NOT NULL,
	"month_end_date" date NOT NULL,
	"exit_aum_cr" numeric(18, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "industry_historical_aum_estimate" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_date" date NOT NULL,
	"estimated_aum_cr" numeric(18, 4) NOT NULL,
	"raw_compounded_aum_cr" numeric(18, 4) NOT NULL,
	"anchor_month_end_date" date NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "industry_historical_aum_anchor_month_idx" ON "industry_historical_aum_anchor" USING btree ("report_month");--> statement-breakpoint
CREATE UNIQUE INDEX "industry_historical_aum_estimate_date_idx" ON "industry_historical_aum_estimate" USING btree ("snapshot_date");