CREATE TABLE "amc_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"amc_id" integer NOT NULL,
	"report_period" text NOT NULL,
	"reported_aum_cr" numeric(18, 4) NOT NULL,
	"prev_reported_aum_cr" numeric(18, 4),
	"change_mom_pct" numeric(12, 8),
	"change_cr" numeric(18, 4),
	"sheet_total_holdings_value_cr" numeric(18, 4) NOT NULL,
	"residual_plug_cr" numeric(18, 4) NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amcs" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"overview_name" text NOT NULL,
	"sheet_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" serial PRIMARY KEY NOT NULL,
	"amc_id" integer NOT NULL,
	"report_period" text NOT NULL,
	"company_name" text NOT NULL,
	"sector" text NOT NULL,
	"mcap_classification" text,
	"isin" text,
	"is_priceable" boolean NOT NULL,
	"market_value_cr" numeric(18, 4) NOT NULL,
	"shares" numeric(20, 2) NOT NULL,
	"weight_pct" numeric(12, 8),
	"prev_market_value_cr" numeric(18, 4),
	"prev_shares" numeric(20, 2),
	"prev_weight_pct" numeric(12, 8),
	"change_market_value_cr" numeric(18, 4),
	"change_shares" numeric(20, 2),
	"change_weight_pct" numeric(12, 8)
);
--> statement-breakpoint
CREATE TABLE "import_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"report_period" text NOT NULL,
	"amcs_imported" integer NOT NULL,
	"holdings_imported" integer NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instrument_map" (
	"isin" text PRIMARY KEY NOT NULL,
	"security_id" text NOT NULL,
	"exchange_segment" text NOT NULL,
	"trading_symbol" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_aum_daily_snapshot" (
	"id" serial PRIMARY KEY NOT NULL,
	"amc_id" integer NOT NULL,
	"snapshot_date" date NOT NULL,
	"report_period" text NOT NULL,
	"live_aum_cr" numeric(18, 4) NOT NULL,
	"reported_aum_cr" numeric(18, 4) NOT NULL,
	"delta_cr" numeric(18, 4) NOT NULL,
	"delta_pct" numeric(12, 8) NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amc_periods" ADD CONSTRAINT "amc_periods_amc_id_amcs_id_fk" FOREIGN KEY ("amc_id") REFERENCES "public"."amcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_amc_id_amcs_id_fk" FOREIGN KEY ("amc_id") REFERENCES "public"."amcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_aum_daily_snapshot" ADD CONSTRAINT "live_aum_daily_snapshot_amc_id_amcs_id_fk" FOREIGN KEY ("amc_id") REFERENCES "public"."amcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "amc_periods_amc_period_idx" ON "amc_periods" USING btree ("amc_id","report_period");--> statement-breakpoint
CREATE UNIQUE INDEX "amcs_slug_idx" ON "amcs" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "holdings_amc_period_idx" ON "holdings" USING btree ("amc_id","report_period");--> statement-breakpoint
CREATE INDEX "holdings_amc_period_isin_idx" ON "holdings" USING btree ("amc_id","report_period","isin");--> statement-breakpoint
CREATE INDEX "holdings_isin_idx" ON "holdings" USING btree ("isin");--> statement-breakpoint
CREATE UNIQUE INDEX "live_aum_daily_snapshot_amc_date_idx" ON "live_aum_daily_snapshot" USING btree ("amc_id","snapshot_date");