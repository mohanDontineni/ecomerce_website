CREATE TABLE `product_attributes` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`group_name` text DEFAULT 'Details' NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`visible` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_attributes_product_group_name` ON `product_attributes` (`product_id`,`group_name`,`name`);--> statement-breakpoint
CREATE INDEX `idx_product_attributes_product_position` ON `product_attributes` (`product_id`,`position`);