import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    email: text('email'),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', {
      enum: ['owner', 'admin', 'catalog', 'fulfillment', 'support'],
    })
      .notNull()
      .default('support'),
    status: text('status', { enum: ['active', 'invited', 'disabled'] })
      .notNull()
      .default('active'),
    emailVerified: integer('email_verified', { mode: 'boolean' })
      .notNull()
      .default(false),
    mustChangePassword: integer('must_change_password', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_users_username').on(table.username),
    uniqueIndex('idx_users_email').on(table.email),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_sessions_token_hash').on(table.tokenHash),
    index('idx_sessions_user_id').on(table.userId),
    index('idx_sessions_expires_at').on(table.expiresAt),
  ],
);

export const verificationTokens = sqliteTable(
  'verification_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: text('expires_at').notNull(),
    consumedAt: text('consumed_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_verification_tokens_hash').on(table.tokenHash),
    index('idx_verification_tokens_user_purpose').on(
      table.userId,
      table.purpose,
    ),
  ],
);

export const storeSettings = sqliteTable('store_settings', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  tagline: text('tagline').notNull(),
  description: text('description').notNull(),
  announcement: text('announcement').notNull(),
  heroTitle: text('hero_title').notNull(),
  heroAccent: text('hero_accent').notNull(),
  heroSubtitle: text('hero_subtitle').notNull(),
  currency: text('currency').notNull().default('USD'),
  contactEmail: text('contact_email'),
  logoUrl: text('logo_url'),
  published: integer('published', { mode: 'boolean' }).notNull().default(true),
  updatedAt: text('updated_at').notNull(),
});

export const products = sqliteTable(
  'products',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull(),
    sku: text('sku').notNull(),
    priceCents: integer('price_cents').notNull(),
    compareAtCents: integer('compare_at_cents'),
    costCents: integer('cost_cents'),
    stock: integer('stock').notNull().default(0),
    lowStockThreshold: integer('low_stock_threshold').notNull().default(5),
    status: text('status', { enum: ['draft', 'active', 'archived'] })
      .notNull()
      .default('draft'),
    featured: integer('featured', { mode: 'boolean' }).notNull().default(false),
    ratingBasisPoints: integer('rating_basis_points').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_products_slug').on(table.slug),
    uniqueIndex('idx_products_sku').on(table.sku),
    index('idx_products_status_featured').on(table.status, table.featured),
    index('idx_products_category').on(table.category),
    index('idx_products_stock').on(table.stock),
    check('inventory_available', sql`${table.stock} >= 0`),
    check('products_price_nonnegative', sql`${table.priceCents} >= 0`),
    check(
      'products_threshold_nonnegative',
      sql`${table.lowStockThreshold} >= 0`,
    ),
  ],
);

export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    parentId: text('parent_id').references(
      (): AnySQLiteColumn => categories.id,
      { onDelete: 'restrict' },
    ),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    path: text('path').notNull(),
    depth: integer('depth').notNull().default(0),
    status: text('status', { enum: ['active', 'archived'] })
      .notNull()
      .default('active'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_categories_path').on(table.path),
    index('idx_categories_parent_status').on(table.parentId, table.status),
  ],
);

export const productCategories = sqliteTable(
  'product_categories',
  {
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    isPrimary: integer('is_primary', { mode: 'boolean' })
      .notNull()
      .default(false),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.categoryId] }),
    index('idx_product_categories_category').on(
      table.categoryId,
      table.productId,
    ),
  ],
);

export const productAttributes = sqliteTable(
  'product_attributes',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    groupName: text('group_name').notNull().default('Details'),
    name: text('name').notNull(),
    value: text('value').notNull(),
    position: integer('position').notNull().default(0),
    visible: integer('visible', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_product_attributes_product_group_name').on(
      table.productId,
      table.groupName,
      table.name,
    ),
    index('idx_product_attributes_product_position').on(
      table.productId,
      table.position,
    ),
  ],
);

export const productOptions = sqliteTable(
  'product_options',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_product_options_product_name').on(
      table.productId,
      table.name,
    ),
    index('idx_product_options_product_position').on(
      table.productId,
      table.position,
    ),
  ],
);

export const productOptionValues = sqliteTable(
  'product_option_values',
  {
    id: text('id').primaryKey(),
    optionId: text('option_id')
      .notNull()
      .references(() => productOptions.id, { onDelete: 'cascade' }),
    value: text('value').notNull(),
    position: integer('position').notNull().default(0),
  },
  (table) => [
    uniqueIndex('idx_product_option_values_option_value').on(
      table.optionId,
      table.value,
    ),
    index('idx_product_option_values_option_position').on(
      table.optionId,
      table.position,
    ),
  ],
);

export const productVariants = sqliteTable(
  'product_variants',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    sku: text('sku').notNull(),
    optionSignature: text('option_signature').notNull(),
    priceCents: integer('price_cents'),
    compareAtCents: integer('compare_at_cents'),
    costCents: integer('cost_cents'),
    stock: integer('stock').notNull().default(0),
    lowStockThreshold: integer('low_stock_threshold').notNull().default(5),
    status: text('status', { enum: ['active', 'archived'] })
      .notNull()
      .default('active'),
    sortOrder: integer('sort_order').notNull().default(0),
    isDefault: integer('is_default', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_product_variants_sku').on(table.sku),
    uniqueIndex('idx_product_variants_product_signature').on(
      table.productId,
      table.optionSignature,
    ),
    index('idx_product_variants_product_status').on(
      table.productId,
      table.status,
    ),
    check('variant_inventory_available', sql`${table.stock} >= 0`),
    check(
      'variant_price_nonnegative',
      sql`${table.priceCents} IS NULL OR ${table.priceCents} >= 0`,
    ),
    check(
      'variant_threshold_nonnegative',
      sql`${table.lowStockThreshold} >= 0`,
    ),
  ],
);

export const variantOptionValues = sqliteTable(
  'variant_option_values',
  {
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    optionValueId: text('option_value_id')
      .notNull()
      .references(() => productOptionValues.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.variantId, table.optionValueId] }),
    index('idx_variant_option_values_value').on(
      table.optionValueId,
      table.variantId,
    ),
  ],
);

export const productImages = sqliteTable(
  'product_images',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    objectKey: text('object_key'),
    alt: text('alt').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_product_images_product_order').on(
      table.productId,
      table.sortOrder,
    ),
  ],
);

export const inventoryMovements = sqliteTable(
  'inventory_movements',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    variantId: text('variant_id').references(() => productVariants.id),
    delta: integer('delta').notNull(),
    reason: text('reason').notNull(),
    note: text('note'),
    actorUserId: text('actor_user_id').references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_inventory_movements_product_created').on(
      table.productId,
      table.createdAt,
    ),
    index('idx_inventory_movements_variant_created').on(
      table.variantId,
      table.createdAt,
    ),
  ],
);

export const customers = sqliteTable(
  'customers',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    status: text('status', { enum: ['active', 'disabled'] })
      .notNull()
      .default('active'),
    verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
    orderCount: integer('order_count').notNull().default(0),
    totalSpentCents: integer('total_spent_cents').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_customers_email').on(table.email),
    index('idx_customers_status').on(table.status),
  ],
);

export const orders = sqliteTable(
  'orders',
  {
    id: text('id').primaryKey(),
    orderNumber: text('order_number').notNull(),
    customerId: text('customer_id').references(() => customers.id),
    email: text('email').notNull(),
    status: text('status').notNull(),
    paymentStatus: text('payment_status').notNull(),
    fulfillmentStatus: text('fulfillment_status').notNull(),
    totalCents: integer('total_cents').notNull(),
    currency: text('currency').notNull(),
    paymentProvider: text('payment_provider').notNull(),
    paymentReference: text('payment_reference'),
    shippingJson: text('shipping_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_orders_order_number').on(table.orderNumber),
    index('idx_orders_customer_id').on(table.customerId),
    index('idx_orders_status_created').on(table.status, table.createdAt),
  ],
);

export const orderItems = sqliteTable(
  'order_items',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: text('product_id').references(() => products.id),
    variantId: text('variant_id').references(() => productVariants.id),
    name: text('name').notNull(),
    variantTitle: text('variant_title'),
    optionsJson: text('options_json').notNull().default('{}'),
    sku: text('sku').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    imageUrl: text('image_url'),
  },
  (table) => [
    index('idx_order_items_order_id').on(table.orderId),
    index('idx_order_items_variant_id').on(table.variantId),
    check('order_items_quantity_positive', sql`${table.quantity} > 0`),
    check('order_items_price_nonnegative', sql`${table.unitPriceCents} >= 0`),
  ],
);

export const invitations = sqliteTable(
  'invitations',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_invitations_token_hash').on(table.tokenHash),
    index('idx_invitations_email_status').on(table.email, table.status),
  ],
);

export const themeSettings = sqliteTable('theme_settings', {
  id: text('id').primaryKey(),
  palette: text('palette').notNull(),
  mood: text('mood').notNull(),
  shape: text('shape').notNull(),
  primaryColor: text('primary_color').notNull(),
  accentColor: text('accent_color').notNull(),
  surfaceColor: text('surface_color').notNull(),
  backgroundImageUrl: text('background_image_url'),
  backgroundOverlay: integer('background_overlay').notNull().default(70),
  publishedVersion: integer('published_version').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
});

export const themeVersions = sqliteTable(
  'theme_versions',
  {
    id: text('id').primaryKey(),
    version: integer('version').notNull(),
    snapshotJson: text('snapshot_json').notNull(),
    createdBy: text('created_by').references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('idx_theme_versions_version').on(table.version)],
);

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    actorUserId: text('actor_user_id').references(() => users.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    metadataJson: text('metadata_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_audit_events_created_at').on(table.createdAt),
    index('idx_audit_events_entity').on(table.entityType, table.entityId),
  ],
);

export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    key: text('key').primaryKey(),
    operation: text('operation').notNull(),
    responseJson: text('response_json').notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [index('idx_idempotency_keys_expires_at').on(table.expiresAt)],
);
