CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`path` text NOT NULL,
	`depth` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_categories_path` ON `categories` (`path`);--> statement-breakpoint
CREATE INDEX `idx_categories_parent_status` ON `categories` (`parent_id`,`status`);--> statement-breakpoint
CREATE TABLE `product_categories` (
	`product_id` text NOT NULL,
	`category_id` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`product_id`, `category_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_product_categories_category` ON `product_categories` (`category_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `product_option_values` (
	`id` text PRIMARY KEY NOT NULL,
	`option_id` text NOT NULL,
	`value` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`option_id`) REFERENCES `product_options`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_option_values_option_value` ON `product_option_values` (`option_id`,`value`);--> statement-breakpoint
CREATE INDEX `idx_product_option_values_option_position` ON `product_option_values` (`option_id`,`position`);--> statement-breakpoint
CREATE TABLE `product_options` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_options_product_name` ON `product_options` (`product_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_product_options_product_position` ON `product_options` (`product_id`,`position`);--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`title` text NOT NULL,
	`sku` text NOT NULL,
	`option_signature` text NOT NULL,
	`price_cents` integer,
	`compare_at_cents` integer,
	`cost_cents` integer,
	`stock` integer DEFAULT 0 NOT NULL,
	`low_stock_threshold` integer DEFAULT 5 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "variant_inventory_available" CHECK("product_variants"."stock" >= 0),
	CONSTRAINT "variant_price_nonnegative" CHECK("product_variants"."price_cents" IS NULL OR "product_variants"."price_cents" >= 0),
	CONSTRAINT "variant_threshold_nonnegative" CHECK("product_variants"."low_stock_threshold" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_variants_sku` ON `product_variants` (`sku`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_variants_product_signature` ON `product_variants` (`product_id`,`option_signature`);--> statement-breakpoint
CREATE INDEX `idx_product_variants_product_status` ON `product_variants` (`product_id`,`status`);--> statement-breakpoint
CREATE TABLE `variant_option_values` (
	`variant_id` text NOT NULL,
	`option_value_id` text NOT NULL,
	PRIMARY KEY(`variant_id`, `option_value_id`),
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`option_value_id`) REFERENCES `product_option_values`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_variant_option_values_value` ON `variant_option_values` (`option_value_id`,`variant_id`);--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD `variant_id` text REFERENCES product_variants(id);--> statement-breakpoint
CREATE INDEX `idx_inventory_movements_variant_created` ON `inventory_movements` (`variant_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `order_items` ADD `variant_id` text REFERENCES product_variants(id);--> statement-breakpoint
ALTER TABLE `order_items` ADD `variant_title` text;--> statement-breakpoint
ALTER TABLE `order_items` ADD `options_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_order_items_variant_id` ON `order_items` (`variant_id`);