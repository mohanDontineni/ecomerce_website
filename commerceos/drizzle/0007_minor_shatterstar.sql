PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_retail_sale_tenders` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`shift_id` text,
	`actor_user_id` text,
	`kind` text NOT NULL,
	`direction` text DEFAULT 'payment' NOT NULL,
	`amount_cents` integer NOT NULL,
	`tendered_amount_cents` integer,
	`change_cents` integer,
	`provider` text,
	`provider_reference` text,
	`status` text DEFAULT 'captured' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `retail_sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`shift_id`) REFERENCES `register_shifts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "retail_sale_tender_amount_positive" CHECK("__new_retail_sale_tenders"."amount_cents" > 0),
	CONSTRAINT "retail_sale_tender_cash_details_valid" CHECK(("__new_retail_sale_tenders"."tendered_amount_cents" IS NULL AND "__new_retail_sale_tenders"."change_cents" IS NULL) OR ("__new_retail_sale_tenders"."tendered_amount_cents" >= "__new_retail_sale_tenders"."amount_cents" AND "__new_retail_sale_tenders"."change_cents" = "__new_retail_sale_tenders"."tendered_amount_cents" - "__new_retail_sale_tenders"."amount_cents"))
);
--> statement-breakpoint
INSERT INTO `__new_retail_sale_tenders`("id", "sale_id", "shift_id", "actor_user_id", "kind", "direction", "amount_cents", "tendered_amount_cents", "change_cents", "provider", "provider_reference", "status", "created_at") SELECT "id", "sale_id", NULL, NULL, "kind", "direction", "amount_cents", NULL, NULL, "provider", "provider_reference", "status", "created_at" FROM `retail_sale_tenders`;--> statement-breakpoint
DROP TABLE `retail_sale_tenders`;--> statement-breakpoint
ALTER TABLE `__new_retail_sale_tenders` RENAME TO `retail_sale_tenders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_retail_sale_tenders_sale_created` ON `retail_sale_tenders` (`sale_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_retail_sale_tenders_provider_reference` ON `retail_sale_tenders` (`provider`,`provider_reference`);--> statement-breakpoint
CREATE INDEX `idx_retail_sale_tenders_shift_created` ON `retail_sale_tenders` (`shift_id`,`created_at`);
