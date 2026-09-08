CREATE TABLE "mcx_daily_price" (
	"id" serial PRIMARY KEY NOT NULL,
	"metal" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"price_inr" numeric(18, 4) NOT NULL,
	"security_id" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcx_period_avg" (
	"id" serial PRIMARY KEY NOT NULL,
	"metal" text NOT NULL,
	"report_period" text NOT NULL,
	"avg_price_inr" numeric(18, 4) NOT NULL,
	"trading_days_count" integer NOT NULL,
	"security_id" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcx_tracked_contract" (
	"id" serial PRIMARY KEY NOT NULL,
	"metal" text NOT NULL,
	"security_id" text NOT NULL,
	"trading_symbol" text NOT NULL,
	"expiry_date" date NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mcx_daily_price_metal_date_idx" ON "mcx_daily_price" USING btree ("metal","snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "mcx_period_avg_metal_period_idx" ON "mcx_period_avg" USING btree ("metal","report_period");--> statement-breakpoint
CREATE UNIQUE INDEX "mcx_tracked_contract_metal_idx" ON "mcx_tracked_contract" USING btree ("metal");