CREATE TABLE "isin_share_adjustment" (
	"id" serial PRIMARY KEY NOT NULL,
	"isin" text NOT NULL,
	"report_period" text NOT NULL,
	"effective_multiplier" numeric(14, 6) NOT NULL,
	"first_detected_on" date NOT NULL,
	"last_detected_on" date NOT NULL,
	"detection_count" integer DEFAULT 1 NOT NULL,
	"last_price_before_inr" numeric(18, 4) NOT NULL,
	"last_price_after_inr" numeric(18, 4) NOT NULL,
	"dismissed_at" timestamp with time zone,
	"dismissed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "isin_share_adjustment_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"isin" text NOT NULL,
	"report_period" text NOT NULL,
	"detected_on" date NOT NULL,
	"price_before_inr" numeric(18, 4) NOT NULL,
	"price_after_inr" numeric(18, 4) NOT NULL,
	"raw_ratio" numeric(14, 6) NOT NULL,
	"matched_ratio" numeric(14, 6) NOT NULL,
	"deviation_pct" numeric(8, 5) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "isin_share_adjustment_isin_period_idx" ON "isin_share_adjustment" USING btree ("isin","report_period");--> statement-breakpoint
CREATE UNIQUE INDEX "isin_share_adjustment_log_isin_period_date_idx" ON "isin_share_adjustment_log" USING btree ("isin","report_period","detected_on");