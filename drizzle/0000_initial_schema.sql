CREATE SEQUENCE "public"."reservation_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 999999 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "bakery_closures" (
	"date" date PRIMARY KEY NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "bakery_opening_days" (
	"weekday" smallint PRIMARY KEY NOT NULL,
	"is_open" boolean NOT NULL,
	CONSTRAINT "bakery_opening_days_weekday_valid" CHECK ("bakery_opening_days"."weekday" between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "daily_product_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"date" date NOT NULL,
	"capacity" integer NOT NULL,
	"walk_in_quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_product_plans_product_date_unique" UNIQUE("product_id","date"),
	CONSTRAINT "daily_product_plans_capacity_nonnegative" CHECK ("daily_product_plans"."capacity" >= 0),
	CONSTRAINT "daily_product_plans_walk_in_within_capacity" CHECK ("daily_product_plans"."walk_in_quantity" >= 0 and "daily_product_plans"."walk_in_quantity" <= "daily_product_plans"."capacity")
);
--> statement-breakpoint
CREATE TABLE "product_weekdays" (
	"product_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	CONSTRAINT "product_weekdays_product_id_weekday_pk" PRIMARY KEY("product_id","weekday"),
	CONSTRAINT "product_weekdays_weekday_valid" CHECK ("product_weekdays"."weekday" between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image_url" text,
	"price" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"default_capacity" integer NOT NULL,
	"default_walk_in_quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_name_not_blank" CHECK (length(trim("products"."name")) > 0),
	CONSTRAINT "products_price_nonnegative" CHECK ("products"."price" >= 0),
	CONSTRAINT "products_default_capacity_nonnegative" CHECK ("products"."default_capacity" >= 0),
	CONSTRAINT "products_default_walk_in_within_capacity" CHECK ("products"."default_walk_in_quantity" >= 0 and "products"."default_walk_in_quantity" <= "products"."default_capacity")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start"),
	CONSTRAINT "rate_limits_count_nonnegative" CHECK ("rate_limits"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reservation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name_snapshot" text NOT NULL,
	"unit_price_snapshot" integer NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "reservation_items_reservation_product_unique" UNIQUE("reservation_id","product_id"),
	CONSTRAINT "reservation_items_unit_price_nonnegative" CHECK ("reservation_items"."unit_price_snapshot" >= 0),
	CONSTRAINT "reservation_items_quantity_positive" CHECK ("reservation_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_number" text DEFAULT ('BK-' || lpad(nextval('reservation_number_seq')::text, 6, '0')) NOT NULL,
	"pickup_date" date NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"retain_for_production" boolean DEFAULT false NOT NULL,
	"management_token_hash" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "reservations_reservation_number_unique" UNIQUE("reservation_number"),
	CONSTRAINT "reservations_management_token_hash_unique" UNIQUE("management_token_hash"),
	CONSTRAINT "reservations_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "reservations_source_valid" CHECK ("reservations"."source" in ('online', 'admin')),
	CONSTRAINT "reservations_status_valid" CHECK ("reservations"."status" in ('confirmed', 'picked_up', 'cancelled', 'no_show')),
	CONSTRAINT "reservations_cancelled_at_matches_status" CHECK (("reservations"."status" = 'cancelled') = ("reservations"."cancelled_at" is not null)),
	CONSTRAINT "reservations_retain_only_when_cancelled" CHECK (not "reservations"."retain_for_production" or "reservations"."status" = 'cancelled')
);
--> statement-breakpoint
ALTER TABLE "daily_product_plans" ADD CONSTRAINT "daily_product_plans_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_weekdays" ADD CONSTRAINT "product_weekdays_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reservation_items_product_id_idx" ON "reservation_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "reservations_pickup_date_status_idx" ON "reservations" USING btree ("pickup_date","status");