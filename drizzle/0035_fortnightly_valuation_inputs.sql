ALTER TABLE "amc_fortnightly_update" ADD COLUMN "revenue_fy28e_cr" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "amc_fortnightly_update" ADD COLUMN "target_mcap_sales_bear" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "amc_fortnightly_update" ADD COLUMN "target_mcap_sales_base" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "amc_fortnightly_update" ADD COLUMN "target_mcap_sales_bull" numeric(10, 2);