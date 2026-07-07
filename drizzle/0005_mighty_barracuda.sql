CREATE TABLE "total_aum_growth_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"amc_id" integer NOT NULL,
	"report_period" text NOT NULL,
	"sip_inflow_override_cr" numeric(18, 4),
	"reported_aum_override_cr" numeric(18, 4),
	"income_debt_aum_override_cr" numeric(18, 4),
	"other_funds_aum_override_cr" numeric(18, 4),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amc_periods" ADD COLUMN "income_debt_aum_cr" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "amc_periods" ADD COLUMN "prev_income_debt_aum_cr" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "amc_periods" ADD COLUMN "other_funds_aum_cr" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "amc_periods" ADD COLUMN "prev_other_funds_aum_cr" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "total_aum_growth_overrides" ADD CONSTRAINT "total_aum_growth_overrides_amc_id_amcs_id_fk" FOREIGN KEY ("amc_id") REFERENCES "public"."amcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "total_aum_growth_overrides_amc_period_idx" ON "total_aum_growth_overrides" USING btree ("amc_id","report_period");