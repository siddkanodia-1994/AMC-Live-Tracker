CREATE TABLE "industry_monthly_flow" (
	"id" serial PRIMARY KEY NOT NULL,
	"month_end_date" date NOT NULL,
	"sip_contributions_cr" numeric(18, 4) NOT NULL,
	"equity_net_flows_cr" numeric(18, 4) NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "industry_monthly_flow_month_idx" ON "industry_monthly_flow" USING btree ("month_end_date");