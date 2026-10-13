CREATE TABLE "amc_manual_net_flow" (
	"id" serial PRIMARY KEY NOT NULL,
	"amc_id" integer NOT NULL,
	"report_period" text NOT NULL,
	"net_flow_override_cr" numeric(18, 4),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amc_manual_net_flow_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"amc_id" integer NOT NULL,
	"report_period" text NOT NULL,
	"old_value_cr" numeric(18, 4),
	"new_value_cr" numeric(18, 4),
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amc_manual_net_flow" ADD CONSTRAINT "amc_manual_net_flow_amc_id_amcs_id_fk" FOREIGN KEY ("amc_id") REFERENCES "public"."amcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amc_manual_net_flow_log" ADD CONSTRAINT "amc_manual_net_flow_log_amc_id_amcs_id_fk" FOREIGN KEY ("amc_id") REFERENCES "public"."amcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "amc_manual_net_flow_amc_period_idx" ON "amc_manual_net_flow" USING btree ("amc_id","report_period");--> statement-breakpoint
CREATE INDEX "amc_manual_net_flow_log_amc_period_idx" ON "amc_manual_net_flow_log" USING btree ("amc_id","report_period");