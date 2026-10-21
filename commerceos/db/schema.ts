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
      enum: [
        'owner',
        'admin',
        'catalog',
        'fulfillment',
        'support',
        'cashier',
        'purchasing',
      ],
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

export const retailLocations = sqliteTable(
  'retail_locations',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: text('type', { enum: ['store', 'warehouse', 'virtual'] })
      .notNull()
      .default('store'),
    status: text('status', { enum: ['active', 'inactive'] })
      .notNull()
      .default('active'),
    fulfillmentEnabled: integer('fulfillment_enabled', { mode: 'boolean' })
      .notNull()
      .default(true),
    timezone: text('timezone').notNull().default('UTC'),
    addressJson: text('address_json').notNull().default('{}'),
    taxRateBasisPoints: integer('tax_rate_basis_points').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_retail_locations_code').on(table.code),
    index('idx_retail_locations_status_name').on(table.status, table.name),
    check(
      'retail_location_tax_rate_valid',
      sql`${table.taxRateBasisPoints} >= 0 AND ${table.taxRateBasisPoints} <= 3000`,
    ),
  ],
);

export const retailRegisters = sqliteTable(
  'retail_registers',
  {
    id: text('id').primaryKey(),
    locationId: text('location_id')
      .notNull()
      .references(() => retailLocations.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    status: text('status', { enum: ['active', 'inactive'] })
      .notNull()
      .default('active'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_retail_registers_location_code').on(
      table.locationId,
      table.code,
    ),
    index('idx_retail_registers_location_status').on(
      table.locationId,
      table.status,
    ),
  ],
);

export const productIdentifiers = sqliteTable(
  'product_identifiers',
  {
    id: text('id').primaryKey(),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: ['upc', 'ean', 'gtin', 'isbn', 'mpn', 'internal'],
    }).notNull(),
    value: text('value').notNull(),
    normalizedValue: text('normalized_value').notNull(),
    isPrimary: integer('is_primary', { mode: 'boolean' })
      .notNull()
      .default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_product_identifiers_normalized').on(table.normalizedValue),
    uniqueIndex('idx_product_identifiers_one_primary')
      .on(table.variantId)
      .where(sql`${table.isPrimary} = 1`),
    index('idx_product_identifiers_variant').on(table.variantId),
  ],
);

export const retailVariantDetails = sqliteTable(
  'retail_variant_details',
  {
    variantId: text('variant_id')
      .primaryKey()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    supplierSku: text('supplier_sku'),
    department: text('department'),
    unit: text('unit').notNull().default('each'),
    casePackQuantity: integer('case_pack_quantity').notNull().default(1),
    taxCategory: text('tax_category').notNull().default('general'),
    ageRestriction: integer('age_restriction'),
    trackExpiry: integer('track_expiry', { mode: 'boolean' })
      .notNull()
      .default(false),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_retail_variant_details_supplier_sku').on(table.supplierSku),
    index('idx_retail_variant_details_department').on(table.department),
    check('retail_case_pack_positive', sql`${table.casePackQuantity} > 0`),
    check(
      'retail_age_restriction_valid',
      sql`${table.ageRestriction} IS NULL OR (${table.ageRestriction} >= 0 AND ${table.ageRestriction} <= 99)`,
    ),
  ],
);

export const locationInventory = sqliteTable(
  'location_inventory',
  {
    locationId: text('location_id')
      .notNull()
      .references(() => retailLocations.id, { onDelete: 'restrict' }),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    onHand: integer('on_hand').notNull().default(0),
    reserved: integer('reserved').notNull().default(0),
    reorderPoint: integer('reorder_point').notNull().default(0),
    parLevel: integer('par_level'),
    version: integer('version').notNull().default(1),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.locationId, table.variantId] }),
    index('idx_location_inventory_variant').on(
      table.variantId,
      table.locationId,
    ),
    index('idx_location_inventory_location_stock').on(
      table.locationId,
      table.onHand,
      table.reserved,
    ),
    check(
      'location_inventory_nonnegative',
      sql`${table.onHand} >= 0 AND ${table.reserved} >= 0 AND ${table.reserved} <= ${table.onHand}`,
    ),
    check(
      'location_inventory_thresholds_valid',
      sql`${table.reorderPoint} >= 0 AND (${table.parLevel} IS NULL OR ${table.parLevel} >= ${table.reorderPoint})`,
    ),
  ],
);

export const locationInventoryMovements = sqliteTable(
  'location_inventory_movements',
  {
    id: text('id').primaryKey(),
    locationId: text('location_id')
      .notNull()
      .references(() => retailLocations.id, { onDelete: 'restrict' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    delta: integer('delta').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    reason: text('reason').notNull(),
    referenceType: text('reference_type'),
    referenceId: text('reference_id'),
    externalKey: text('external_key'),
    unitCostCents: integer('unit_cost_cents'),
    note: text('note'),
    actorUserId: text('actor_user_id').references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_location_inventory_movements_external_key').on(
      table.externalKey,
    ),
    index('idx_location_inventory_movements_location_created').on(
      table.locationId,
      table.createdAt,
    ),
    index('idx_location_inventory_movements_variant_created').on(
      table.variantId,
      table.createdAt,
    ),
    index('idx_location_inventory_movements_reference').on(
      table.referenceType,
      table.referenceId,
    ),
    check(
      'location_inventory_balance_nonnegative',
      sql`${table.balanceAfter} >= 0`,
    ),
  ],
);

export const suppliers = sqliteTable(
  'suppliers',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    addressJson: text('address_json').notNull().default('{}'),
    status: text('status', { enum: ['active', 'inactive'] })
      .notNull()
      .default('active'),
    paymentTerms: text('payment_terms'),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_suppliers_code').on(table.code),
    index('idx_suppliers_status_name').on(table.status, table.name),
  ],
);

export const purchaseOrders = sqliteTable(
  'purchase_orders',
  {
    id: text('id').primaryKey(),
    poNumber: text('po_number').notNull(),
    supplierId: text('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    destinationLocationId: text('destination_location_id')
      .notNull()
      .references(() => retailLocations.id, { onDelete: 'restrict' }),
    status: text('status', {
      enum: [
        'draft',
        'submitted',
        'partially_received',
        'received',
        'cancelled',
      ],
    })
      .notNull()
      .default('draft'),
    currency: text('currency').notNull().default('USD'),
    subtotalCents: integer('subtotal_cents').notNull().default(0),
    expectedAt: text('expected_at'),
    note: text('note'),
    createdBy: text('created_by').references(() => users.id),
    submittedAt: text('submitted_at'),
    receivedAt: text('received_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_purchase_orders_number').on(table.poNumber),
    index('idx_purchase_orders_supplier_status_created').on(
      table.supplierId,
      table.status,
      table.createdAt,
    ),
    index('idx_purchase_orders_location_status_expected').on(
      table.destinationLocationId,
      table.status,
      table.expectedAt,
    ),
    check(
      'purchase_orders_subtotal_nonnegative',
      sql`${table.subtotalCents} >= 0`,
    ),
  ],
);

export const purchaseOrderItems = sqliteTable(
  'purchase_order_items',
  {
    id: text('id').primaryKey(),
    purchaseOrderId: text('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    supplierSku: text('supplier_sku'),
    description: text('description').notNull(),
    orderedQuantity: integer('ordered_quantity').notNull(),
    receivedQuantity: integer('received_quantity').notNull().default(0),
    unitCostCents: integer('unit_cost_cents').notNull(),
    expiryDate: text('expiry_date'),
    batchNumber: text('batch_number'),
  },
  (table) => [
    uniqueIndex('idx_purchase_order_items_order_variant').on(
      table.purchaseOrderId,
      table.variantId,
    ),
    index('idx_purchase_order_items_variant').on(table.variantId),
    check(
      'purchase_order_item_quantities_valid',
      sql`${table.orderedQuantity} > 0 AND ${table.receivedQuantity} >= 0 AND ${table.receivedQuantity} <= ${table.orderedQuantity}`,
    ),
    check(
      'purchase_order_item_cost_nonnegative',
      sql`${table.unitCostCents} >= 0`,
    ),
  ],
);

export const registerShifts = sqliteTable(
  'register_shifts',
  {
    id: text('id').primaryKey(),
    registerId: text('register_id')
      .notNull()
      .references(() => retailRegisters.id, { onDelete: 'restrict' }),
    openedBy: text('opened_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    closedBy: text('closed_by').references(() => users.id, {
      onDelete: 'restrict',
    }),
    status: text('status', { enum: ['open', 'closed'] })
      .notNull()
      .default('open'),
    currency: text('currency').notNull().default('USD'),
    openingCashCents: integer('opening_cash_cents').notNull().default(0),
    expectedCashCents: integer('expected_cash_cents').notNull().default(0),
    closingCashCents: integer('closing_cash_cents'),
    varianceCents: integer('variance_cents'),
    openedAt: text('opened_at').notNull(),
    closedAt: text('closed_at'),
    note: text('note'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_register_shifts_one_open')
      .on(table.registerId)
      .where(sql`${table.status} = 'open'`),
    index('idx_register_shifts_opened_by_date').on(
      table.openedBy,
      table.openedAt,
    ),
    index('idx_register_shifts_register_opened').on(
      table.registerId,
      table.openedAt,
    ),
    check(
      'register_shift_cash_nonnegative',
      sql`${table.openingCashCents} >= 0 AND ${table.expectedCashCents} >= 0 AND (${table.closingCashCents} IS NULL OR ${table.closingCashCents} >= 0)`,
    ),
    check(
      'register_shift_currency_present',
      sql`length(${table.currency}) BETWEEN 3 AND 8`,
    ),
  ],
);

export const retailSales = sqliteTable(
  'retail_sales',
  {
    id: text('id').primaryKey(),
    receiptNumber: text('receipt_number').notNull(),
    locationId: text('location_id')
      .notNull()
      .references(() => retailLocations.id, { onDelete: 'restrict' }),
    registerId: text('register_id')
      .notNull()
      .references(() => retailRegisters.id, { onDelete: 'restrict' }),
    shiftId: text('shift_id')
      .notNull()
      .references(() => registerShifts.id, { onDelete: 'restrict' }),
    customerId: text('customer_id').references(() => customers.id, {
      onDelete: 'set null',
    }),
    cashierUserId: text('cashier_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    status: text('status', {
      enum: ['held', 'completed', 'voided', 'partially_refunded', 'refunded'],
    })
      .notNull()
      .default('completed'),
    currency: text('currency').notNull(),
    subtotalCents: integer('subtotal_cents').notNull(),
    discountCents: integer('discount_cents').notNull().default(0),
    taxCents: integer('tax_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull(),
    costCents: integer('cost_cents').notNull().default(0),
    idempotencyKey: text('idempotency_key').notNull(),
    customerName: text('customer_name'),
    customerEmail: text('customer_email'),
    note: text('note'),
    completedAt: text('completed_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_retail_sales_receipt').on(table.receiptNumber),
    uniqueIndex('idx_retail_sales_idempotency').on(table.idempotencyKey),
    index('idx_retail_sales_location_completed').on(
      table.locationId,
      table.completedAt,
    ),
    index('idx_retail_sales_shift_created').on(table.shiftId, table.createdAt),
    index('idx_retail_sales_register_completed').on(
      table.registerId,
      table.completedAt,
    ),
    index('idx_retail_sales_status_created').on(table.status, table.createdAt),
    check(
      'retail_sales_totals_nonnegative',
      sql`${table.subtotalCents} >= 0 AND ${table.discountCents} >= 0 AND ${table.taxCents} >= 0 AND ${table.totalCents} >= 0 AND ${table.costCents} >= 0`,
    ),
  ],
);

export const retailSaleItems = sqliteTable(
  'retail_sale_items',
  {
    id: text('id').primaryKey(),
    saleId: text('sale_id')
      .notNull()
      .references(() => retailSales.id, { onDelete: 'cascade' }),
    lineNumber: integer('line_number').notNull(),
    productId: text('product_id').references(() => products.id, {
      onDelete: 'set null',
    }),
    variantId: text('variant_id').references(() => productVariants.id, {
      onDelete: 'set null',
    }),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    variantTitle: text('variant_title'),
    optionsJson: text('options_json').notNull().default('{}'),
    quantity: integer('quantity').notNull(),
    regularUnitPriceCents: integer('regular_unit_price_cents').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    discountCents: integer('discount_cents').notNull().default(0),
    taxCents: integer('tax_cents').notNull().default(0),
    lineTotalCents: integer('line_total_cents').notNull(),
    unitCostCents: integer('unit_cost_cents').notNull().default(0),
  },
  (table) => [
    uniqueIndex('idx_retail_sale_items_sale_line').on(
      table.saleId,
      table.lineNumber,
    ),
    index('idx_retail_sale_items_variant').on(table.variantId),
    check('retail_sale_item_quantity_positive', sql`${table.quantity} > 0`),
    check(
      'retail_sale_item_money_nonnegative',
      sql`${table.regularUnitPriceCents} >= 0 AND ${table.unitPriceCents} >= 0 AND ${table.discountCents} >= 0 AND ${table.taxCents} >= 0 AND ${table.lineTotalCents} >= 0 AND ${table.unitCostCents} >= 0`,
    ),
  ],
);

export const retailSaleTenders = sqliteTable(
  'retail_sale_tenders',
  {
    id: text('id').primaryKey(),
    saleId: text('sale_id')
      .notNull()
      .references(() => retailSales.id, { onDelete: 'restrict' }),
    shiftId: text('shift_id').references(() => registerShifts.id, {
      onDelete: 'restrict',
    }),
    actorUserId: text('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    kind: text('kind', {
      enum: ['cash', 'card', 'gift_card', 'store_credit', 'other'],
    }).notNull(),
    direction: text('direction', { enum: ['payment', 'refund'] })
      .notNull()
      .default('payment'),
    amountCents: integer('amount_cents').notNull(),
    tenderedAmountCents: integer('tendered_amount_cents'),
    changeCents: integer('change_cents'),
    provider: text('provider'),
    providerReference: text('provider_reference'),
    status: text('status', {
      enum: ['pending', 'authorized', 'captured', 'failed', 'refunded'],
    })
      .notNull()
      .default('captured'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_retail_sale_tenders_sale_created').on(
      table.saleId,
      table.createdAt,
    ),
    index('idx_retail_sale_tenders_provider_reference').on(
      table.provider,
      table.providerReference,
    ),
    index('idx_retail_sale_tenders_shift_created').on(
      table.shiftId,
      table.createdAt,
    ),
    index('idx_retail_sale_tenders_direction_created').on(
      table.direction,
      table.createdAt,
    ),
    check(
      'retail_sale_tender_amount_valid',
      sql`${table.amountCents} > 0 OR (${table.amountCents} = 0 AND ${table.kind} = 'other' AND ${table.direction} = 'refund' AND ${table.status} = 'refunded' AND ${table.provider} = 'mdcart' AND ${table.providerReference} IS NULL AND ${table.tenderedAmountCents} = 0 AND ${table.changeCents} = 0)`,
    ),
    check(
      'retail_sale_tender_cash_details_valid',
      sql`(${table.tenderedAmountCents} IS NULL AND ${table.changeCents} IS NULL) OR (${table.tenderedAmountCents} >= ${table.amountCents} AND ${table.changeCents} = ${table.tenderedAmountCents} - ${table.amountCents})`,
    ),
  ],
);

export const catalogImportJobs = sqliteTable(
  'catalog_import_jobs',
  {
    id: text('id').primaryKey(),
    kind: text('kind', {
      enum: ['catalog_upsert', 'inventory_snapshot', 'inventory_delta'],
    }).notNull(),
    status: text('status', {
      enum: ['analyzing', 'review', 'ready', 'applying', 'completed', 'failed'],
    })
      .notNull()
      .default('review'),
    originalFilename: text('original_filename').notNull(),
    format: text('format', {
      enum: ['csv', 'tsv', 'json', 'xlsx', 'xml'],
    }).notNull(),
    contentSha256: text('content_sha256').notNull(),
    dedupeKey: text('dedupe_key'),
    mappingJson: text('mapping_json').notNull().default('{}'),
    defaultsJson: text('defaults_json').notNull().default('{}'),
    summaryJson: text('summary_json').notNull().default('{}'),
    totalRows: integer('total_rows').notNull().default(0),
    validRows: integer('valid_rows').notNull().default(0),
    warningRows: integer('warning_rows').notNull().default(0),
    errorRows: integer('error_rows').notNull().default(0),
    appliedRows: integer('applied_rows').notNull().default(0),
    requestedBy: text('requested_by').references(() => users.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => [
    index('idx_catalog_import_jobs_status_created').on(
      table.status,
      table.createdAt,
    ),
    index('idx_catalog_import_jobs_user_created').on(
      table.requestedBy,
      table.createdAt,
    ),
    index('idx_catalog_import_jobs_digest').on(table.contentSha256),
    uniqueIndex('idx_catalog_import_jobs_dedupe').on(table.dedupeKey),
  ],
);

export const catalogImportRows = sqliteTable(
  'catalog_import_rows',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => catalogImportJobs.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(),
    sourceJson: text('source_json').notNull(),
    normalizedJson: text('normalized_json').notNull(),
    fingerprint: text('fingerprint').notNull(),
    groupKey: text('group_key').notNull(),
    action: text('action', {
      enum: [
        'create_product',
        'create_variant',
        'create_variant_pending',
        'update',
        'adjust',
        'unchanged',
        'skip',
      ],
    }).notNull(),
    status: text('status', {
      enum: ['valid', 'warning', 'error', 'applied', 'skipped'],
    }).notNull(),
    confidenceBasisPoints: integer('confidence_basis_points')
      .notNull()
      .default(0),
    productId: text('product_id').references(() => products.id, {
      onDelete: 'set null',
    }),
    variantId: text('variant_id').references(() => productVariants.id, {
      onDelete: 'set null',
    }),
    errorsJson: text('errors_json').notNull().default('[]'),
    warningsJson: text('warnings_json').notNull().default('[]'),
    appliedAt: text('applied_at'),
  },
  (table) => [
    uniqueIndex('idx_catalog_import_rows_job_row').on(
      table.jobId,
      table.rowNumber,
    ),
    uniqueIndex('idx_catalog_import_rows_job_fingerprint').on(
      table.jobId,
      table.fingerprint,
    ),
    index('idx_catalog_import_rows_job_status_row').on(
      table.jobId,
      table.status,
      table.rowNumber,
    ),
    index('idx_catalog_import_rows_job_group').on(table.jobId, table.groupKey),
    check(
      'catalog_import_confidence_valid',
      sql`${table.confidenceBasisPoints} >= 0 AND ${table.confidenceBasisPoints} <= 10000`,
    ),
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
