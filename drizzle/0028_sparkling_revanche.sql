ALTER TABLE "amc_fortnightly_update" ADD COLUMN "sip_industry_qtr_qtd_val_cr" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "amc_fortnightly_update" ADD COLUMN "sip_industry_qtr_prev_q_val_cr" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "amc_fortnightly_update" ADD COLUMN "sip_industry_qtr_prev_q2_val_cr" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "amc_fortnightly_update" ADD COLUMN "sip_industry_qtr_yoy_q_val_cr" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "amc_fortnightly_update" ADD COLUMN "sip_industry_qtr_yoy_q2_val_cr" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "amc_fortnightly_update" ADD COLUMN "sip_industry_qtr_latest_fy" numeric(6, 0);--> statement-breakpoint
ALTER TABLE "amc_fortnightly_update" ADD COLUMN "sip_industry_qtr_latest_quarter" numeric(1, 0);--> statement-breakpoint
ALTER TABLE "amc_fortnightly_update" ADD COLUMN "amc_score_anchor_date" date;