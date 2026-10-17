ALTER TABLE `catalog_import_jobs` ADD `dedupe_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_catalog_import_jobs_dedupe` ON `catalog_import_jobs` (`dedupe_key`);--> statement-breakpoint
UPDATE `product_identifiers`
SET `is_primary` = 0
WHERE `is_primary` = 1
  AND EXISTS (
    SELECT 1
    FROM `product_identifiers` AS `newer`
    WHERE `newer`.`variant_id` = `product_identifiers`.`variant_id`
      AND `newer`.`is_primary` = 1
      AND (
        `newer`.`updated_at` > `product_identifiers`.`updated_at`
        OR (
          `newer`.`updated_at` = `product_identifiers`.`updated_at`
          AND `newer`.`id` > `product_identifiers`.`id`
        )
      )
  );--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_identifiers_one_primary` ON `product_identifiers` (`variant_id`) WHERE "product_identifiers"."is_primary" = 1;--> statement-breakpoint
INSERT INTO `location_inventory_movements`
  (`id`, `location_id`, `product_id`, `variant_id`, `delta`, `balance_after`,
   `reason`, `reference_type`, `reference_id`, `external_key`,
   `unit_cost_cents`, `note`, `actor_user_id`, `created_at`)
SELECT
  'lmov_migration_' || lower(hex(randomblob(16))),
  li.`location_id`, pv.`product_id`, li.`variant_id`, li.`on_hand`, li.`on_hand`,
  'opening_stock', 'migration', '0005_legacy_stock',
  'opening:migration:' || li.`location_id` || ':' || li.`variant_id`,
  pv.`cost_cents`, 'Opening balance migrated from legacy variant stock', NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `location_inventory` li
JOIN `product_variants` pv ON pv.`id` = li.`variant_id`
WHERE li.`on_hand` <> 0
  AND NOT EXISTS (
    SELECT 1 FROM `location_inventory_movements` m
    WHERE m.`external_key` =
      'opening:migration:' || li.`location_id` || ':' || li.`variant_id`
  );
