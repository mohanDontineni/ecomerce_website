UPDATE `store_settings`
SET `title` = 'MDCart',
    `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `id` = 'main' AND `title` = 'PrismCart';
--> statement-breakpoint
UPDATE `store_settings`
SET `contact_email` = NULL,
    `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `id` = 'main' AND `contact_email` = 'hello@prismcart.dev';
