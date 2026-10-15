PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text,
	`name` text NOT NULL,
	`sku` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`image_url` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_items_quantity_positive" CHECK("__new_order_items"."quantity" > 0),
	CONSTRAINT "order_items_price_nonnegative" CHECK("__new_order_items"."unit_price_cents" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_order_items`("id", "order_id", "product_id", "name", "sku", "quantity", "unit_price_cents", "image_url") SELECT "id", "order_id", "product_id", "name", "sku", "quantity", "unit_price_cents", "image_url" FROM `order_items`;--> statement-breakpoint
DROP TABLE `order_items`;--> statement-breakpoint
ALTER TABLE `__new_order_items` RENAME TO `order_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_order_items_order_id` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `__new_products` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`sku` text NOT NULL,
	`price_cents` integer NOT NULL,
	`compare_at_cents` integer,
	`cost_cents` integer,
	`stock` integer DEFAULT 0 NOT NULL,
	`low_stock_threshold` integer DEFAULT 5 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`rating_basis_points` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "inventory_available" CHECK("__new_products"."stock" >= 0),
	CONSTRAINT "products_price_nonnegative" CHECK("__new_products"."price_cents" >= 0),
	CONSTRAINT "products_threshold_nonnegative" CHECK("__new_products"."low_stock_threshold" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_products`("id", "slug", "name", "description", "category", "sku", "price_cents", "compare_at_cents", "cost_cents", "stock", "low_stock_threshold", "status", "featured", "rating_basis_points", "created_at", "updated_at") SELECT "id", "slug", "name", "description", "category", "sku", "price_cents", "compare_at_cents", "cost_cents", "stock", "low_stock_threshold", "status", "featured", "rating_basis_points", "created_at", "updated_at" FROM `products`;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_products_slug` ON `products` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_products_sku` ON `products` (`sku`);--> statement-breakpoint
CREATE INDEX `idx_products_status_featured` ON `products` (`status`,`featured`);--> statement-breakpoint
CREATE INDEX `idx_products_category` ON `products` (`category`);--> statement-breakpoint
CREATE INDEX `idx_products_stock` ON `products` (`stock`);