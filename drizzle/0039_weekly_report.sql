CREATE TABLE "weekly_report" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_ending" date NOT NULL,
	"as_of_date" date NOT NULL,
	"html" text NOT NULL,
	"pdf_base64" text,
	"figures" jsonb,
	"commentary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_report_week_ending_idx" ON "weekly_report" USING btree ("week_ending");