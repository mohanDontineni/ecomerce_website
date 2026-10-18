import readXlsxFile from 'read-excel-file/browser';

import {
  DEFAULT_PRODUCT_TEMPLATE,
  PRODUCT_TEMPLATES,
  type ProductTemplate,
} from './catalog-templates';

export type BulkImportFormat = 'csv' | 'tsv' | 'json' | 'xlsx';

export type BulkImportMode =
  | 'catalog_upsert'
  | 'stock_snapshot'
  | 'stock_adjustment';

export type BulkImportField =
  | 'parentSku'
  | 'sku'
  | 'barcode'
  | 'name'
  | 'description'
  | 'brand'
  | 'categoryPath'
  | 'price'
  | 'compareAtPrice'
  | 'cost'
  | 'stock'
  | 'stockDelta'
  | 'lowStockThreshold'
  | 'status'
  | 'imageUrls'
  | 'option1Name'
  | 'option1Value'
  | 'option2Name'
  | 'option2Value'
  | 'option3Name'
  | 'option3Value';

export type BulkCellValue = string | number | boolean | Date | null;

export type BulkImportIssue = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  scope: 'file' | 'sheet' | 'row' | 'group';
  sheet?: string;
  rowNumber?: number;
  field?: BulkImportField;
  groupKey?: string;
};

export type BulkColumnMapping = {
  index: number;
  header: string;
  field: BulkImportField | 'ignore';
  confidence: number;
  source: 'alias' | 'inferred-option' | 'override' | 'unmapped';
  optionName?: string;
};

export type BulkImportHeader = {
  rowNumber: number;
  headers: string[];
  mappings: BulkColumnMapping[];
  confidence: number;
  issues: BulkImportIssue[];
};

export type BulkImportSourceRow = {
  rowNumber: number;
  cells: BulkCellValue[];
  displayCells: string[];
  kind: 'preamble' | 'header' | 'data' | 'blank';
};

export type BulkImportSheet = {
  name: string;
  header: BulkImportHeader;
  sourceRows: BulkImportSourceRow[];
  issues: BulkImportIssue[];
};

export type BulkImportOptionValue = {
  name: string;
  value: string;
};

export type BulkImportValues = {
  parentSku: string;
  sku: string;
  barcode: string;
  name: string;
  description: string;
  brand: string;
  sourceCategoryPath: string[];
  priceCents: number | null;
  compareAtCents: number | null;
  costCents: number | null;
  stock: number | null;
  stockDelta: number | null;
  lowStockThreshold: number | null;
  status: 'draft' | 'active' | 'archived' | null;
  imageUrls: string[];
  options: BulkImportOptionValue[];
};

export type BulkCategoryInference = {
  templateId: string;
  templateLabel: string;
  categoryPath: string[];
  confidence: number;
  source: 'source' | 'inferred' | 'fallback';
  evidence: string[];
  runnerUpTemplateId?: string;
  requiresReview: boolean;
  complianceNote?: string;
};

export type BulkImportRow = {
  id: string;
  sheet: string;
  rowNumber: number;
  kind: 'data' | 'blank';
  rawCells: BulkCellValue[];
  displayCells: string[];
  rawRecord: Record<string, string>;
  values: BulkImportValues;
  parentKey: string;
  categoryInference: BulkCategoryInference;
  issues: BulkImportIssue[];
};

export type BulkProductGroup = {
  key: string;
  parentSku: string;
  name: string;
  explicitParent: boolean;
  rows: BulkImportRow[];
  variantSkus: string[];
  categoryInference: BulkCategoryInference;
  status: 'ready' | 'review' | 'error';
  issues: BulkImportIssue[];
};

export type BulkImportPreviewSummary = {
  sheetCount: number;
  physicalRows: number;
  headerRows: number;
  preambleRows: number;
  blankRows: number;
  dataRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  productGroups: number;
  variantRows: number;
  inferredCategoryRows: number;
  reviewRequiredGroups: number;
};

export type BulkImportPreview = {
  format: BulkImportFormat;
  fileName: string;
  sheets: BulkImportSheet[];
  rows: BulkImportRow[];
  groups: BulkProductGroup[];
  issues: BulkImportIssue[];
  summary: BulkImportPreviewSummary;
};

export type BulkImportParseOptions = {
  fileName?: string;
  format?: BulkImportFormat;
  mode?: BulkImportMode;
  sheetNames?: string[];
  headerRowBySheet?: Record<string, number>;
  /**
   * Explicit per-sheet namespaces applied to every SKU and parent SKU in the
   * sheet. Explicit prefixes take priority over automatic collision handling.
   */
  skuPrefixBySheet?: Record<string, string>;
  /**
   * Opt in to namespacing non-identical SKU records that collide across sheets.
   * Same-sheet duplicates and repeated stable product identities across sheets
   * are left for review instead of being silently changed.
   */
  autoResolveCrossSheetSkuCollisions?: boolean;
  columnMappingsBySheet?: Record<
    string,
    Record<string, BulkImportField | 'ignore'>
  >;
  categoryConfidenceThreshold?: number;
};

type SheetMatrix = {
  name: string;
  rows: BulkCellValue[][];
};

type CategoryInput = Pick<
  BulkImportValues,
  'name' | 'description' | 'brand' | 'sourceCategoryPath'
>;

type HeaderMatch = {
  field: BulkImportField;
  confidence: number;
};

const HEADER_ALIASES: Record<BulkImportField, readonly string[]> = {
  parentSku: [
    'parent sku',
    'parent_sku',
    'parent id',
    'parent item',
    'parent item number',
    'product handle',
    'handle',
    'style number',
    'style id',
  ],
  sku: [
    'sku',
    'item sku',
    'item id',
    'variant sku',
    'seller sku',
    'merchant sku',
    'item number',
    'item no',
    'product code',
    'stock code',
  ],
  barcode: ['barcode', 'upc', 'upc code', 'ean', 'ean code', 'gtin', 'isbn'],
  name: [
    'name',
    'product name',
    'product title',
    'item name',
    'item title',
    'title',
  ],
  description: [
    'description',
    'product description',
    'item description',
    'long description',
    'details',
  ],
  brand: ['brand', 'brand name', 'manufacturer', 'maker', 'vendor brand'],
  categoryPath: [
    'category',
    'categories',
    'category path',
    'department',
    'product type',
    'item type',
    'class',
    'subclass',
    'subcategory',
    'sub category',
    'collection',
  ],
  price: [
    'price',
    'final price',
    'retail price',
    'sale price',
    'selling price',
    'unit price',
    'msrp price',
  ],
  compareAtPrice: [
    'compare at price',
    'compare-at price',
    'list price',
    'original price',
    'msrp',
    'rrp',
  ],
  cost: ['cost', 'unit cost', 'item cost', 'purchase cost', 'wholesale cost'],
  stock: [
    'stock',
    'inventory',
    'quantity',
    'qunatity',
    'qty',
    'on hand',
    'quantity on hand',
    'available quantity',
    'inventory quantity',
  ],
  stockDelta: [
    'stock delta',
    'inventory delta',
    'adjustment',
    'quantity change',
    'qty change',
  ],
  lowStockThreshold: [
    'low stock threshold',
    'reorder point',
    'reorder level',
    'minimum stock',
    'min stock',
  ],
  status: ['status', 'product status', 'publishing status', 'active'],
  imageUrls: [
    'image',
    'image url',
    'image urls',
    'images',
    'photo',
    'photo url',
    'picture',
    'picture url',
  ],
  option1Name: ['option 1 name', 'option1 name', 'option name 1'],
  option1Value: [
    'option 1 value',
    'option1 value',
    'option value 1',
    'variant option 1',
  ],
  option2Name: ['option 2 name', 'option2 name', 'option name 2'],
  option2Value: [
    'option 2 value',
    'option2 value',
    'option value 2',
    'variant option 2',
  ],
  option3Name: ['option 3 name', 'option3 name', 'option name 3'],
  option3Value: [
    'option 3 value',
    'option3 value',
    'option value 3',
    'variant option 3',
  ],
};

const OPTION_HEADER_NAMES: Record<string, string> = {
  size: 'Size',
  color: 'Color',
  colour: 'Color',
  material: 'Material',
  style: 'Style',
  width: 'Width',
  flavor: 'Flavor',
  flavour: 'Flavor',
  scent: 'Scent',
  fragrance: 'Fragrance',
  capacity: 'Capacity',
  storage: 'Storage',
  memory: 'Memory',
  finish: 'Finish',
  grade: 'Grade',
  condition: 'Condition',
  pack: 'Pack',
  'pack size': 'Pack size',
  bundle: 'Bundle',
  model: 'Model',
};

const CATEGORY_HINTS: Partial<Record<string, readonly string[]>> = {
  apparel: [
    'shirt',
    'tshirt',
    'tee',
    'dress',
    'pants',
    'jeans',
    'jacket',
    'clothing',
    'garment',
    'kurta',
    'kurti',
    'saree',
    'sari',
    'salwar',
    'lehenga',
    'blouse',
    'tunic',
    'coord set',
    'co ord set',
    'anarkali',
  ],
  footwear: [
    'shoe',
    'shoes',
    'sneaker',
    'boot',
    'sandal',
    'slipper',
    'footwear',
  ],
  jewelry: [
    'ring',
    'necklace',
    'bracelet',
    'earring',
    'earrings',
    'earings',
    'ear chain',
    'pendant',
    'pendants',
    'bangle',
    'bangles',
    'neck set',
    'nose pin',
    'mangalsutra',
    'anklet',
    'anklets',
    'hip belt',
    'black beads',
    'beads set',
    'kanti chain',
    'tika',
    'jewelry',
    'jewellery',
    'gemstone',
  ],
  watches: ['watch', 'wristwatch', 'timepiece'],
  'bags-luggage': [
    'handbag',
    'backpack',
    'wallet',
    'luggage',
    'suitcase',
    'duffel',
  ],
  'consumer-electronics': [
    'electronic',
    'device',
    'adapter',
    'charger',
    'gadget',
  ],
  'computers-tablets': [
    'laptop',
    'desktop',
    'computer',
    'tablet',
    'monitor',
    'keyboard',
    'mouse',
  ],
  'phones-accessories': [
    'phone',
    'smartphone',
    'mobile',
    'phone case',
    'screen protector',
  ],
  'tv-home-theater': [
    'television',
    'tv',
    'projector',
    'home theater',
    'streaming device',
  ],
  'audio-headphones': ['headphone', 'earbud', 'speaker', 'microphone', 'audio'],
  'cameras-drones': ['camera', 'lens', 'tripod', 'drone', 'photography'],
  'smart-home-security': [
    'smart home',
    'doorbell',
    'security camera',
    'alarm',
    'thermostat',
  ],
  'video-games': ['video game', 'console', 'controller', 'gaming'],
  'home-kitchen': [
    'cookware',
    'kitchen',
    'dinnerware',
    'utensil',
    'housewares',
  ],
  furniture: ['furniture', 'chair', 'table', 'sofa', 'desk', 'mattress'],
  'home-decor': ['decor', 'lamp', 'lighting', 'rug', 'curtain', 'mirror'],
  'bedding-bath': [
    'bedding',
    'sheet',
    'bedsheet',
    'bed sheet',
    'pillow',
    'pillowcase',
    'blanket',
    'comforter',
    'duvet',
    'towel',
    'bath',
  ],
  appliances: [
    'appliance',
    'refrigerator',
    'washer',
    'dryer',
    'microwave',
    'vacuum',
  ],
  'patio-outdoor': ['patio', 'grill', 'outdoor furniture', 'fire pit'],
  'lawn-garden': ['garden', 'plant', 'seed', 'fertilizer', 'lawn'],
  'home-improvement': [
    'tool',
    'hardware',
    'plumbing',
    'electrical',
    'paint',
    'home improvement',
  ],
  'grocery-food': [
    'food',
    'snack',
    'candy',
    'chocolate',
    'cereal',
    'sauce',
    'spice',
    'grocery',
  ],
  beverages: ['beverage', 'drink', 'water', 'soda', 'juice', 'coffee', 'tea'],
  alcohol: ['beer', 'wine', 'liquor', 'spirits', 'alcohol'],
  'household-essentials': [
    'cleaner',
    'detergent',
    'paper towel',
    'toilet paper',
    'trash bag',
  ],
  'health-wellness': [
    'vitamin',
    'supplement',
    'wellness',
    'pain relief',
    'otc',
  ],
  'pharmacy-regulated': [
    'prescription',
    'pharmacy',
    'medicine',
    'medication',
    'drug',
  ],
  'medical-supplies': [
    'bandage',
    'medical supply',
    'wheelchair',
    'thermometer',
    'first aid',
  ],
  beauty: [
    'makeup',
    'cosmetic',
    'lipstick',
    'foundation',
    'mascara',
    'skincare',
  ],
  'personal-care': [
    'shampoo',
    'soap',
    'deodorant',
    'toothpaste',
    'grooming',
    'personal care',
  ],
  baby: ['baby', 'diaper', 'infant', 'toddler', 'stroller'],
  'pet-supplies': ['pet', 'dog', 'cat', 'aquarium', 'pet food'],
  'toys-games': ['toy', 'board game', 'puzzle', 'doll', 'action figure'],
  'sports-outdoors': [
    'sport',
    'fitness',
    'exercise',
    'camping',
    'hiking',
    'bicycle',
  ],
  'arts-crafts': [
    'craft',
    'sewing',
    'yarn',
    'fabric',
    'paintbrush',
    'art supply',
  ],
  'party-seasonal': ['party', 'balloon', 'holiday', 'seasonal', 'costume'],
  'musical-instruments': [
    'guitar',
    'piano',
    'drum',
    'instrument',
    'music equipment',
  ],
  'fine-art-antiques': [
    'antique',
    'fine art',
    'painting',
    'sculpture',
    'vintage art',
  ],
  'flowers-gift-baskets': ['flower', 'bouquet', 'gift basket', 'floral'],
  collectibles: ['collectible', 'memorabilia', 'trading card', 'figurine'],
  books: ['book', 'novel', 'textbook', 'magazine', 'ebook'],
  'movies-music': ['movie', 'dvd', 'blu ray', 'vinyl', 'album', 'music'],
  'office-school': [
    'office',
    'school supply',
    'notebook',
    'pen',
    'printer paper',
  ],
  'software-digital': [
    'software',
    'download',
    'license key',
    'digital product',
  ],
  'gift-cards': ['gift card', 'voucher', 'prepaid'],
  automotive: ['automotive', 'car part', 'tire', 'motor oil', 'vehicle'],
  'powersports-rv': ['motorcycle', 'atv', 'boat', 'marine', 'rv'],
  'industrial-scientific': [
    'industrial',
    'laboratory',
    'scientific',
    'safety equipment',
  ],
  'restaurant-supplies': [
    'restaurant',
    'food service',
    'commercial kitchen',
    'takeout container',
  ],
  'farm-agriculture': [
    'farm',
    'agriculture',
    'livestock',
    'tractor',
    'animal feed',
  ],
  'resale-refurbished': [
    'used',
    'renewed',
    'refurbished',
    'open box',
    'preowned',
  ],
};

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'item',
  'of',
  'or',
  'product',
  'products',
  'the',
  'to',
  'with',
]);

const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,63}$/;
const SKU_PREFIX_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;

export class BulkImportParseError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BulkImportParseError';
    this.code = code;
  }
}

function canonical(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .toLocaleLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cellText(value: BulkCellValue | undefined): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function normalizedSku(value: string): string {
  return value.normalize('NFKC').trim().toUpperCase();
}

function normalizedSkuPrefix(value: string | undefined, sheet: string): string {
  if (!value?.trim()) return '';
  const prefix = value
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[-_.]+$/g, '');
  if (!SKU_PREFIX_PATTERN.test(prefix)) {
    throw new BulkImportParseError(
      'INVALID_SKU_PREFIX',
      `The SKU prefix for ${sheet} must be 1–32 letters, numbers, dots, dashes, or underscores and must start with a letter or number.`,
    );
  }
  return prefix;
}

function prefixSku(sku: string, prefix: string): string {
  return sku && prefix ? `${prefix}-${sku}` : sku;
}

function issue(
  partial: Omit<BulkImportIssue, 'scope'> & {
    scope?: BulkImportIssue['scope'];
  },
): BulkImportIssue {
  return { scope: partial.scope ?? 'row', ...partial };
}

function matchHeader(header: string): HeaderMatch | null {
  const normalized = canonical(header);
  if (!normalized) return null;
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<
    [BulkImportField, readonly string[]]
  >) {
    if (aliases.some((alias) => canonical(alias) === normalized)) {
      return { field, confidence: 1 };
    }
  }
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<
    [BulkImportField, readonly string[]]
  >) {
    const matched = aliases.some((alias) => {
      const candidate = canonical(alias);
      const sourceLetters = normalized.replace(/[^a-z]/g, '').length;
      const candidateLetters = candidate.replace(/[^a-z]/g, '').length;
      if (sourceLetters < 4 || candidateLetters < 4) return false;
      if (normalized.replaceAll(' ', '') === candidate.replaceAll(' ', '')) {
        return true;
      }
      return ` ${normalized} `.includes(` ${candidate} `);
    });
    if (matched) return { field, confidence: 0.72 };
  }
  return null;
}

function mappingsForHeaders(headers: string[]): BulkColumnMapping[] {
  const mappings = headers.map((header, index): BulkColumnMapping => {
    const match = matchHeader(header);
    return match
      ? {
          index,
          header,
          field: match.field,
          confidence: match.confidence,
          source: 'alias',
        }
      : {
          index,
          header,
          field: 'ignore',
          confidence: 0,
          source: 'unmapped',
        };
  });

  const usedOptionSlots = new Set<number>();
  for (const mapping of mappings) {
    const matched = /^option([123])(?:Name|Value)$/.exec(mapping.field);
    if (matched) usedOptionSlots.add(Number(matched[1]));
  }
  for (const mapping of mappings) {
    if (mapping.field !== 'ignore') continue;
    const optionName = OPTION_HEADER_NAMES[canonical(mapping.header)];
    if (!optionName) continue;
    const slot = [1, 2, 3].find((candidate) => !usedOptionSlots.has(candidate));
    if (!slot) continue;
    usedOptionSlots.add(slot);
    mapping.field = `option${slot}Value` as BulkImportField;
    mapping.confidence = 0.92;
    mapping.source = 'inferred-option';
    mapping.optionName = optionName;
  }
  return mappings;
}

const NUMERIC_IMPORT_FIELDS = new Set<BulkImportField>([
  'price',
  'compareAtPrice',
  'cost',
  'stock',
  'stockDelta',
  'lowStockThreshold',
]);
const IDENTIFIER_IMPORT_FIELDS = new Set<BulkImportField>([
  'parentSku',
  'sku',
  'barcode',
]);

function comparableDuplicateCell(
  value: BulkCellValue | undefined,
  field: BulkImportField,
): string {
  const text = cellText(value);
  if (!text) return '';
  if (IDENTIFIER_IMPORT_FIELDS.has(field)) {
    return `identifier:${text.normalize('NFKC').toUpperCase()}`;
  }
  if (NUMERIC_IMPORT_FIELDS.has(field)) {
    const possibleNumber = text.replace(/[,$£€₹]/g, '').replace(/\s+/g, '');
    if (/^[-+]?\d+(?:\.\d+)?$/.test(possibleNumber)) {
      return `number:${Number(possibleNumber)}`;
    }
  }
  return `text:${canonical(text)}`;
}

function collapseEquivalentDuplicateMappings(
  mappings: BulkColumnMapping[],
  dataRows: BulkCellValue[][],
): BulkColumnMapping[] {
  const repeatable = new Set<BulkImportField>(['categoryPath', 'imageUrls']);
  const byField = new Map<BulkImportField, BulkColumnMapping[]>();
  for (const mapping of mappings) {
    if (mapping.field === 'ignore' || repeatable.has(mapping.field)) continue;
    const matches = byField.get(mapping.field) ?? [];
    matches.push(mapping);
    byField.set(mapping.field, matches);
  }

  const redundantIndexes = new Set<number>();
  for (const duplicates of byField.values()) {
    if (duplicates.length < 2) continue;
    const ranked = [...duplicates].sort((left, right) => {
      const sourceStrength = (mapping: BulkColumnMapping) =>
        mapping.source === 'override'
          ? 3
          : mapping.source === 'alias'
            ? 2
            : mapping.source === 'inferred-option'
              ? 1
              : 0;
      return (
        right.confidence - left.confidence ||
        sourceStrength(right) - sourceStrength(left) ||
        right.index - left.index
      );
    });
    const winner = ranked[0];
    const equivalent = dataRows.every((row) => {
      const winnerValue = comparableDuplicateCell(
        row[winner.index],
        winner.field as BulkImportField,
      );
      const nonEmpty = duplicates
        .map((mapping) =>
          comparableDuplicateCell(
            row[mapping.index],
            mapping.field as BulkImportField,
          ),
        )
        .filter(Boolean);
      return (
        nonEmpty.length === 0 ||
        (Boolean(winnerValue) &&
          nonEmpty.every((value) => value === winnerValue))
      );
    });
    if (!equivalent) continue;
    for (const mapping of duplicates) {
      if (mapping.index !== winner.index) redundantIndexes.add(mapping.index);
    }
  }

  return mappings.map((mapping) =>
    redundantIndexes.has(mapping.index)
      ? {
          ...mapping,
          field: 'ignore',
          confidence: 0,
          source: 'unmapped',
          optionName: undefined,
        }
      : mapping,
  );
}

function headerDiagnostics(
  headers: string[],
  mappings: BulkColumnMapping[],
  sheet: string,
  rowNumber: number,
): Pick<BulkImportHeader, 'confidence' | 'issues'> {
  const mappedCount = mappings.filter(
    (mapping) => mapping.field !== 'ignore',
  ).length;
  const confidence =
    headers.length === 0
      ? 0
      : Math.min(1, mappedCount / Math.min(5, headers.length));
  const issues: BulkImportIssue[] = [];
  if (mappedCount === 0) {
    issues.push(
      issue({
        severity: 'error',
        code: 'HEADER_NOT_RECOGNIZED',
        message: `No supported inventory columns were recognized in ${sheet}.`,
        scope: 'sheet',
        sheet,
        rowNumber,
      }),
    );
  } else if (confidence < 0.5) {
    issues.push(
      issue({
        severity: 'warning',
        code: 'HEADER_LOW_CONFIDENCE',
        message: `Review the detected columns for ${sheet} before applying this import.`,
        scope: 'sheet',
        sheet,
        rowNumber,
      }),
    );
  }

  const repeatable = new Set<BulkImportField>(['categoryPath', 'imageUrls']);
  const fields = new Map<BulkImportField, BulkColumnMapping[]>();
  for (const mapping of mappings) {
    if (mapping.field === 'ignore') continue;
    const values = fields.get(mapping.field) ?? [];
    values.push(mapping);
    fields.set(mapping.field, values);
  }
  for (const [field, duplicates] of fields) {
    if (duplicates.length <= 1 || repeatable.has(field)) continue;
    issues.push(
      issue({
        severity: 'warning',
        code: 'DUPLICATE_COLUMN_MAPPING',
        message: `${duplicates.map((mapping) => mapping.header).join(', ')} all map to ${field}; the first non-empty value will be used.`,
        scope: 'sheet',
        sheet,
        field,
      }),
    );
  }
  return { confidence, issues };
}

function headerCandidateScore(row: BulkCellValue[]): number {
  const texts = row.map(cellText);
  const nonEmpty = texts.filter(Boolean);
  if (nonEmpty.length === 0) return Number.NEGATIVE_INFINITY;
  const mappings = mappingsForHeaders(texts);
  const aliases = mappings.filter((mapping) => mapping.field !== 'ignore');
  const uniqueAliases = new Set(aliases.map((mapping) => mapping.field)).size;
  const numericCells = nonEmpty.filter((value) =>
    /^[-+]?\d+(?:[.,]\d+)?$/.test(value),
  ).length;
  return (
    aliases.length * 10 +
    uniqueAliases * 3 +
    nonEmpty.length * 0.2 -
    numericCells * 2
  );
}

export function detectBulkImportHeader(
  rows: BulkCellValue[][],
  sheet = 'Sheet 1',
  forcedRowNumber?: number,
): BulkImportHeader {
  if (rows.length === 0) {
    return {
      rowNumber: 1,
      headers: [],
      mappings: [],
      confidence: 0,
      issues: [
        issue({
          severity: 'error',
          code: 'EMPTY_SHEET',
          message: `${sheet} does not contain any rows.`,
          scope: 'sheet',
          sheet,
        }),
      ],
    };
  }

  let rowIndex: number;
  if (forcedRowNumber != null) {
    rowIndex = Math.max(
      0,
      Math.min(rows.length - 1, Math.trunc(forcedRowNumber) - 1),
    );
  } else {
    const candidates = rows.slice(0, 25).map((row, index) => ({
      index,
      score: headerCandidateScore(row),
    }));
    candidates.sort(
      (left, right) => right.score - left.score || left.index - right.index,
    );
    rowIndex = candidates[0]?.index ?? 0;
  }

  const headers = rows[rowIndex].map(
    (value, index) => cellText(value) || `Column ${index + 1}`,
  );
  const mappings = collapseEquivalentDuplicateMappings(
    mappingsForHeaders(headers),
    rows.slice(rowIndex + 1),
  );
  const { confidence, issues } = headerDiagnostics(
    headers,
    mappings,
    sheet,
    rowIndex + 1,
  );

  return { rowNumber: rowIndex + 1, headers, mappings, confidence, issues };
}

function delimiterCounts(text: string): Record<',' | ';' | '\t' | '|', number> {
  const counts: Record<',' | ';' | '\t' | '|', number> = {
    ',': 0,
    ';': 0,
    '\t': 0,
    '|': 0,
  };
  let quoted = false;
  let rows = 0;
  for (let index = 0; index < text.length && rows < 10; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
      continue;
    }
    if (!quoted && character in counts)
      counts[character as keyof typeof counts] += 1;
    if (!quoted && character === '\n') rows += 1;
  }
  return counts;
}

function detectCsvDelimiter(text: string): ',' | ';' | '\t' | '|' {
  const counts = delimiterCounts(text);
  return (
    (Object.entries(counts) as Array<[keyof typeof counts, number]>).sort(
      (left, right) => right[1] - left[1],
    )[0]?.[0] ?? ','
  );
}

export function parseDelimitedText(
  text: string,
  delimiter: ',' | ';' | '\t' | '|' = ',',
): BulkCellValue[][] {
  const source = text.replace(/^\uFEFF/, '');
  const rows: BulkCellValue[][] = [];
  let row: BulkCellValue[] = [];
  let field = '';
  let quoted = false;
  let endedOnNewline = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      endedOnNewline = false;
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
      endedOnNewline = false;
    } else if (character === delimiter) {
      pushField();
      endedOnNewline = false;
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      pushRow();
      endedOnNewline = true;
    } else {
      field += character;
      endedOnNewline = false;
    }
  }
  if (quoted) {
    throw new BulkImportParseError(
      'UNCLOSED_QUOTE',
      'The delimited file ends inside a quoted field.',
    );
  }
  if (!endedOnNewline || field.length > 0 || row.length > 0) pushRow();
  return rows;
}

function tokenSet(value: string): Set<string> {
  return new Set(
    canonical(value)
      .split(' ')
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
  );
}

function templateTerms(template: ProductTemplate): string[] {
  return [
    template.id.replaceAll('-', ' '),
    template.label,
    template.description,
    ...template.categoryPath,
    ...(CATEGORY_HINTS[template.id] ?? []),
  ];
}

function containsMeaningfulPhrase(source: string, phrase: string): boolean {
  if (phrase.replace(/[^a-z]/g, '').length < 4) return false;
  return ` ${source} `.includes(` ${phrase} `);
}

function scoreTemplate(template: ProductTemplate, input: CategoryInput) {
  const categoryText = input.sourceCategoryPath.join(' ');
  const normalizedCategoryText = canonical(categoryText);
  const normalizedName = canonical(input.name);
  const categoryTokens = tokenSet(categoryText);
  const nameTokens = tokenSet(input.name);
  const descriptionTokens = tokenSet(`${input.description} ${input.brand}`);
  const terms = templateTerms(template);
  const evidence = new Set<string>();
  let score = 0;
  for (const term of terms) {
    const normalizedTerm = canonical(term);
    if (!normalizedTerm) continue;
    const words = tokenSet(normalizedTerm);
    let termScore = 0;
    for (const word of words) {
      if (categoryTokens.has(word)) termScore += 7;
      if (nameTokens.has(word)) termScore += 3;
      if (descriptionTokens.has(word)) termScore += 1;
    }
    if (
      normalizedCategoryText &&
      containsMeaningfulPhrase(normalizedCategoryText, normalizedTerm)
    )
      termScore += 10;
    if (
      normalizedName &&
      containsMeaningfulPhrase(normalizedName, normalizedTerm)
    )
      termScore += 5;
    if (termScore > 0) evidence.add(term);
    score += termScore;
  }
  return { template, score, evidence: [...evidence].slice(0, 8) };
}

export function inferBulkImportCategory(
  input: CategoryInput,
  confidenceThreshold = 0.72,
): BulkCategoryInference {
  const candidates = PRODUCT_TEMPLATES.filter(
    (template) => template.id !== 'general',
  )
    .map((template) => scoreTemplate(template, input))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.template.label.localeCompare(right.template.label),
    );
  const best = candidates[0];
  const runnerUp = candidates[1];
  const explicitPath = input.sourceCategoryPath.filter(Boolean).slice(0, 5);

  if (explicitPath.length > 0) {
    const matched =
      best && best.score > 0 ? best.template : DEFAULT_PRODUCT_TEMPLATE;
    return {
      templateId: matched.id,
      templateLabel: matched.label,
      categoryPath: explicitPath,
      confidence: best?.score ? 0.98 : 0.9,
      source: 'source',
      evidence: best?.evidence ?? explicitPath,
      runnerUpTemplateId: runnerUp?.score ? runnerUp.template.id : undefined,
      requiresReview: Boolean(matched.complianceNote),
      complianceNote: matched.complianceNote,
    };
  }

  if (!best || best.score <= 0) {
    return {
      templateId: DEFAULT_PRODUCT_TEMPLATE.id,
      templateLabel: DEFAULT_PRODUCT_TEMPLATE.label,
      categoryPath: ['General'],
      confidence: 0,
      source: 'fallback',
      evidence: [],
      requiresReview: true,
    };
  }

  const margin = best.score - (runnerUp?.score ?? 0);
  const confidence = Math.min(
    0.99,
    0.42 +
      (best.score / (best.score + 18)) * 0.48 +
      Math.min(0.09, margin / 100),
  );
  const complianceNote =
    best.template.complianceNote &&
    (confidence >= confidenceThreshold || (best.score >= 15 && margin >= 3))
      ? best.template.complianceNote
      : undefined;
  const requiresReview =
    confidence < confidenceThreshold || margin < 3 || Boolean(complianceNote);
  return {
    templateId: best.template.id,
    templateLabel: best.template.label,
    categoryPath:
      best.template.categoryPath.length > 0
        ? best.template.categoryPath
        : ['General'],
    confidence,
    source: 'inferred',
    evidence: best.evidence,
    runnerUpTemplateId: runnerUp?.template.id,
    requiresReview,
    complianceNote,
  };
}

function splitCategoryPath(value: string): string[] {
  return value
    .split(/\s*(?:>|\/|\||::|›|→)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitImageUrls(value: string): string[] {
  if (!value.trim()) return [];
  if (value.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch {
      // Fall through to delimiter parsing so the original value remains visible.
    }
  }
  return value
    .split(/\s*(?:\n|\||;)\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseInteger(
  raw: string,
  field: BulkImportField,
  context: { sheet: string; rowNumber: number },
  allowNegative: boolean,
): { value: number | null; issues: BulkImportIssue[] } {
  if (!raw.trim()) return { value: null, issues: [] };
  const cleaned = raw.replace(/,/g, '').trim();
  const value = Number(cleaned);
  if (
    !Number.isSafeInteger(value) ||
    (!allowNegative && value < 0) ||
    Math.abs(value) > 10_000_000
  ) {
    return {
      value: null,
      issues: [
        issue({
          severity: 'error',
          code: 'INVALID_INTEGER',
          message: `${raw} is not a supported whole-number ${field}.`,
          field,
          ...context,
        }),
      ],
    };
  }
  return { value, issues: [] };
}

function parseMoney(
  raw: string,
  field: BulkImportField,
  context: { sheet: string; rowNumber: number },
): { value: number | null; issues: BulkImportIssue[] } {
  if (!raw.trim()) return { value: null, issues: [] };
  let value = raw.trim().replace(/[\s$£€¥₹]/g, '');
  if (/^\(.*\)$/.test(value)) value = `-${value.slice(1, -1)}`;
  const lastComma = value.lastIndexOf(',');
  const lastPeriod = value.lastIndexOf('.');
  if (lastComma >= 0 && lastPeriod >= 0) {
    const decimal = lastComma > lastPeriod ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    value = value.replaceAll(thousands, '').replace(decimal, '.');
  } else if (lastComma >= 0) {
    const decimalDigits = value.length - lastComma - 1;
    value =
      decimalDigits === 2 ? value.replace(',', '.') : value.replaceAll(',', '');
  }
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value)) {
    return {
      value: null,
      issues: [
        issue({
          severity: 'error',
          code: 'INVALID_MONEY',
          message: `${raw} is not a supported monetary amount.`,
          field,
          ...context,
        }),
      ],
    };
  }
  const negative = value.startsWith('-');
  const [wholePart, decimalPart = ''] = value.replace('-', '').split('.');
  const cents = Number(wholePart) * 100 + Number(decimalPart.padEnd(2, '0'));
  if (negative || !Number.isSafeInteger(cents) || cents > 100_000_000_000) {
    return {
      value: null,
      issues: [
        issue({
          severity: 'error',
          code: 'INVALID_MONEY',
          message: `${raw} must be a non-negative amount within the supported range.`,
          field,
          ...context,
        }),
      ],
    };
  }
  return { value: cents, issues: [] };
}

function parseStatus(raw: string): BulkImportValues['status'] {
  const value = canonical(raw);
  if (!value) return null;
  if (
    ['active', 'published', 'publish', 'enabled', 'yes', 'true', '1'].includes(
      value,
    )
  ) {
    return 'active';
  }
  if (
    [
      'archived',
      'archive',
      'inactive',
      'disabled',
      'no',
      'false',
      '0',
    ].includes(value)
  ) {
    return 'archived';
  }
  if (['draft', 'unpublished', 'pending'].includes(value)) return 'draft';
  return null;
}

function valueForField(
  cells: BulkCellValue[],
  mappings: BulkColumnMapping[],
  field: BulkImportField,
): string {
  for (const mapping of mappings) {
    if (mapping.field !== field) continue;
    const value = cellText(cells[mapping.index]);
    if (value) return value;
  }
  return '';
}

function rawRecord(
  headers: string[],
  cells: BulkCellValue[],
): Record<string, string> {
  const record: Record<string, string> = {};
  const uses = new Map<string, number>();
  const width = Math.max(headers.length, cells.length);
  for (let index = 0; index < width; index += 1) {
    const base = headers[index] || `Column ${index + 1}`;
    const use = (uses.get(base) ?? 0) + 1;
    uses.set(base, use);
    record[use === 1 ? base : `${base} (${use})`] = cellText(cells[index]);
  }
  return record;
}

function blankValues(): BulkImportValues {
  return {
    parentSku: '',
    sku: '',
    barcode: '',
    name: '',
    description: '',
    brand: '',
    sourceCategoryPath: [],
    priceCents: null,
    compareAtCents: null,
    costCents: null,
    stock: null,
    stockDelta: null,
    lowStockThreshold: null,
    status: null,
    imageUrls: [],
    options: [],
  };
}

function normalizeRow(
  sheet: string,
  rowNumber: number,
  cells: BulkCellValue[],
  header: BulkImportHeader,
  mode: BulkImportMode,
  categoryConfidenceThreshold: number,
  skuPrefix: string,
): BulkImportRow {
  const displayCells = cells.map(cellText);
  const isBlank = displayCells.every((value) => !value);
  const context = { sheet, rowNumber };
  if (isBlank) {
    return {
      id: `${sheet}:${rowNumber}`,
      sheet,
      rowNumber,
      kind: 'blank',
      rawCells: [...cells],
      displayCells,
      rawRecord: rawRecord(header.headers, cells),
      values: blankValues(),
      parentKey: `blank:${sheet}:${rowNumber}`,
      categoryInference: inferBulkImportCategory(
        blankValues(),
        categoryConfidenceThreshold,
      ),
      issues: [],
    };
  }

  const rowIssues: BulkImportIssue[] = [];
  const catalogMode = mode === 'catalog_upsert';
  const ignoredNumber = {
    value: null,
    issues: [] as BulkImportIssue[],
  };
  const categoryPath = catalogMode
    ? header.mappings
        .filter((mapping) => mapping.field === 'categoryPath')
        .flatMap((mapping) => splitCategoryPath(cellText(cells[mapping.index])))
        .filter(Boolean)
        .slice(0, 5)
    : [];
  const priceRaw = catalogMode
    ? valueForField(cells, header.mappings, 'price')
    : '';
  const price = catalogMode
    ? parseMoney(priceRaw, 'price', context)
    : ignoredNumber;
  const compareAt = catalogMode
    ? parseMoney(
        valueForField(cells, header.mappings, 'compareAtPrice'),
        'compareAtPrice',
        context,
      )
    : ignoredNumber;
  const cost = catalogMode
    ? parseMoney(valueForField(cells, header.mappings, 'cost'), 'cost', context)
    : ignoredNumber;
  const stock =
    mode !== 'stock_adjustment'
      ? parseInteger(
          valueForField(cells, header.mappings, 'stock'),
          'stock',
          context,
          false,
        )
      : ignoredNumber;
  const stockDelta =
    mode === 'stock_adjustment'
      ? parseInteger(
          valueForField(cells, header.mappings, 'stockDelta'),
          'stockDelta',
          context,
          true,
        )
      : ignoredNumber;
  const threshold = catalogMode
    ? parseInteger(
        valueForField(cells, header.mappings, 'lowStockThreshold'),
        'lowStockThreshold',
        context,
        false,
      )
    : ignoredNumber;
  rowIssues.push(
    ...price.issues,
    ...compareAt.issues,
    ...cost.issues,
    ...stock.issues,
    ...stockDelta.issues,
    ...threshold.issues,
  );

  const parentSku = catalogMode
    ? prefixSku(
        normalizedSku(valueForField(cells, header.mappings, 'parentSku')),
        skuPrefix,
      )
    : '';
  const sku = prefixSku(
    normalizedSku(valueForField(cells, header.mappings, 'sku')),
    skuPrefix,
  );
  const barcode = catalogMode
    ? valueForField(cells, header.mappings, 'barcode').normalize('NFKC').trim()
    : '';
  const name = catalogMode
    ? valueForField(cells, header.mappings, 'name').trim()
    : '';
  const statusRaw = catalogMode
    ? valueForField(cells, header.mappings, 'status')
    : '';
  const status = parseStatus(statusRaw);
  const imageUrls = catalogMode
    ? header.mappings
        .filter((mapping) => mapping.field === 'imageUrls')
        .flatMap((mapping) => splitImageUrls(cellText(cells[mapping.index])))
    : [];
  const options: BulkImportOptionValue[] = [];
  for (const slot of catalogMode ? ([1, 2, 3] as const) : []) {
    const nameField = `option${slot}Name` as BulkImportField;
    const valueField = `option${slot}Value` as BulkImportField;
    const valueMapping = header.mappings.find(
      (mapping) => mapping.field === valueField,
    );
    const value = valueForField(cells, header.mappings, valueField).trim();
    if (!value) continue;
    const optionName =
      valueForField(cells, header.mappings, nameField).trim() ||
      valueMapping?.optionName ||
      `Option ${slot}`;
    options.push({ name: optionName, value });
  }
  const values: BulkImportValues = {
    parentSku,
    sku,
    barcode,
    name,
    description: valueForField(cells, header.mappings, 'description').trim(),
    brand: valueForField(cells, header.mappings, 'brand').trim(),
    sourceCategoryPath: categoryPath,
    priceCents: catalogMode && !priceRaw ? 0 : price.value,
    compareAtCents: compareAt.value,
    costCents: cost.value,
    stock: stock.value,
    stockDelta: stockDelta.value,
    lowStockThreshold: threshold.value,
    status,
    imageUrls: [...new Set(imageUrls)],
    options,
  };

  if (!sku) {
    rowIssues.push(
      issue({
        severity: 'error',
        code: 'MISSING_SKU',
        message: 'A SKU is required.',
        field: 'sku',
        ...context,
      }),
    );
  } else if (!SKU_PATTERN.test(sku)) {
    rowIssues.push(
      issue({
        severity: 'error',
        code: 'INVALID_SKU',
        message: `${sku} must contain 2–64 letters, numbers, dots, dashes, or underscores.`,
        field: 'sku',
        ...context,
      }),
    );
  }
  if (mode === 'catalog_upsert' && !name) {
    rowIssues.push(
      issue({
        severity: 'warning',
        code: 'MISSING_NAME',
        message:
          'This row needs a product name or must inherit one from its explicit parent group.',
        field: 'name',
        ...context,
      }),
    );
  }
  if (statusRaw && !status) {
    rowIssues.push(
      issue({
        severity: 'error',
        code: 'INVALID_STATUS',
        message: `${statusRaw} is not a supported product status.`,
        field: 'status',
        ...context,
      }),
    );
  }
  if (mode === 'stock_adjustment' && stockDelta.value == null) {
    rowIssues.push(
      issue({
        severity: 'error',
        code: 'MISSING_STOCK_DELTA',
        message: 'Stock-adjustment imports require a quantity-change column.',
        field: 'stockDelta',
        ...context,
      }),
    );
  }
  if (mode === 'stock_snapshot' && stock.value == null) {
    rowIssues.push(
      issue({
        severity: 'error',
        code: 'MISSING_STOCK',
        message: 'Stock-snapshot imports require an on-hand stock column.',
        field: 'stock',
        ...context,
      }),
    );
  }
  for (const imageUrl of values.imageUrls) {
    if (!imageUrl.startsWith('https://') || imageUrl.length > 2_000) {
      rowIssues.push(
        issue({
          severity: 'error',
          code: 'INVALID_IMAGE_URL',
          message: `${imageUrl} must be an HTTPS image URL no longer than 2,000 characters.`,
          field: 'imageUrls',
          ...context,
        }),
      );
    }
  }
  const barcodeMapping = header.mappings.find(
    (mapping) => mapping.field === 'barcode',
  );
  if (
    catalogMode &&
    barcodeMapping &&
    typeof cells[barcodeMapping.index] === 'number'
  ) {
    rowIssues.push(
      issue({
        severity: 'warning',
        code: 'NUMERIC_BARCODE',
        message:
          'This spreadsheet stored the barcode as a number; verify that leading zeros were not removed.',
        field: 'barcode',
        ...context,
      }),
    );
  }

  const categoryInference = inferBulkImportCategory(
    values,
    categoryConfidenceThreshold,
  );
  if (
    mode === 'catalog_upsert' &&
    categoryInference.requiresReview &&
    categoryInference.complianceNote
  ) {
    rowIssues.push(
      issue({
        severity: 'warning',
        code: 'REGULATED_CATEGORY_REVIEW',
        message: categoryInference.complianceNote,
        field: 'categoryPath',
        ...context,
      }),
    );
  }
  const parentKey =
    mode === 'catalog_upsert' && parentSku
      ? `parent:${canonical(parentSku)}`
      : sku
        ? `sku:${canonical(sku)}`
        : `row:${sheet}:${rowNumber}`;
  return {
    id: `${sheet}:${rowNumber}`,
    sheet,
    rowNumber,
    kind: 'data',
    rawCells: [...cells],
    displayCells,
    rawRecord: rawRecord(header.headers, cells),
    values,
    parentKey,
    categoryInference,
    issues: rowIssues,
  };
}

function inferredFamilyKey(row: BulkImportRow): string {
  const values = row.values;
  if (!values.name.trim() || values.options.length === 0) return '';
  const categoryPath = values.sourceCategoryPath.length
    ? values.sourceCategoryPath
    : row.categoryInference.categoryPath;
  return [
    canonical(values.name),
    canonical(values.brand),
    categoryPath.map(canonical).join('/'),
  ].join('|');
}

function inheritProductFamilyRows(
  rows: BulkImportRow[],
  categoryConfidenceThreshold: number,
): void {
  const lastFamilyBySheet = new Map<
    string,
    { key: string; parentSku: string; signature: string; rowNumber: number }
  >();

  for (const row of rows) {
    if (row.kind === 'blank') {
      lastFamilyBySheet.delete(row.sheet);
      continue;
    }

    const explicitParent = Boolean(row.values.parentSku);
    const inferredKey = inferredFamilyKey(row);
    const previous = lastFamilyBySheet.get(row.sheet);
    const contiguous = previous?.rowNumber === row.rowNumber - 1;
    if (explicitParent) {
      row.parentKey = `parent:${canonical(row.values.parentSku)}`;
    } else if (
      row.values.options.length > 0 &&
      previous &&
      contiguous &&
      (!inferredKey || inferredKey === previous.signature)
    ) {
      row.parentKey = previous.key;
      row.values.parentSku = previous.parentSku;
    } else if (inferredKey) {
      row.parentKey = `inferred:${canonical(row.sheet)}:${row.rowNumber}:${inferredKey}`;
    }

    if (
      row.values.options.length > 0 &&
      (explicitParent ||
        inferredKey ||
        row.parentKey.startsWith('inferred:') ||
        (previous && contiguous))
    ) {
      lastFamilyBySheet.set(row.sheet, {
        key: row.parentKey,
        parentSku: row.values.parentSku,
        signature: inferredKey || previous?.signature || '',
        rowNumber: row.rowNumber,
      });
    } else if (row.values.options.length === 0) {
      lastFamilyBySheet.delete(row.sheet);
    }
  }

  const grouped = new Map<string, BulkImportRow[]>();
  for (const row of rows) {
    if (row.kind !== 'data') continue;
    const group = grouped.get(row.parentKey) ?? [];
    group.push(row);
    grouped.set(row.parentKey, group);
  }

  for (const [key, groupRows] of grouped) {
    if (
      groupRows.length < 2 &&
      !key.startsWith('parent:') &&
      !key.startsWith('inferred:')
    ) {
      continue;
    }
    const firstText = (field: 'name' | 'description' | 'brand') =>
      groupRows.find((candidate) => candidate.values[field].trim())?.values[
        field
      ] ?? '';
    const name = firstText('name');
    const description = firstText('description');
    const brand = firstText('brand');
    const sourceCategoryPath =
      groupRows.find(
        (candidate) => candidate.values.sourceCategoryPath.length > 0,
      )?.values.sourceCategoryPath ?? [];
    const status =
      groupRows.find((candidate) => candidate.values.status != null)?.values
        .status ?? null;
    const imageUrls =
      groupRows.find((candidate) => candidate.values.imageUrls.length > 0)
        ?.values.imageUrls ?? [];
    const parentSku =
      groupRows.find((candidate) => candidate.values.parentSku)?.values
        .parentSku ?? '';

    for (const row of groupRows) {
      if (!row.values.name) row.values.name = name;
      if (!row.values.description) row.values.description = description;
      if (!row.values.brand) row.values.brand = brand;
      if (row.values.sourceCategoryPath.length === 0) {
        row.values.sourceCategoryPath = [...sourceCategoryPath];
      }
      if (row.values.status == null) row.values.status = status;
      if (row.values.imageUrls.length === 0) {
        row.values.imageUrls = [...imageUrls];
      }
      if (!row.values.parentSku && parentSku) {
        row.values.parentSku = parentSku;
      }
      row.issues = row.issues.filter(
        (candidate) =>
          ![
            'MISSING_NAME',
            'CATEGORY_REVIEW_REQUIRED',
            'REGULATED_CATEGORY_REVIEW',
          ].includes(candidate.code),
      );
      row.categoryInference = inferBulkImportCategory(
        row.values,
        categoryConfidenceThreshold,
      );
      if (
        row.categoryInference.requiresReview &&
        row.categoryInference.complianceNote
      ) {
        row.issues.push(
          issue({
            severity: 'warning',
            code: 'REGULATED_CATEGORY_REVIEW',
            message: row.categoryInference.complianceNote,
            field: 'categoryPath',
            sheet: row.sheet,
            rowNumber: row.rowNumber,
          }),
        );
      }
    }
  }
}

function valuesDiffer(values: string[]): boolean {
  return new Set(values.map(canonical).filter(Boolean)).size > 1;
}

export function groupBulkImportRows(
  rows: BulkImportRow[],
  mode: BulkImportMode = 'catalog_upsert',
): BulkProductGroup[] {
  const grouped = new Map<string, BulkImportRow[]>();
  for (const row of rows) {
    if (row.kind !== 'data') continue;
    const group = grouped.get(row.parentKey) ?? [];
    group.push(row);
    grouped.set(row.parentKey, group);
  }

  return [...grouped.entries()].map(([key, groupRows]) => {
    const first = groupRows[0];
    const groupIssues: BulkImportIssue[] = [];
    const parentSku = first.values.parentSku || first.values.sku;
    const explicitParent = Boolean(first.values.parentSku);
    const name = groupRows.find((row) => row.values.name)?.values.name ?? '';
    const variantSkus = groupRows.map((row) => row.values.sku).filter(Boolean);
    const skuCounts = new Map<string, number>();
    for (const sku of variantSkus)
      skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1);
    const duplicateSkus = [...skuCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([sku]) => sku);
    if (duplicateSkus.length > 0) {
      groupIssues.push(
        issue({
          severity: 'error',
          code: 'DUPLICATE_VARIANT_SKU',
          message: `Duplicate variant SKU${duplicateSkus.length === 1 ? '' : 's'}: ${duplicateSkus.join(', ')}.`,
          scope: 'group',
          groupKey: key,
        }),
      );
    }
    if (
      mode === 'catalog_upsert' &&
      explicitParent &&
      groupRows.some((row) => row.values.sku === parentSku)
    ) {
      groupIssues.push(
        issue({
          severity: 'error',
          code: 'PARENT_VARIANT_SKU_CONFLICT',
          message: `Parent SKU ${parentSku} must differ from every child SKU.`,
          scope: 'group',
          groupKey: key,
        }),
      );
    }
    if (mode === 'catalog_upsert' && groupRows.length > 100) {
      groupIssues.push(
        issue({
          severity: 'error',
          code: 'TOO_MANY_VARIANTS',
          message: 'A product can contain at most 100 imported variants.',
          scope: 'group',
          groupKey: key,
        }),
      );
    }
    if (
      mode === 'catalog_upsert' &&
      key.startsWith('inferred:') &&
      groupRows.length > 1
    ) {
      groupIssues.push(
        issue({
          severity: 'warning',
          code: 'INFERRED_PRODUCT_FAMILY',
          message:
            'These child rows were grouped automatically from their shared name, brand, category, and option columns. Review the family before applying.',
          scope: 'group',
          groupKey: key,
        }),
      );
    }
    const optionNames = new Set(
      groupRows.flatMap((row) =>
        row.values.options.map((option) => canonical(option.name)),
      ),
    );
    if (mode === 'catalog_upsert' && optionNames.size > 3) {
      groupIssues.push(
        issue({
          severity: 'error',
          code: 'TOO_MANY_OPTIONS',
          message: 'A product can use at most three option dimensions.',
          scope: 'group',
          groupKey: key,
        }),
      );
    }
    if (
      mode === 'catalog_upsert' &&
      groupRows.length > 1 &&
      groupRows.some((row) => row.values.options.length === 0)
    ) {
      groupIssues.push(
        issue({
          severity: 'warning',
          code: 'VARIANT_OPTIONS_MISSING',
          message:
            'Some child SKUs have no option values; review how these variants should be labeled.',
          scope: 'group',
          groupKey: key,
        }),
      );
    }
    if (
      mode === 'catalog_upsert' &&
      valuesDiffer(groupRows.map((row) => row.values.name))
    ) {
      groupIssues.push(
        issue({
          severity: 'warning',
          code: 'INCONSISTENT_PRODUCT_NAME',
          message:
            'Child rows contain different product names; the first non-empty name will be used.',
          scope: 'group',
          groupKey: key,
        }),
      );
    }
    if (
      mode === 'catalog_upsert' &&
      valuesDiffer(
        groupRows.map((row) =>
          row.categoryInference.categoryPath.map(canonical).join('/'),
        ),
      )
    ) {
      groupIssues.push(
        issue({
          severity: 'warning',
          code: 'INCONSISTENT_CATEGORY',
          message:
            'Child rows resolve to different categories; choose one category for the parent product.',
          scope: 'group',
          groupKey: key,
        }),
      );
    }
    if (mode === 'catalog_upsert' && !name) {
      groupIssues.push(
        issue({
          severity: 'error',
          code: 'GROUP_NAME_REQUIRED',
          message: 'The product group does not contain a product name.',
          scope: 'group',
          groupKey: key,
        }),
      );
    }
    const categoryInference = [...groupRows].sort(
      (left, right) =>
        right.categoryInference.confidence - left.categoryInference.confidence,
    )[0].categoryInference;
    const allIssues = [
      ...groupRows.flatMap((row) => row.issues),
      ...groupIssues,
    ];
    const requiresCategoryReview =
      mode === 'catalog_upsert' &&
      groupRows.some((row) => row.categoryInference.requiresReview);
    return {
      key,
      parentSku,
      name: name || first.values.sku || 'Inventory item',
      explicitParent,
      rows: groupRows,
      variantSkus,
      categoryInference,
      status: allIssues.some((candidate) => candidate.severity === 'error')
        ? 'error'
        : requiresCategoryReview ||
            allIssues.some((candidate) => candidate.severity === 'warning')
          ? 'review'
          : 'ready',
      issues: groupIssues,
    };
  });
}

function applyMappingOverrides(
  header: BulkImportHeader,
  overrides: Record<string, BulkImportField | 'ignore'> | undefined,
  sheet: string,
  rows: BulkCellValue[][],
): BulkImportHeader {
  if (!overrides) return header;
  const overriddenMappings = header.mappings.map((mapping) => {
    const override =
      overrides[String(mapping.index)] ??
      overrides[mapping.header] ??
      overrides[canonical(mapping.header)];
    return override
      ? {
          ...mapping,
          field: override,
          confidence: 1,
          source: 'override' as const,
          optionName:
            override.endsWith('Value') && mapping.optionName == null
              ? mapping.header
              : mapping.optionName,
        }
      : mapping;
  });
  const mappings = collapseEquivalentDuplicateMappings(
    overriddenMappings,
    rows.slice(header.rowNumber),
  );
  if (header.issues.some((candidate) => candidate.code === 'EMPTY_SHEET')) {
    return { ...header, mappings };
  }
  return {
    ...header,
    mappings,
    ...headerDiagnostics(header.headers, mappings, sheet, header.rowNumber),
  };
}

function normalizeJsonValue(value: unknown): BulkCellValue {
  if (value == null) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (
    Array.isArray(value) &&
    value.every((item) => typeof item !== 'object' || item == null)
  ) {
    return value.map(String).join(' | ');
  }
  return JSON.stringify(value);
}

function flattenVariantOptions(
  target: Record<string, unknown>,
  options: unknown,
): void {
  if (Array.isArray(options)) {
    options.slice(0, 3).forEach((entry, index) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const option = entry as Record<string, unknown>;
        target[`Option ${index + 1} Name`] =
          option.name ?? `Option ${index + 1}`;
        target[`Option ${index + 1} Value`] = option.value ?? '';
      }
    });
    return;
  }
  if (options && typeof options === 'object') {
    Object.entries(options as Record<string, unknown>)
      .slice(0, 3)
      .forEach(([name, value]) => {
        target[name] = value;
      });
  }
}

function flattenJsonProducts(records: unknown[]): Record<string, unknown>[] {
  const flattened: Record<string, unknown>[] = [];
  for (const rawRecord of records) {
    if (
      !rawRecord ||
      typeof rawRecord !== 'object' ||
      Array.isArray(rawRecord)
    ) {
      flattened.push({ value: rawRecord });
      continue;
    }
    const record = rawRecord as Record<string, unknown>;
    const variants = Array.isArray(record.variants) ? record.variants : null;
    if (!variants || variants.length === 0) {
      const copy = { ...record };
      flattenVariantOptions(copy, copy.options);
      delete copy.options;
      flattened.push(copy);
      continue;
    }
    const parentSku =
      record.parentSku ??
      record.parent_sku ??
      record.sku ??
      record.handle ??
      '';
    for (const rawVariant of variants) {
      const variant: Record<string, unknown> =
        rawVariant &&
        typeof rawVariant === 'object' &&
        !Array.isArray(rawVariant)
          ? (rawVariant as Record<string, unknown>)
          : { value: rawVariant };
      const copy: Record<string, unknown> = {
        ...record,
        ...variant,
        'Parent SKU': parentSku,
      };
      delete copy.variants;
      flattenVariantOptions(copy, variant.options ?? record.options);
      delete copy.options;
      flattened.push(copy);
    }
  }
  return flattened;
}

function recordsToMatrix(
  records: Record<string, unknown>[],
): BulkCellValue[][] {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (seen.has(key)) continue;
      seen.add(key);
      headers.push(key);
    }
  }
  return [
    headers,
    ...records.map((record) =>
      headers.map((header) => normalizeJsonValue(record[header])),
    ),
  ];
}

function jsonMatrices(text: string): SheetMatrix[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown;
  } catch {
    throw new BulkImportParseError(
      'INVALID_JSON',
      'The selected file is not valid JSON.',
    );
  }
  const root =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const payload = root && Array.isArray(root.products) ? root.products : parsed;
  if (!Array.isArray(payload)) {
    throw new BulkImportParseError(
      'INVALID_JSON_SHAPE',
      'JSON imports must be an array or an object with a products array.',
    );
  }
  if (payload.every((row) => Array.isArray(row))) {
    return [
      {
        name: 'JSON',
        rows: (payload as unknown[][]).map((row) =>
          row.map(normalizeJsonValue),
        ),
      },
    ];
  }
  return [
    { name: 'JSON', rows: recordsToMatrix(flattenJsonProducts(payload)) },
  ];
}

async function inputText(input: Blob | ArrayBuffer | string): Promise<string> {
  if (typeof input === 'string') return input;
  if (input instanceof ArrayBuffer) return new TextDecoder().decode(input);
  return input.text();
}

function inputName(
  input: Blob | ArrayBuffer | string,
  options: BulkImportParseOptions,
): string {
  if (options.fileName?.trim()) return options.fileName.trim();
  const candidate = input as { name?: unknown };
  return typeof candidate.name === 'string' && candidate.name.trim()
    ? candidate.name.trim()
    : 'inventory-import';
}

async function detectFormat(
  input: Blob | ArrayBuffer | string,
  fileName: string,
  explicit?: BulkImportFormat,
): Promise<BulkImportFormat> {
  if (explicit) return explicit;
  const extension = fileName.toLowerCase().split('.').pop();
  if (extension === 'xlsx') return 'xlsx';
  if (extension === 'json') return 'json';
  if (extension === 'tsv' || extension === 'tab') return 'tsv';
  if (extension === 'csv') return 'csv';
  if (extension === 'xls') {
    throw new BulkImportParseError(
      'LEGACY_XLS_UNSUPPORTED',
      'Legacy .xls files must be saved as .xlsx, CSV, TSV, or JSON before import.',
    );
  }
  if (typeof input !== 'string') {
    const bytes = new Uint8Array(
      input instanceof ArrayBuffer
        ? input.slice(0, 4)
        : await input.slice(0, 4).arrayBuffer(),
    );
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'xlsx';
  }
  const text = await inputText(input);
  const first = text.replace(/^\uFEFF/, '').trimStart()[0];
  if (first === '[' || first === '{') return 'json';
  return detectCsvDelimiter(text) === '\t' ? 'tsv' : 'csv';
}

async function matricesForInput(
  input: Blob | ArrayBuffer | string,
  format: BulkImportFormat,
): Promise<SheetMatrix[]> {
  if (format === 'xlsx') {
    if (typeof input === 'string') {
      throw new BulkImportParseError(
        'INVALID_XLSX_INPUT',
        'XLSX imports require a file or ArrayBuffer.',
      );
    }
    try {
      const sheets = await readXlsxFile(input);
      return sheets.map((sheet) => ({
        name: sheet.sheet,
        rows: sheet.data as unknown as BulkCellValue[][],
      }));
    } catch (error) {
      throw new BulkImportParseError(
        'INVALID_XLSX',
        error instanceof Error
          ? error.message
          : 'The selected XLSX workbook could not be read.',
      );
    }
  }
  const text = await inputText(input);
  if (format === 'json') return jsonMatrices(text);
  const delimiter = format === 'tsv' ? '\t' : detectCsvDelimiter(text);
  return [
    { name: format.toUpperCase(), rows: parseDelimitedText(text, delimiter) },
  ];
}

function skuCollisionIdentitySignature(row: BulkImportRow): string {
  const values = row.values;
  return JSON.stringify({
    parentSku: canonical(values.parentSku),
    barcode: canonical(values.barcode),
    name: canonical(values.name),
    brand: canonical(values.brand),
    sourceCategoryPath: values.sourceCategoryPath.map(canonical),
    options: values.options.map((option) => ({
      name: canonical(option.name),
      value: canonical(option.value),
    })),
  });
}

function stableSkuNamespaceToken(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(-6);
}

function sanitizedSheetSkuPrefix(sheet: string): string {
  const prefix = canonical(sheet)
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/^[^A-Z0-9]+|[-_.]+$/g, '')
    .slice(0, 24)
    .replace(/[-_.]+$/g, '');
  return prefix || `SHEET-${stableSkuNamespaceToken(sheet)}`;
}

function compareSkuNamespaceText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function generatedSheetSkuPrefixes(
  sheets: Iterable<string>,
): Map<string, string> {
  const uniqueSheets = [...new Set(sheets)].sort(compareSkuNamespaceText);
  const byBase = new Map<string, string[]>();
  for (const sheet of uniqueSheets) {
    const base = sanitizedSheetSkuPrefix(sheet);
    const matches = byBase.get(base) ?? [];
    matches.push(sheet);
    byBase.set(base, matches);
  }
  const prefixes = new Map<string, string>();
  for (const [base, matches] of byBase) {
    for (const sheet of matches) {
      prefixes.set(
        sheet,
        matches.length === 1
          ? base
          : `${base.slice(0, 17).replace(/[-_.]+$/g, '')}-${stableSkuNamespaceToken(sheet)}`,
      );
    }
  }
  return prefixes;
}

function fittedSkuNamespace(
  sku: string,
  prefix: string,
  salt: string,
  reserved: Set<string>,
): string | null {
  const maximumPrefixLength = 63 - sku.length;
  if (maximumPrefixLength < 1) return null;
  const fit = (value: string) =>
    value.slice(0, maximumPrefixLength).replace(/[-_.]+$/g, '');
  const candidatePrefix = fit(prefix);
  if (!candidatePrefix) return null;
  const candidate = `${candidatePrefix}-${sku}`;
  if (!reserved.has(candidate)) return candidate;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = stableSkuNamespaceToken(`${salt}:${attempt}`).slice(
      0,
      Math.min(6, maximumPrefixLength),
    );
    const baseLength = maximumPrefixLength - suffix.length - 1;
    const disambiguatedPrefix =
      baseLength > 0
        ? `${prefix.slice(0, baseLength).replace(/[-_.]+$/g, '')}-${suffix}`
        : suffix;
    if (!disambiguatedPrefix) continue;
    const disambiguated = `${disambiguatedPrefix}-${sku}`;
    if (!reserved.has(disambiguated)) return disambiguated;
  }
  return null;
}

function autoResolveCrossSheetSkuCollisions(
  rows: BulkImportRow[],
  explicitlyPrefixedSheets: ReadonlySet<string>,
): void {
  const bySku = new Map<string, BulkImportRow[]>();
  for (const row of rows) {
    if (row.kind !== 'data' || !row.values.sku) continue;
    const matches = bySku.get(row.values.sku) ?? [];
    matches.push(row);
    bySku.set(row.values.sku, matches);
  }

  const renameGroups = new Map<
    string,
    { sourceSku: string; sheet: string; rows: BulkImportRow[] }
  >();
  for (const [sourceSku, matches] of bySku) {
    if (new Set(matches.map((row) => row.sheet)).size < 2) continue;

    const bySignature = new Map<string, BulkImportRow[]>();
    for (const row of matches) {
      const signature = skuCollisionIdentitySignature(row);
      const identical = bySignature.get(signature) ?? [];
      identical.push(row);
      bySignature.set(signature, identical);
    }
    const exactDuplicateRows = new Set(
      [...bySignature.values()]
        .filter(
          (identical) => new Set(identical.map((row) => row.sheet)).size > 1,
        )
        .flatMap((identical) => identical),
    );

    for (const row of matches) {
      // A child with an explicit parent can only be renamed safely by
      // namespacing its entire family. Leave that collision visible instead of
      // splitting the family across parent keys.
      if (
        exactDuplicateRows.has(row) ||
        explicitlyPrefixedSheets.has(row.sheet) ||
        row.values.parentSku
      ) {
        continue;
      }
      const key = `${sourceSku}\u0000${row.sheet}`;
      const group = renameGroups.get(key) ?? {
        sourceSku,
        sheet: row.sheet,
        rows: [],
      };
      group.rows.push(row);
      renameGroups.set(key, group);
    }
  }

  const rowsToRename = new Set(
    [...renameGroups.values()].flatMap((group) => group.rows),
  );
  const reservedSkus = new Set(
    rows
      .filter(
        (row) =>
          row.kind === 'data' && row.values.sku && !rowsToRename.has(row),
      )
      .map((row) => row.values.sku),
  );
  const prefixes = generatedSheetSkuPrefixes(
    [...renameGroups.values()].map((group) => group.sheet),
  );
  const orderedGroups = [...renameGroups.values()].sort(
    (left, right) =>
      compareSkuNamespaceText(left.sourceSku, right.sourceSku) ||
      compareSkuNamespaceText(left.sheet, right.sheet),
  );

  for (const group of orderedGroups) {
    const prefix = prefixes.get(group.sheet);
    if (!prefix) continue;
    const namespaced = fittedSkuNamespace(
      group.sourceSku,
      prefix,
      `${group.sheet}:${group.sourceSku}`,
      reservedSkus,
    );
    if (!namespaced) {
      for (const row of group.rows) {
        row.issues.push(
          issue({
            severity: 'error',
            code: 'SKU_NAMESPACE_TOO_LONG',
            message: `SKU ${group.sourceSku} is too long to add the ${prefix} sheet namespace safely.`,
            field: 'sku',
            sheet: row.sheet,
            rowNumber: row.rowNumber,
          }),
        );
      }
      continue;
    }
    reservedSkus.add(namespaced);
    for (const row of group.rows) {
      row.values.sku = namespaced;
      row.parentKey = row.values.parentSku
        ? `parent:${canonical(row.values.parentSku)}`
        : `sku:${canonical(row.values.sku)}`;
      row.issues.push(
        issue({
          severity: 'warning',
          code: 'SKU_NAMESPACED_BY_SHEET',
          message: `SKU ${group.sourceSku} was changed to ${namespaced} because another sheet uses the same ID for a different product. Use an explicit sheet prefix if this file must match an existing plain SKU.`,
          field: 'sku',
          sheet: row.sheet,
          rowNumber: row.rowNumber,
        }),
      );
    }
  }
}

function duplicateSkuIssues(rows: BulkImportRow[]): void {
  const bySku = new Map<string, BulkImportRow[]>();
  for (const row of rows) {
    if (row.kind !== 'data' || !row.values.sku) continue;
    const matches = bySku.get(row.values.sku) ?? [];
    matches.push(row);
    bySku.set(row.values.sku, matches);
  }
  for (const [sku, matches] of bySku) {
    if (matches.length <= 1) continue;
    const parentKeys = new Set(matches.map((row) => row.parentKey));
    if (parentKeys.size === 1) continue;
    for (const row of matches) {
      row.issues.push(
        issue({
          severity: 'error',
          code: 'DUPLICATE_FILE_SKU',
          message: `SKU ${sku} appears in more than one product group.`,
          field: 'sku',
          sheet: row.sheet,
          rowNumber: row.rowNumber,
        }),
      );
    }
  }
}

function summarize(
  sheets: BulkImportSheet[],
  rows: BulkImportRow[],
  groups: BulkProductGroup[],
): BulkImportPreviewSummary {
  const dataRows = rows.filter((row) => row.kind === 'data');
  const groupByRow = new Map(
    groups.flatMap((group) =>
      group.rows.map((row) => [row.id, group] as const),
    ),
  );
  const errorRows = dataRows.filter(
    (row) =>
      row.issues.some((item) => item.severity === 'error') ||
      groupByRow.get(row.id)?.status === 'error',
  );
  const errorRowIds = new Set(errorRows.map((row) => row.id));
  const warningRows = dataRows.filter(
    (row) =>
      !errorRowIds.has(row.id) &&
      (row.issues.some((item) => item.severity === 'warning') ||
        groupByRow.get(row.id)?.status === 'review'),
  );
  return {
    sheetCount: sheets.length,
    physicalRows: sheets.reduce(
      (count, sheet) => count + sheet.sourceRows.length,
      0,
    ),
    headerRows: sheets.length,
    preambleRows: sheets.reduce(
      (count, sheet) =>
        count +
        sheet.sourceRows.filter((row) => row.kind === 'preamble').length,
      0,
    ),
    blankRows: rows.filter((row) => row.kind === 'blank').length,
    dataRows: dataRows.length,
    validRows: dataRows.length - errorRows.length,
    warningRows: warningRows.length,
    errorRows: errorRows.length,
    productGroups: groups.length,
    variantRows: groups.reduce((count, group) => count + group.rows.length, 0),
    inferredCategoryRows: dataRows.filter(
      (row) => row.categoryInference.source === 'inferred',
    ).length,
    reviewRequiredGroups: groups.filter((group) => group.status === 'review')
      .length,
  };
}

export async function parseBulkImport(
  input: Blob | ArrayBuffer | string,
  options: BulkImportParseOptions = {},
): Promise<BulkImportPreview> {
  const fileName = inputName(input, options);
  const format = await detectFormat(input, fileName, options.format);
  const matrices = await matricesForInput(input, format);
  const selectedSheets = options.sheetNames
    ? matrices.filter((sheet) => options.sheetNames?.includes(sheet.name))
    : matrices;
  if (selectedSheets.length === 0) {
    throw new BulkImportParseError(
      'NO_SHEETS_SELECTED',
      'No workbook sheets were selected for import.',
    );
  }

  const previewSheets: BulkImportSheet[] = [];
  const normalizedRows: BulkImportRow[] = [];
  const explicitlyPrefixedSheets = new Set<string>();
  const threshold = Math.max(
    0,
    Math.min(1, options.categoryConfidenceThreshold ?? 0.72),
  );
  const mode = options.mode ?? 'catalog_upsert';
  for (const matrix of selectedSheets) {
    let header = detectBulkImportHeader(
      matrix.rows,
      matrix.name,
      options.headerRowBySheet?.[matrix.name],
    );
    header = applyMappingOverrides(
      header,
      options.columnMappingsBySheet?.[matrix.name],
      matrix.name,
      matrix.rows,
    );
    const skuPrefix = normalizedSkuPrefix(
      options.skuPrefixBySheet?.[matrix.name],
      matrix.name,
    );
    if (skuPrefix) explicitlyPrefixedSheets.add(matrix.name);
    const sourceRows: BulkImportSourceRow[] = matrix.rows.map(
      (cells, index) => {
        const rowNumber = index + 1;
        const displayCells = cells.map(cellText);
        const blank = displayCells.every((value) => !value);
        return {
          rowNumber,
          cells: [...cells],
          displayCells,
          kind:
            rowNumber < header.rowNumber
              ? 'preamble'
              : rowNumber === header.rowNumber
                ? 'header'
                : blank
                  ? 'blank'
                  : 'data',
        };
      },
    );
    for (let index = header.rowNumber; index < matrix.rows.length; index += 1) {
      normalizedRows.push(
        normalizeRow(
          matrix.name,
          index + 1,
          matrix.rows[index],
          header,
          mode,
          threshold,
          skuPrefix,
        ),
      );
    }
    previewSheets.push({
      name: matrix.name,
      header,
      sourceRows,
      issues: header.issues,
    });
  }

  if (options.autoResolveCrossSheetSkuCollisions) {
    autoResolveCrossSheetSkuCollisions(
      normalizedRows,
      explicitlyPrefixedSheets,
    );
  }
  if (mode === 'catalog_upsert') {
    inheritProductFamilyRows(normalizedRows, threshold);
  }
  duplicateSkuIssues(normalizedRows);
  const groups = groupBulkImportRows(normalizedRows, mode);
  const issues = [
    ...previewSheets.flatMap((sheet) => sheet.issues),
    ...normalizedRows.flatMap((row) => row.issues),
    ...groups.flatMap((group) => group.issues),
  ];
  return {
    format,
    fileName,
    sheets: previewSheets,
    rows: normalizedRows,
    groups,
    issues,
    summary: summarize(previewSheets, normalizedRows, groups),
  };
}
