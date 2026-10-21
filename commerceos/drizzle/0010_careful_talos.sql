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
	CONSTRAINT "retail_sale_tender_amount_valid" CHECK("__new_retail_sale_tenders"."amount_cents" > 0 OR ("__new_retail_sale_tenders"."amount_cents" = 0 AND "__new_retail_sale_tenders"."kind" = 'other' AND "__new_retail_sale_tenders"."direction" = 'refund' AND "__new_retail_sale_tenders"."status" = 'refunded' AND "__new_retail_sale_tenders"."provider" = 'mdcart' AND "__new_retail_sale_tenders"."provider_reference" IS NULL AND "__new_retail_sale_tenders"."tendered_amount_cents" = 0 AND "__new_retail_sale_tenders"."change_cents" = 0)),
	CONSTRAINT "retail_sale_tender_cash_details_valid" CHECK(("__new_retail_sale_tenders"."tendered_amount_cents" IS NULL AND "__new_retail_sale_tenders"."change_cents" IS NULL) OR ("__new_retail_sale_tenders"."tendered_amount_cents" >= "__new_retail_sale_tenders"."amount_cents" AND "__new_retail_sale_tenders"."change_cents" = "__new_retail_sale_tenders"."tendered_amount_cents" - "__new_retail_sale_tenders"."amount_cents"))
);
--> statement-breakpoint
INSERT INTO `__new_retail_sale_tenders`("id", "sale_id", "shift_id", "actor_user_id", "kind", "direction", "amount_cents", "tendered_amount_cents", "change_cents", "provider", "provider_reference", "status", "created_at") SELECT "id", "sale_id", "shift_id", "actor_user_id", "kind", "direction", "amount_cents", "tendered_amount_cents", "change_cents", "provider", "provider_reference", "status", "created_at" FROM `retail_sale_tenders`;--> statement-breakpoint
DROP TABLE `retail_sale_tenders`;--> statement-breakpoint
ALTER TABLE `__new_retail_sale_tenders` RENAME TO `retail_sale_tenders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_retail_sale_tenders_sale_created` ON `retail_sale_tenders` (`sale_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_retail_sale_tenders_provider_reference` ON `retail_sale_tenders` (`provider`,`provider_reference`);--> statement-breakpoint
CREATE INDEX `idx_retail_sale_tenders_shift_created` ON `retail_sale_tenders` (`shift_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_retail_sale_tenders_direction_created` ON `retail_sale_tenders` (`direction`,`created_at`);--> statement-breakpoint
UPDATE `retail_sale_tenders`
SET
	`shift_id` = COALESCE(
		`shift_id`,
		(
			SELECT sh.`id`
			FROM `audit_events` a
			JOIN `register_shifts` sh ON sh.`id` = CAST(
				CASE WHEN json_valid(a.`metadata_json`)
					THEN json_extract(a.`metadata_json`, '$.refundShiftId')
					ELSE NULL
				END AS TEXT
			)
			WHERE a.`action` = 'retail.sale_refunded'
				AND a.`entity_id` = `retail_sale_tenders`.`sale_id`
			ORDER BY a.`created_at` DESC
			LIMIT 1
		),
		(SELECT s.`shift_id` FROM `retail_sales` s WHERE s.`id` = `retail_sale_tenders`.`sale_id`)
	),
	`actor_user_id` = COALESCE(
		`actor_user_id`,
		(
			SELECT a.`actor_user_id`
			FROM `audit_events` a
			WHERE a.`action` = 'retail.sale_refunded'
				AND a.`entity_id` = `retail_sale_tenders`.`sale_id`
			ORDER BY a.`created_at` DESC
			LIMIT 1
		),
		(SELECT s.`cashier_user_id` FROM `retail_sales` s WHERE s.`id` = `retail_sale_tenders`.`sale_id`)
	)
WHERE `amount_cents` = 0 AND `direction` = 'refund';--> statement-breakpoint
ALTER TABLE `register_shifts`
ADD COLUMN `currency` text DEFAULT 'USD' NOT NULL
CHECK(length(`currency`) BETWEEN 3 AND 8);--> statement-breakpoint
UPDATE `register_shifts`
SET `currency` = COALESCE(
	(SELECT s.`currency` FROM `retail_sales` s WHERE s.`shift_id` = `register_shifts`.`id` ORDER BY s.`created_at` LIMIT 1),
	(SELECT s.`currency` FROM `retail_sale_tenders` t JOIN `retail_sales` s ON s.`id` = t.`sale_id` WHERE t.`shift_id` = `register_shifts`.`id` ORDER BY t.`created_at` LIMIT 1),
	(SELECT settings.`currency` FROM `store_settings` settings WHERE settings.`id` = 'main'),
	'USD'
);
