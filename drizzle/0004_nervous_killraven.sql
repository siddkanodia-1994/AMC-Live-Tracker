DROP INDEX "live_aum_daily_snapshot_amc_date_idx";--> statement-breakpoint
ALTER TABLE "live_aum_daily_snapshot" ADD COLUMN "is_canonical" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "live_aum_daily_snapshot_amc_date_period_idx" ON "live_aum_daily_snapshot" USING btree ("amc_id","snapshot_date","report_period");--> statement-breakpoint
CREATE UNIQUE INDEX "live_aum_daily_snapshot_amc_date_canonical_idx" ON "live_aum_daily_snapshot" USING btree ("amc_id","snapshot_date") WHERE "live_aum_daily_snapshot"."is_canonical" = true;