CREATE TABLE "live_aum_fetch_lease" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_token" text NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
