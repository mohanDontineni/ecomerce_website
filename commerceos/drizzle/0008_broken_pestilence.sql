CREATE INDEX `idx_register_shifts_register_opened` ON `register_shifts` (`register_id`,`opened_at`);--> statement-breakpoint
CREATE INDEX `idx_retail_sale_tenders_direction_created` ON `retail_sale_tenders` (`direction`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_retail_sales_register_completed` ON `retail_sales` (`register_id`,`completed_at`);