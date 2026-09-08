CREATE TABLE "etf_daily_nav" (
	"id" serial PRIMARY KEY NOT NULL,
	"scheme_id" integer NOT NULL,
	"snapshot_date" date NOT NULL,
	"nav" numeric(18, 4) NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "etf_period_aum" (
	"id" serial PRIMARY KEY NOT NULL,
	"scheme_id" integer NOT NULL,
	"report_period" text NOT NULL,
	"reported_aum_cr" numeric(18, 4) NOT NULL,
	"nav_at_period_end" numeric(18, 4) NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "etf_schemes" (
	"id" serial PRIMARY KEY NOT NULL,
	"scheme_code" integer NOT NULL,
	"isin" text,
	"name" text NOT NULL,
	"asset_class" text NOT NULL,
	"slug" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "etf_daily_nav" ADD CONSTRAINT "etf_daily_nav_scheme_id_etf_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."etf_schemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etf_period_aum" ADD CONSTRAINT "etf_period_aum_scheme_id_etf_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."etf_schemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "etf_daily_nav_scheme_date_idx" ON "etf_daily_nav" USING btree ("scheme_id","snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "etf_period_aum_scheme_period_idx" ON "etf_period_aum" USING btree ("scheme_id","report_period");--> statement-breakpoint
CREATE UNIQUE INDEX "etf_schemes_scheme_code_idx" ON "etf_schemes" USING btree ("scheme_code");--> statement-breakpoint
CREATE UNIQUE INDEX "etf_schemes_slug_idx" ON "etf_schemes" USING btree ("slug");