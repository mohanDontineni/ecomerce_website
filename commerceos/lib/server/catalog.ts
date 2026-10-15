import type {
  CategoryNode,
  CategoryPathItem,
  Product,
  ProductAttribute,
  ProductImage,
  ProductOption,
  ProductVariant,
  StoreSettings,
  StorefrontPayload,
  StorefrontProduct,
  ThemeSettings,
  VariantOptionValue,
} from '@/lib/domain';
import { database } from './db';
import { ensureSeedData } from './seed';

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  sku: string;
  price_cents: number;
  compare_at_cents: number | null;
  cost_cents: number | null;
  stock: number;
  low_stock_threshold: number;
  status: Product['status'];
  featured: number;
  rating_basis_points: number;
  created_at: string;
  updated_at: string;
};

type ImageRow = {
  id: string;
  product_id: string;
  url: string;
  alt: string;
  sort_order: number;
};

type AttributeRow = {
  id: string;
  product_id: string;
  group_name: string;
  name: string;
  value: string;
  position: number;
  visible: number;
};

type CategoryRow = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  path: string;
  depth: number;
  status: 'active' | 'archived';
  sort_order: number;
};

type ProductCategoryRow = {
  product_id: string;
  category_id: string;
  is_primary: number;
};

type OptionRow = {
  id: string;
  product_id: string;
  name: string;
  position: number;
};

type OptionValueRow = {
  id: string;
  option_id: string;
  value: string;
  position: number;
};

type VariantRow = {
  id: string;
  product_id: string;
  title: string;
  sku: string;
  option_signature: string;
  price_cents: number | null;
  compare_at_cents: number | null;
  cost_cents: number | null;
  stock: number;
  low_stock_threshold: number;
  status: ProductVariant['status'];
  sort_order: number;
  is_default: number;
};

type VariantValueRow = {
  variant_id: string;
  option_value_id: string;
  option_id: string;
  option_name: string;
  option_position: number;
  value: string;
};

const productColumns = `
  id, slug, name, description, category, sku, price_cents,
  compare_at_cents, cost_cents, stock, low_stock_threshold, status,
  featured, rating_basis_points, created_at, updated_at
`;

function pushToMap<T>(map: Map<string, T[]>, key: string, value: T) {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function toStorefrontProduct(product: Product): StorefrontProduct {
  const { costCents, variants, attributes, ...publicProduct } = product;
  void costCents;
  return {
    ...publicProduct,
    attributes: attributes.filter((attribute) => attribute.visible),
    variants: variants.map((variant) => {
      const { costCents: variantCostCents, ...publicVariant } = variant;
      void variantCostCents;
      return publicVariant;
    }),
  };
}

function buildCategoryPath(
  leafId: string | undefined,
  categoryMap: Map<string, CategoryRow>,
): CategoryPathItem[] {
  if (!leafId) return [];
  const path: CategoryPathItem[] = [];
  const visited = new Set<string>();
  let current = categoryMap.get(leafId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift({ id: current.id, name: current.name, slug: current.slug });
    current = current.parent_id ? categoryMap.get(current.parent_id) : undefined;
  }
  return path;
}

function buildCategoryTree(rows: CategoryRow[]): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>();
  for (const row of rows) {
    if (row.status !== 'active') continue;
    nodes.set(row.id, {
      id: row.id,
      parentId: row.parent_id,
      name: row.name,
      slug: row.slug,
      path: row.path,
      depth: row.depth,
      children: [],
    });
  }
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortNodes = (items: CategoryNode[]) => {
    items.sort((a, b) => a.name.localeCompare(b.name));
    for (const item of items) sortNodes(item.children);
  };
  sortNodes(roots);
  return roots;
}

async function loadCatalogRelations(
  productIds: string[],
  includeHiddenAttributes = false,
) {
  const db = database();
  const productIdsJson = JSON.stringify(productIds);
  const scoped = (statement: D1PreparedStatement) => statement.bind(productIdsJson);
  const [images, attributes, categories, memberships, options, optionValues, variants, variantValues] =
    await Promise.all([
      scoped(db
        .prepare(
          `SELECT id, product_id, url, alt, sort_order
           FROM product_images
           WHERE product_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
           ORDER BY product_id, sort_order`,
        ))
        .all<ImageRow>(),
      scoped(db
        .prepare(
          `SELECT id, product_id, group_name, name, value, position, visible
           FROM product_attributes
           WHERE product_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
             ${includeHiddenAttributes ? '' : 'AND visible = 1'}
           ORDER BY product_id, position`,
        ))
        .all<AttributeRow>(),
      db
        .prepare(
          `SELECT id, parent_id, name, slug, path, depth, status, sort_order
           FROM categories ORDER BY depth, sort_order, name`,
        )
        .all<CategoryRow>(),
      scoped(db
        .prepare(
          `SELECT product_id, category_id, is_primary
           FROM product_categories
           WHERE product_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
           ORDER BY is_primary DESC`,
        ))
        .all<ProductCategoryRow>(),
      scoped(db
        .prepare(
          `SELECT id, product_id, name, position
           FROM product_options
           WHERE product_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
           ORDER BY product_id, position`,
        ))
        .all<OptionRow>(),
      scoped(db
        .prepare(
          `SELECT pov.id, pov.option_id, pov.value, pov.position
           FROM product_option_values pov
           JOIN product_options po ON po.id = pov.option_id
           WHERE po.product_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
           ORDER BY pov.option_id, pov.position`,
        ))
        .all<OptionValueRow>(),
      scoped(db
        .prepare(
          `SELECT id, product_id, title, sku, option_signature, price_cents,
                  compare_at_cents, cost_cents, stock, low_stock_threshold,
                  status, sort_order, is_default
           FROM product_variants
           WHERE product_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
           ORDER BY product_id, sort_order`,
        ))
        .all<VariantRow>(),
      scoped(db
        .prepare(
          `SELECT vov.variant_id, vov.option_value_id, pov.option_id,
                  po.name AS option_name, po.position AS option_position,
                  pov.value
           FROM variant_option_values vov
           JOIN product_option_values pov ON pov.id = vov.option_value_id
           JOIN product_options po ON po.id = pov.option_id
           WHERE po.product_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
           ORDER BY vov.variant_id, po.position, pov.position`,
        ))
        .all<VariantValueRow>(),
    ]);

  return {
    images: images.results,
    attributes: attributes.results,
    categories: categories.results,
    memberships: memberships.results,
    options: options.results,
    optionValues: optionValues.results,
    variants: variants.results,
    variantValues: variantValues.results,
  };
}

export async function getProducts(
  includeInactive = false,
  slug?: string,
): Promise<Product[]> {
  await ensureSeedData();
  const query = slug
    ? `SELECT ${productColumns} FROM products
       WHERE slug = ? ${includeInactive ? '' : "AND status = 'active'"} LIMIT 1`
    : includeInactive
      ? `SELECT ${productColumns} FROM products ORDER BY created_at DESC`
      : `SELECT ${productColumns} FROM products WHERE status = 'active' ORDER BY featured DESC, created_at DESC`;
  const db = database();
  const rows = slug
    ? await db.prepare(query).bind(slug).all<ProductRow>()
    : await db.prepare(query).all<ProductRow>();
  if (slug && rows.results.length === 0) return [];
  const relations = await loadCatalogRelations(
    rows.results.map((row) => row.id),
    includeInactive,
  );

  const imagesByProduct = new Map<string, ProductImage[]>();
  for (const image of relations.images) {
    pushToMap(imagesByProduct, image.product_id, {
      id: image.id,
      url: image.url,
      alt: image.alt,
      sortOrder: image.sort_order,
    });
  }

  const attributesByProduct = new Map<string, ProductAttribute[]>();
  for (const attribute of relations.attributes) {
    pushToMap(attributesByProduct, attribute.product_id, {
      id: attribute.id,
      groupName: attribute.group_name,
      name: attribute.name,
      value: attribute.value,
      position: attribute.position,
      visible: Boolean(attribute.visible),
    });
  }

  const categoryMap = new Map(relations.categories.map((row) => [row.id, row]));
  const primaryCategoryByProduct = new Map<string, string>();
  for (const membership of relations.memberships) {
    if (membership.is_primary || !primaryCategoryByProduct.has(membership.product_id)) {
      primaryCategoryByProduct.set(membership.product_id, membership.category_id);
    }
  }

  const optionValuesByOption = new Map<string, OptionValueRow[]>();
  for (const value of relations.optionValues) {
    pushToMap(optionValuesByOption, value.option_id, value);
  }
  const optionsByProduct = new Map<string, ProductOption[]>();
  for (const option of relations.options) {
    pushToMap(optionsByProduct, option.product_id, {
      id: option.id,
      name: option.name,
      position: option.position,
      values: (optionValuesByOption.get(option.id) ?? []).map((value) => ({
        id: value.id,
        value: value.value,
        position: value.position,
      })),
    });
  }

  const valuesByVariant = new Map<string, VariantOptionValue[]>();
  for (const value of relations.variantValues) {
    pushToMap(valuesByVariant, value.variant_id, {
      optionId: value.option_id,
      valueId: value.option_value_id,
      name: value.option_name,
      value: value.value,
      position: value.option_position,
    });
  }
  const variantsByProduct = new Map<string, VariantRow[]>();
  for (const variant of relations.variants) {
    if (includeInactive || variant.status === 'active') {
      pushToMap(variantsByProduct, variant.product_id, variant);
    }
  }

  return rows.results.map((row) => {
    const variants: ProductVariant[] = (variantsByProduct.get(row.id) ?? []).map(
      (variant) => ({
        id: variant.id,
        productId: variant.product_id,
        title: variant.title,
        sku: variant.sku,
        optionSignature: variant.option_signature,
        priceCents: variant.price_cents ?? row.price_cents,
        priceOverrideCents: variant.price_cents,
        compareAtCents: variant.compare_at_cents ?? row.compare_at_cents,
        costCents: variant.cost_cents ?? row.cost_cents,
        stock: variant.stock,
        lowStockThreshold: variant.low_stock_threshold,
        status: variant.status,
        sortOrder: variant.sort_order,
        isDefault: Boolean(variant.is_default),
        optionValues: valuesByVariant.get(variant.id) ?? [],
      }),
    );
    const sellableVariants = variants.filter((variant) => variant.status === 'active');
    const prices = sellableVariants.map((variant) => variant.priceCents);
    const categoryPath = buildCategoryPath(
      primaryCategoryByProduct.get(row.id),
      categoryMap,
    );
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      category: categoryPath.at(-1)?.name ?? row.category,
      categoryPath,
      sku: row.sku,
      priceCents: row.price_cents,
      compareAtCents: row.compare_at_cents,
      costCents: row.cost_cents,
      stock: sellableVariants.reduce((sum, variant) => sum + variant.stock, 0),
      lowStockThreshold: row.low_stock_threshold,
      status: row.status,
      featured: Boolean(row.featured),
      ratingBasisPoints: row.rating_basis_points,
      images: imagesByProduct.get(row.id) ?? [],
      attributes: attributesByProduct.get(row.id) ?? [],
      options: optionsByProduct.get(row.id) ?? [],
      variants,
      minPriceCents: prices.length > 0 ? Math.min(...prices) : row.price_cents,
      maxPriceCents: prices.length > 0 ? Math.max(...prices) : row.price_cents,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

export async function getProductBySlug(slug: string): Promise<StorefrontProduct | null> {
  const products = await getProducts(false, slug);
  const product = products[0];
  return product ? toStorefrontProduct(product) : null;
}

export async function getStorePresentation(): Promise<{
  store: StoreSettings;
  theme: ThemeSettings;
}> {
  await ensureSeedData();
  const db = database();
  const [storeRow, themeRow] = await Promise.all([
    db
      .prepare(
        `SELECT title, tagline, description, announcement, hero_title,
                hero_accent, hero_subtitle, currency, contact_email, logo_url,
                published
         FROM store_settings WHERE id = 'main'`,
      )
      .first<{
        title: string;
        tagline: string;
        description: string;
        announcement: string;
        hero_title: string;
        hero_accent: string;
        hero_subtitle: string;
        currency: string;
        contact_email: string | null;
        logo_url: string | null;
        published: number;
      }>(),
    db
      .prepare(
        `SELECT palette, mood, shape, primary_color, accent_color, surface_color,
                background_image_url, background_overlay, published_version
         FROM theme_settings WHERE id = 'current'`,
      )
      .first<{
        palette: string;
        mood: string;
        shape: string;
        primary_color: string;
        accent_color: string;
        surface_color: string;
        background_image_url: string | null;
        background_overlay: number;
        published_version: number;
      }>(),
  ]);
  if (!storeRow || !themeRow) throw new Error('Store seed data is unavailable.');

  const store: StoreSettings = {
    title: storeRow.title,
    tagline: storeRow.tagline,
    description: storeRow.description,
    announcement: storeRow.announcement,
    heroTitle: storeRow.hero_title,
    heroAccent: storeRow.hero_accent,
    heroSubtitle: storeRow.hero_subtitle,
    currency: storeRow.currency,
    contactEmail: storeRow.contact_email,
    logoUrl: storeRow.logo_url,
    published: Boolean(storeRow.published),
  };
  const theme: ThemeSettings = {
    palette: themeRow.palette,
    mood: themeRow.mood,
    shape: themeRow.shape,
    primaryColor: themeRow.primary_color,
    accentColor: themeRow.accent_color,
    surfaceColor: themeRow.surface_color,
    backgroundImageUrl: themeRow.background_image_url,
    backgroundOverlay: themeRow.background_overlay,
    publishedVersion: themeRow.published_version,
  };
  return { store, theme };
}

export async function getStorefrontPayload(): Promise<StorefrontPayload> {
  await ensureSeedData();
  const db = database();
  const [presentation, products, categoryRows] = await Promise.all([
    getStorePresentation(),
    getProducts(false),
    db
      .prepare(
        `SELECT id, parent_id, name, slug, path, depth, status, sort_order
         FROM categories ORDER BY depth, sort_order, name`,
      )
      .all<CategoryRow>(),
  ]);
  return {
    ...presentation,
    products: products.map(toStorefrontProduct),
    categories: buildCategoryTree(categoryRows.results),
  };
}
