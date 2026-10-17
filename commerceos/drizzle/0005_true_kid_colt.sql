CREATE TABLE `catalog_import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'review' NOT NULL,
	`original_filename` text NOT NULL,
	`format` text NOT NULL,
	`content_sha256` text NOT NULL,
	`mapping_json` text DEFAULT '{}' NOT NULL,
	`defaults_json` text DEFAULT '{}' NOT NULL,
	`summary_json` text DEFAULT '{}' NOT NULL,
	`total_rows` integer DEFAULT 0 NOT NULL,
	`valid_rows` integer DEFAULT 0 NOT NULL,
	`warning_rows` integer DEFAULT 0 NOT NULL,
	`error_rows` integer DEFAULT 0 NOT NULL,
	`applied_rows` integer DEFAULT 0 NOT NULL,
	`requested_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_catalog_import_jobs_status_created` ON `catalog_import_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_catalog_import_jobs_user_created` ON `catalog_import_jobs` (`requested_by`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_catalog_import_jobs_digest` ON `catalog_import_jobs` (`content_sha256`);--> statement-breakpoint
CREATE TABLE `catalog_import_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`row_number` integer NOT NULL,
	`source_json` text NOT NULL,
	`normalized_json` text NOT NULL,
	`fingerprint` text NOT NULL,
	`group_key` text NOT NULL,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`confidence_basis_points` integer DEFAULT 0 NOT NULL,
	`product_id` text,
	`variant_id` text,
	`errors_json` text DEFAULT '[]' NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`applied_at` text,
	FOREIGN KEY (`job_id`) REFERENCES `catalog_import_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "catalog_import_confidence_valid" CHECK("catalog_import_rows"."confidence_basis_points" >= 0 AND "catalog_import_rows"."confidence_basis_points" <= 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_catalog_import_rows_job_row` ON `catalog_import_rows` (`job_id`,`row_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_catalog_import_rows_job_fingerprint` ON `catalog_import_rows` (`job_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_catalog_import_rows_job_status_row` ON `catalog_import_rows` (`job_id`,`status`,`row_number`);--> statement-breakpoint
CREATE INDEX `idx_catalog_import_rows_job_group` ON `catalog_import_rows` (`job_id`,`group_key`);--> statement-breakpoint
CREATE TABLE `location_inventory` (
	`location_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`on_hand` integer DEFAULT 0 NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`reorder_point` integer DEFAULT 0 NOT NULL,
	`par_level` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`location_id`, `variant_id`),
	FOREIGN KEY (`location_id`) REFERENCES `retail_locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "location_inventory_nonnegative" CHECK("location_inventory"."on_hand" >= 0 AND "location_inventory"."reserved" >= 0 AND "location_inventory"."reserved" <= "location_inventory"."on_hand"),
	CONSTRAINT "location_inventory_thresholds_valid" CHECK("location_inventory"."reorder_point" >= 0 AND ("location_inventory"."par_level" IS NULL OR "location_inventory"."par_level" >= "location_inventory"."reorder_point"))
);
--> statement-breakpoint
CREATE INDEX `idx_location_inventory_variant` ON `location_inventory` (`variant_id`,`location_id`);--> statement-breakpoint
CREATE INDEX `idx_location_inventory_location_stock` ON `location_inventory` (`location_id`,`on_hand`,`reserved`);--> statement-breakpoint
CREATE TABLE `location_inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`product_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`delta` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`reason` text NOT NULL,
	`reference_type` text,
	`reference_id` text,
	`external_key` text,
	`unit_cost_cents` integer,
	`note` text,
	`actor_user_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `retail_locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "location_inventory_balance_nonnegative" CHECK("location_inventory_movements"."balance_after" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_location_inventory_movements_external_key` ON `location_inventory_movements` (`external_key`);--> statement-breakpoint
CREATE INDEX `idx_location_inventory_movements_location_created` ON `location_inventory_movements` (`location_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_location_inventory_movements_variant_created` ON `location_inventory_movements` (`variant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_location_inventory_movements_reference` ON `location_inventory_movements` (`reference_type`,`reference_id`);--> statement-breakpoint
CREATE TABLE `product_identifiers` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`normalized_value` text NOT NULL,
	`is_primary` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_identifiers_normalized` ON `product_identifiers` (`normalized_value`);--> statement-breakpoint
CREATE INDEX `idx_product_identifiers_variant` ON `product_identifiers` (`variant_id`);--> statement-breakpoint
CREATE TABLE `purchase_order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_order_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`supplier_sku` text,
	`description` text NOT NULL,
	`ordered_quantity` integer NOT NULL,
	`received_quantity` integer DEFAULT 0 NOT NULL,
	`unit_cost_cents` integer NOT NULL,
	`expiry_date` text,
	`batch_number` text,
	FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "purchase_order_item_quantities_valid" CHECK("purchase_order_items"."ordered_quantity" > 0 AND "purchase_order_items"."received_quantity" >= 0 AND "purchase_order_items"."received_quantity" <= "purchase_order_items"."ordered_quantity"),
	CONSTRAINT "purchase_order_item_cost_nonnegative" CHECK("purchase_order_items"."unit_cost_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_purchase_order_items_order_variant` ON `purchase_order_items` (`purchase_order_id`,`variant_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_order_items_variant` ON `purchase_order_items` (`variant_id`);--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`po_number` text NOT NULL,
	`supplier_id` text NOT NULL,
	`destination_location_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`subtotal_cents` integer DEFAULT 0 NOT NULL,
	`expected_at` text,
	`note` text,
	`created_by` text,
	`submitted_at` text,
	`received_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`destination_location_id`) REFERENCES `retail_locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "purchase_orders_subtotal_nonnegative" CHECK("purchase_orders"."subtotal_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_purchase_orders_number` ON `purchase_orders` (`po_number`);--> statement-breakpoint
CREATE INDEX `idx_purchase_orders_supplier_status_created` ON `purchase_orders` (`supplier_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_purchase_orders_location_status_expected` ON `purchase_orders` (`destination_location_id`,`status`,`expected_at`);--> statement-breakpoint
CREATE TABLE `register_shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`register_id` text NOT NULL,
	`opened_by` text NOT NULL,
	`closed_by` text,
	`status` text DEFAULT 'open' NOT NULL,
	`opening_cash_cents` integer DEFAULT 0 NOT NULL,
	`expected_cash_cents` integer DEFAULT 0 NOT NULL,
	`closing_cash_cents` integer,
	`variance_cents` integer,
	`opened_at` text NOT NULL,
	`closed_at` text,
	`note` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`register_id`) REFERENCES `retail_registers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`opened_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "register_shift_cash_nonnegative" CHECK("register_shifts"."opening_cash_cents" >= 0 AND "register_shifts"."expected_cash_cents" >= 0 AND ("register_shifts"."closing_cash_cents" IS NULL OR "register_shifts"."closing_cash_cents" >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_register_shifts_one_open` ON `register_shifts` (`register_id`) WHERE "register_shifts"."status" = 'open';--> statement-breakpoint
CREATE INDEX `idx_register_shifts_opened_by_date` ON `register_shifts` (`opened_by`,`opened_at`);--> statement-breakpoint
CREATE TABLE `retail_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'store' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`fulfillment_enabled` integer DEFAULT true NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`address_json` text DEFAULT '{}' NOT NULL,
	`tax_rate_basis_points` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "retail_location_tax_rate_valid" CHECK("retail_locations"."tax_rate_basis_points" >= 0 AND "retail_locations"."tax_rate_basis_points" <= 3000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_retail_locations_code` ON `retail_locations` (`code`);--> statement-breakpoint
CREATE INDEX `idx_retail_locations_status_name` ON `retail_locations` (`status`,`name`);--> statement-breakpoint
CREATE TABLE `retail_registers` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `retail_locations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_retail_registers_location_code` ON `retail_registers` (`location_id`,`code`);--> statement-breakpoint
CREATE INDEX `idx_retail_registers_location_status` ON `retail_registers` (`location_id`,`status`);--> statement-breakpoint
CREATE TABLE `retail_sale_items` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`line_number` integer NOT NULL,
	`product_id` text,
	`variant_id` text,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`variant_title` text,
	`options_json` text DEFAULT '{}' NOT NULL,
	`quantity` integer NOT NULL,
	`regular_unit_price_cents` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`discount_cents` integer DEFAULT 0 NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`line_total_cents` integer NOT NULL,
	`unit_cost_cents` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `retail_sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "retail_sale_item_quantity_positive" CHECK("retail_sale_items"."quantity" > 0),
	CONSTRAINT "retail_sale_item_money_nonnegative" CHECK("retail_sale_items"."regular_unit_price_cents" >= 0 AND "retail_sale_items"."unit_price_cents" >= 0 AND "retail_sale_items"."discount_cents" >= 0 AND "retail_sale_items"."tax_cents" >= 0 AND "retail_sale_items"."line_total_cents" >= 0 AND "retail_sale_items"."unit_cost_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_retail_sale_items_sale_line` ON `retail_sale_items` (`sale_id`,`line_number`);--> statement-breakpoint
CREATE INDEX `idx_retail_sale_items_variant` ON `retail_sale_items` (`variant_id`);--> statement-breakpoint
CREATE TABLE `retail_sale_tenders` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`kind` text NOT NULL,
	`direction` text DEFAULT 'payment' NOT NULL,
	`amount_cents` integer NOT NULL,
	`provider` text,
	`provider_reference` text,
	`status` text DEFAULT 'captured' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `retail_sales`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "retail_sale_tender_amount_positive" CHECK("retail_sale_tenders"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_retail_sale_tenders_sale_created` ON `retail_sale_tenders` (`sale_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_retail_sale_tenders_provider_reference` ON `retail_sale_tenders` (`provider`,`provider_reference`);--> statement-breakpoint
CREATE TABLE `retail_sales` (
	`id` text PRIMARY KEY NOT NULL,
	`receipt_number` text NOT NULL,
	`location_id` text NOT NULL,
	`register_id` text NOT NULL,
	`shift_id` text NOT NULL,
	`customer_id` text,
	`cashier_user_id` text,
	`status` text DEFAULT 'completed' NOT NULL,
	`currency` text NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`discount_cents` integer DEFAULT 0 NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer NOT NULL,
	`cost_cents` integer DEFAULT 0 NOT NULL,
	`idempotency_key` text NOT NULL,
	`customer_name` text,
	`customer_email` text,
	`note` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `retail_locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`register_id`) REFERENCES `retail_registers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`shift_id`) REFERENCES `register_shifts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cashier_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "retail_sales_totals_nonnegative" CHECK("retail_sales"."subtotal_cents" >= 0 AND "retail_sales"."discount_cents" >= 0 AND "retail_sales"."tax_cents" >= 0 AND "retail_sales"."total_cents" >= 0 AND "retail_sales"."cost_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_retail_sales_receipt` ON `retail_sales` (`receipt_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_retail_sales_idempotency` ON `retail_sales` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_retail_sales_location_completed` ON `retail_sales` (`location_id`,`completed_at`);--> statement-breakpoint
CREATE INDEX `idx_retail_sales_shift_created` ON `retail_sales` (`shift_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_retail_sales_status_created` ON `retail_sales` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `retail_variant_details` (
	`variant_id` text PRIMARY KEY NOT NULL,
	`supplier_sku` text,
	`department` text,
	`unit` text DEFAULT 'each' NOT NULL,
	`case_pack_quantity` integer DEFAULT 1 NOT NULL,
	`tax_category` text DEFAULT 'general' NOT NULL,
	`age_restriction` integer,
	`track_expiry` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "retail_case_pack_positive" CHECK("retail_variant_details"."case_pack_quantity" > 0),
	CONSTRAINT "retail_age_restriction_valid" CHECK("retail_variant_details"."age_restriction" IS NULL OR ("retail_variant_details"."age_restriction" >= 0 AND "retail_variant_details"."age_restriction" <= 99))
);
--> statement-breakpoint
CREATE INDEX `idx_retail_variant_details_supplier_sku` ON `retail_variant_details` (`supplier_sku`);--> statement-breakpoint
CREATE INDEX `idx_retail_variant_details_department` ON `retail_variant_details` (`department`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`address_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`payment_terms` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_suppliers_code` ON `suppliers` (`code`);--> statement-breakpoint
CREATE INDEX `idx_suppliers_status_name` ON `suppliers` (`status`,`name`);--> statement-breakpoint
INSERT INTO `retail_locations`
  (`id`, `code`, `name`, `type`, `status`, `fulfillment_enabled`, `timezone`, `address_json`, `tax_rate_basis_points`, `created_at`, `updated_at`)
VALUES
  ('loc_main', 'MAIN', 'Main store', 'store', 'active', 1, 'UTC', '{}', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));--> statement-breakpoint
INSERT INTO `retail_registers`
  (`id`, `location_id`, `code`, `name`, `status`, `created_at`, `updated_at`)
VALUES
  ('reg_main', 'loc_main', 'REGISTER-1', 'Main register', 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));--> statement-breakpoint
INSERT INTO `location_inventory`
  (`location_id`, `variant_id`, `on_hand`, `reserved`, `reorder_point`, `par_level`, `version`, `updated_at`)
SELECT
  'loc_main', `id`, `stock`, 0, `low_stock_threshold`, NULL, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `product_variants`;
