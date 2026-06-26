CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"user_id" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"country" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"asn" integer NOT NULL,
	"ip" text NOT NULL,
	"device_id" text NOT NULL,
	"device_type" text NOT NULL,
	"os" text NOT NULL,
	"auth_method" text NOT NULL,
	"outcome" text NOT NULL,
	"home_country" text NOT NULL,
	"home_lat" double precision NOT NULL,
	"home_lon" double precision NOT NULL,
	"account_age_days" integer NOT NULL,
	"active_start" integer NOT NULL,
	"active_end" integer NOT NULL,
	"source" text DEFAULT 'stream' NOT NULL,
	"risk_score" double precision,
	"raw_score" double precision,
	"band" text,
	"flagged" boolean,
	"threshold" double precision,
	"latency_ms" double precision,
	"reasons" jsonb,
	"features" jsonb,
	"is_ato" integer,
	"attack_type" text,
	"label" text,
	"labeled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_events_user_ts" ON "events" USING btree ("user_id","ts");--> statement-breakpoint
CREATE INDEX "idx_events_ip_ts" ON "events" USING btree ("ip","ts");--> statement-breakpoint
CREATE INDEX "idx_events_created" ON "events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_events_source" ON "events" USING btree ("source");