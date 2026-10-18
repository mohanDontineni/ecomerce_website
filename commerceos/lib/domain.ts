export type ProductImage = {
  id: string;
  url: string;
  alt: string;
  sortOrder: number;
};

export type CategoryPathItem = {
  id: string;
  name: string;
  slug: string;
};

export type CategoryNode = CategoryPathItem & {
  parentId: string | null;
  path: string;
  depth: number;
  children: CategoryNode[];
};

export type ProductOptionValue = {
  id: string;
  value: string;
  position: number;
};

export type ProductOption = {
  id: string;
  name: string;
  position: number;
  values: ProductOptionValue[];
};

export type ProductAttribute = {
  id: string;
  groupName: string;
  name: string;
  value: string;
  position: number;
  visible: boolean;
};

export type VariantOptionValue = {
  optionId: string;
  valueId: string;
  name: string;
  value: string;
  position: number;
};

export type ProductVariant = {
  id: string;
  productId: string;
  title: string;
  sku: string;
  optionSignature: string;
  priceCents: number;
  priceOverrideCents: number | null;
  compareAtCents: number | null;
  costCents: number | null;
  stock: number;
  lowStockThreshold: number;
  status: 'active' | 'archived';
  sortOrder: number;
  isDefault: boolean;
  optionValues: VariantOptionValue[];
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  categoryPath: CategoryPathItem[];
  sku: string;
  priceCents: number;
  compareAtCents: number | null;
  costCents: number | null;
  stock: number;
  lowStockThreshold: number;
  status: 'draft' | 'active' | 'archived';
  featured: boolean;
  ratingBasisPoints: number;
  images: ProductImage[];
  attributes: ProductAttribute[];
  options: ProductOption[];
  variants: ProductVariant[];
  minPriceCents: number;
  maxPriceCents: number;
  createdAt: string;
  updatedAt: string;
};

export type StorefrontVariant = Omit<ProductVariant, 'costCents'>;

export type StorefrontProduct = Omit<Product, 'costCents' | 'variants'> & {
  variants: StorefrontVariant[];
};

export type StoreSettings = {
  title: string;
  tagline: string;
  description: string;
  announcement: string;
  heroTitle: string;
  heroAccent: string;
  heroSubtitle: string;
  currency: string;
  contactEmail: string | null;
  logoUrl: string | null;
  published: boolean;
};

export type ThemeSettings = {
  palette: string;
  mood: string;
  shape: string;
  primaryColor: string;
  accentColor: string;
  surfaceColor: string;
  backgroundImageUrl: string | null;
  backgroundOverlay: number;
  publishedVersion: number;
};

export type StorefrontPayload = {
  store: StoreSettings;
  theme: ThemeSettings;
  products: StorefrontProduct[];
  categories: CategoryNode[];
};

export type CartLine = {
  lineId: string;
  productId: string;
  variantId: string;
  name: string;
  variantTitle: string | null;
  optionSummary: string;
  priceCents: number;
  quantity: number;
  maxQuantity: number;
  imageUrl: string;
  sku: string;
};

export function money(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function catalogPrice(cents: number, currency = 'USD'): string {
  return cents === 0 ? 'Free' : money(cents, currency);
}
