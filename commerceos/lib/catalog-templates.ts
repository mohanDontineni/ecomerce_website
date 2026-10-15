export const PRODUCT_TEMPLATE_GROUPS = [
  { id: 'general', label: 'General & custom' },
  { id: 'fashion', label: 'Fashion & accessories' },
  { id: 'electronics', label: 'Electronics & computing' },
  { id: 'home', label: 'Home, garden & tools' },
  { id: 'essentials', label: 'Food, health & everyday essentials' },
  { id: 'lifestyle', label: 'Lifestyle & recreation' },
  { id: 'media', label: 'Media, office & digital' },
  { id: 'commercial', label: 'Automotive & commercial' },
] as const;

export type ProductTemplateGroupId =
  (typeof PRODUCT_TEMPLATE_GROUPS)[number]['id'];

type ProductTemplateOption = {
  name: string;
  values: string;
};

type ProductTemplateAttribute = {
  groupName: string;
  name: string;
};

export type ProductTemplate = {
  id: string;
  groupId: ProductTemplateGroupId;
  label: string;
  description: string;
  categoryPath: string[];
  options: ProductTemplateOption[];
  attributes: ProductTemplateAttribute[];
  complianceNote?: string;
};

function option(name: string, values = ''): ProductTemplateOption {
  return { name, values };
}

function attributes(
  ...items: Array<readonly [groupName: string, name: string]>
): ProductTemplateAttribute[] {
  return items.map(([groupName, name]) => ({ groupName, name }));
}

function withBrand(
  ...items: Array<readonly [groupName: string, name: string]>
): ProductTemplateAttribute[] {
  return [{ groupName: 'Overview', name: 'Brand' }, ...attributes(...items)];
}

export const PRODUCT_TEMPLATES: ProductTemplate[] = [
  {
    id: 'general',
    groupId: 'general',
    label: 'General retail / custom product',
    description:
      'A neutral starting point for any physical product or a custom taxonomy.',
    categoryPath: [],
    options: [],
    attributes: withBrand(
      ['Details', 'Model'],
      ['Details', 'Manufacturer'],
      ['Details', 'Country of origin'],
    ),
  },
  {
    id: 'handmade-custom',
    groupId: 'general',
    label: 'Handmade & artisan goods',
    description:
      'For artisan, small-batch, handcrafted, and made-to-order products.',
    categoryPath: ['Handmade', 'Artisan goods', 'Handcrafted products'],
    options: [option('Style'), option('Color'), option('Size')],
    attributes: withBrand(
      ['Craft details', 'Maker'],
      ['Craft details', 'Materials'],
      ['Craft details', 'Made-to-order notes'],
      ['Fulfillment', 'Production time'],
    ),
  },

  {
    id: 'apparel',
    groupId: 'fashion',
    label: 'Clothing & apparel',
    description:
      'Garments with size, color, material, fit, and care information.',
    categoryPath: ['Fashion', 'Clothing', 'Apparel'],
    options: [
      option('Size', 'XS, S, M, L, XL'),
      option('Color'),
      option('Material'),
    ],
    attributes: withBrand(
      ['Product details', 'Material'],
      ['Product details', 'Fit'],
      ['Product details', 'Gender / department'],
      ['Care', 'Care instructions'],
    ),
  },
  {
    id: 'footwear',
    groupId: 'fashion',
    label: 'Shoes & footwear',
    description:
      'Shoes, boots, sandals, and athletic footwear with size and width variants.',
    categoryPath: ['Fashion', 'Shoes', 'Footwear'],
    options: [
      option('Size'),
      option('Color'),
      option('Width', 'Regular, Wide'),
    ],
    attributes: withBrand(
      ['Construction', 'Upper material'],
      ['Construction', 'Sole material'],
      ['Product details', 'Closure'],
      ['Product details', 'Fit notes'],
    ),
  },
  {
    id: 'jewelry',
    groupId: 'fashion',
    label: 'Jewelry',
    description:
      'Fine and fashion jewelry with metal, size, gemstone, and measurement details.',
    categoryPath: ['Fashion', 'Jewelry', 'Fine & fashion jewelry'],
    options: [
      option('Metal', 'Gold, Silver, Platinum'),
      option('Size'),
      option('Stone'),
    ],
    attributes: withBrand(
      ['Materials', 'Metal'],
      ['Materials', 'Purity'],
      ['Materials', 'Gemstone'],
      ['Measurements', 'Item weight'],
      ['Care', 'Care instructions'],
    ),
  },
  {
    id: 'watches',
    groupId: 'fashion',
    label: 'Watches',
    description:
      'Traditional, fashion, and smart watches with case and band details.',
    categoryPath: ['Fashion', 'Watches', 'Wristwatches'],
    options: [
      option('Band color'),
      option('Case size'),
      option('Band material'),
    ],
    attributes: withBrand(
      ['Watch details', 'Movement'],
      ['Watch details', 'Display type'],
      ['Watch details', 'Water resistance'],
      ['Measurements', 'Case diameter'],
      ['Warranty', 'Warranty'],
    ),
  },
  {
    id: 'bags-luggage',
    groupId: 'fashion',
    label: 'Bags, wallets & luggage',
    description:
      'Handbags, backpacks, wallets, suitcases, and travel accessories.',
    categoryPath: ['Fashion', 'Bags & luggage', 'Travel goods'],
    options: [option('Size'), option('Color'), option('Set count')],
    attributes: withBrand(
      ['Product details', 'Material'],
      ['Measurements', 'Dimensions'],
      ['Product details', 'Capacity'],
      ['Product details', 'Number of compartments'],
      ['Care', 'Care instructions'],
    ),
  },
  {
    id: 'fashion-accessories',
    groupId: 'fashion',
    label: 'Fashion accessories & eyewear',
    description:
      'Belts, scarves, hats, sunglasses, ties, gloves, and related accessories.',
    categoryPath: ['Fashion', 'Accessories', 'Fashion accessories'],
    options: [option('Size'), option('Color'), option('Style')],
    attributes: withBrand(
      ['Product details', 'Material'],
      ['Product details', 'Department'],
      ['Measurements', 'Dimensions'],
      ['Care', 'Care instructions'],
    ),
  },
  {
    id: 'uniforms-workwear',
    groupId: 'fashion',
    label: 'Uniforms, scrubs & workwear',
    description:
      'Professional uniforms, medical scrubs, protective clothing, and work apparel.',
    categoryPath: ['Fashion', 'Uniforms & workwear', 'Professional apparel'],
    options: [option('Size'), option('Color'), option('Fit')],
    attributes: withBrand(
      ['Product details', 'Material'],
      ['Product details', 'Occupation / use'],
      ['Safety', 'Certification'],
      ['Care', 'Care instructions'],
    ),
  },

  {
    id: 'consumer-electronics',
    groupId: 'electronics',
    label: 'Consumer electronics',
    description:
      'General electronic devices, accessories, components, and bundles.',
    categoryPath: [
      'Electronics',
      'Consumer electronics',
      'Devices & accessories',
    ],
    options: [option('Model'), option('Color'), option('Bundle')],
    attributes: withBrand(
      ['Technical details', 'Model number'],
      ['Technical details', 'Connectivity'],
      ['Technical details', 'Power source'],
      ['Package', 'Included components'],
      ['Warranty', 'Warranty'],
    ),
  },
  {
    id: 'computers-tablets',
    groupId: 'electronics',
    label: 'Computers, tablets & accessories',
    description:
      'Laptops, desktops, tablets, monitors, storage, networking, and peripherals.',
    categoryPath: ['Electronics', 'Computers & tablets', 'Computing devices'],
    options: [option('Memory'), option('Storage'), option('Color')],
    attributes: withBrand(
      ['Technical details', 'Processor'],
      ['Technical details', 'Operating system'],
      ['Technical details', 'Display'],
      ['Technical details', 'Connectivity'],
      ['Warranty', 'Warranty'],
    ),
  },
  {
    id: 'phones-accessories',
    groupId: 'electronics',
    label: 'Cell phones & accessories',
    description:
      'Phones, cases, chargers, screen protectors, and mobile accessories.',
    categoryPath: ['Electronics', 'Cell phones', 'Phones & accessories'],
    options: [option('Storage'), option('Color'), option('Carrier')],
    attributes: withBrand(
      ['Technical details', 'Model number'],
      ['Technical details', 'Operating system'],
      ['Technical details', 'Network compatibility'],
      ['Technical details', 'Screen size'],
      ['Warranty', 'Warranty'],
    ),
  },
  {
    id: 'tv-home-theater',
    groupId: 'electronics',
    label: 'TV, video & home theater',
    description:
      'Televisions, streaming devices, projectors, and home theater equipment.',
    categoryPath: ['Electronics', 'TV & video', 'Home theater'],
    options: [option('Screen size'), option('Model year'), option('Bundle')],
    attributes: withBrand(
      ['Display', 'Display technology'],
      ['Display', 'Resolution'],
      ['Technical details', 'Connectivity'],
      ['Measurements', 'Dimensions'],
      ['Warranty', 'Warranty'],
    ),
  },
  {
    id: 'audio-headphones',
    groupId: 'electronics',
    label: 'Audio, headphones & speakers',
    description:
      'Portable audio, headphones, speakers, microphones, and home audio.',
    categoryPath: ['Electronics', 'Audio', 'Headphones & speakers'],
    options: [option('Color'), option('Connectivity'), option('Pack size')],
    attributes: withBrand(
      ['Technical details', 'Form factor'],
      ['Technical details', 'Connectivity'],
      ['Technical details', 'Battery life'],
      ['Package', 'Included components'],
      ['Warranty', 'Warranty'],
    ),
  },
  {
    id: 'cameras-drones',
    groupId: 'electronics',
    label: 'Cameras, photo & drones',
    description:
      'Cameras, lenses, drones, photo equipment, and imaging accessories.',
    categoryPath: [
      'Electronics',
      'Cameras & photo',
      'Cameras, lenses & drones',
    ],
    options: [option('Lens kit'), option('Color'), option('Bundle')],
    attributes: withBrand(
      ['Imaging', 'Sensor / resolution'],
      ['Imaging', 'Lens mount'],
      ['Technical details', 'Connectivity'],
      ['Package', 'Included components'],
      ['Warranty', 'Warranty'],
    ),
  },
  {
    id: 'smart-home-security',
    groupId: 'electronics',
    label: 'Smart home & security',
    description:
      'Connected lighting, cameras, sensors, locks, hubs, and home automation.',
    categoryPath: ['Electronics', 'Smart home', 'Security & automation'],
    options: [option('Color'), option('Pack size'), option('Compatibility')],
    attributes: withBrand(
      ['Compatibility', 'Compatible ecosystems'],
      ['Technical details', 'Connectivity'],
      ['Technical details', 'Power source'],
      ['Installation', 'Installation requirements'],
      ['Warranty', 'Warranty'],
    ),
  },
  {
    id: 'video-games',
    groupId: 'electronics',
    label: 'Video games, consoles & accessories',
    description: 'Games, consoles, controllers, VR, and gaming accessories.',
    categoryPath: ['Electronics', 'Video games', 'Gaming products'],
    options: [
      option('Platform'),
      option('Edition'),
      option('Format', 'Physical, Digital'),
    ],
    attributes: withBrand(
      ['Game details', 'Publisher'],
      ['Game details', 'Genre'],
      ['Game details', 'Age rating'],
      ['Compatibility', 'Compatible platform'],
      ['Release', 'Release date'],
    ),
    complianceNote:
      'Digital delivery and platform-key fulfillment require a separate integration.',
  },

  {
    id: 'home-kitchen',
    groupId: 'home',
    label: 'Home & kitchen',
    description:
      'Kitchenware, cookware, dining, cleaning, and everyday home goods.',
    categoryPath: ['Home', 'Home & kitchen', 'Household goods'],
    options: [option('Color'), option('Size'), option('Pack size')],
    attributes: withBrand(
      ['Product details', 'Material'],
      ['Measurements', 'Dimensions'],
      ['Product details', 'Capacity'],
      ['Care', 'Care instructions'],
    ),
  },
  {
    id: 'furniture',
    groupId: 'home',
    label: 'Furniture & mattresses',
    description:
      'Indoor furniture, mattresses, office furniture, and configurable sets.',
    categoryPath: ['Home', 'Furniture', 'Indoor furniture'],
    options: [
      option('Color / finish'),
      option('Size'),
      option('Configuration'),
    ],
    attributes: withBrand(
      ['Construction', 'Primary material'],
      ['Measurements', 'Dimensions'],
      ['Measurements', 'Weight capacity'],
      ['Assembly', 'Assembly required'],
      ['Care', 'Care instructions'],
    ),
  },
  {
    id: 'home-decor',
    groupId: 'home',
    label: 'Home décor & lighting',
    description:
      'Decorative accents, rugs, wall décor, window treatments, and lighting.',
    categoryPath: ['Home', 'Home décor', 'Décor & lighting'],
    options: [option('Color / finish'), option('Size'), option('Style')],
    attributes: withBrand(
      ['Product details', 'Material'],
      ['Measurements', 'Dimensions'],
      ['Product details', 'Room'],
      ['Installation', 'Installation method'],
      ['Care', 'Care instructions'],
    ),
  },
  {
    id: 'bedding-bath',
    groupId: 'home',
    label: 'Bedding & bath',
    description:
      'Sheets, blankets, pillows, towels, bath accessories, and coordinated sets.',
    categoryPath: ['Home', 'Bedding & bath', 'Linens & accessories'],
    options: [option('Size'), option('Color'), option('Set configuration')],
    attributes: withBrand(
      ['Product details', 'Material'],
      ['Product details', 'Thread count'],
      ['Package', 'Pieces included'],
      ['Care', 'Care instructions'],
    ),
  },
  {
    id: 'appliances',
    groupId: 'home',
    label: 'Appliances',
    description:
      'Major and small appliances with capacity, power, and installation details.',
    categoryPath: ['Home', 'Appliances', 'Home appliances'],
    options: [option('Color / finish'), option('Capacity'), option('Model')],
    attributes: withBrand(
      ['Technical details', 'Model number'],
      ['Technical details', 'Power requirements'],
      ['Measurements', 'Dimensions'],
      ['Installation', 'Installation requirements'],
      ['Warranty', 'Warranty'],
    ),
  },
  {
    id: 'patio-outdoor',
    groupId: 'home',
    label: 'Patio & outdoor living',
    description:
      'Patio furniture, grills, outdoor décor, pools, and outdoor entertaining.',
    categoryPath: ['Home', 'Patio & outdoor', 'Outdoor living'],
    options: [
      option('Color / finish'),
      option('Size'),
      option('Configuration'),
    ],
    attributes: withBrand(
      ['Construction', 'Material'],
      ['Measurements', 'Dimensions'],
      ['Product details', 'Weather resistance'],
      ['Assembly', 'Assembly required'],
      ['Care', 'Care instructions'],
    ),
  },
  {
    id: 'lawn-garden',
    groupId: 'home',
    label: 'Lawn, garden & live plants',
    description:
      'Plants, planters, soil, lawn care, watering, and outdoor power equipment.',
    categoryPath: ['Home', 'Lawn & garden', 'Garden center'],
    options: [option('Size'), option('Variety'), option('Pack size')],
    attributes: withBrand(
      ['Product details', 'Material / variety'],
      ['Measurements', 'Size / dimensions'],
      ['Usage', 'Recommended use'],
      ['Care', 'Care instructions'],
      ['Shipping', 'Shipping restrictions'],
    ),
  },
  {
    id: 'home-improvement',
    groupId: 'home',
    label: 'Tools & home improvement',
    description:
      'Power tools, hand tools, hardware, plumbing, electrical, paint, and building supplies.',
    categoryPath: [
      'Home',
      'Tools & home improvement',
      'Tools & building supplies',
    ],
    options: [option('Size'), option('Finish'), option('Pack size')],
    attributes: withBrand(
      ['Technical details', 'Model number'],
      ['Product details', 'Material'],
      ['Measurements', 'Dimensions'],
      ['Technical details', 'Power source'],
      ['Safety', 'Certification'],
    ),
  },

  {
    id: 'grocery-food',
    groupId: 'essentials',
    label: 'Grocery & gourmet food',
    description:
      'Shelf-stable, fresh, frozen, specialty, and gourmet food products.',
    categoryPath: ['Grocery', 'Food', 'Grocery & gourmet'],
    options: [option('Flavor'), option('Size'), option('Pack count')],
    attributes: withBrand(
      ['Food details', 'Ingredients'],
      ['Food details', 'Allergen information'],
      ['Food details', 'Dietary claims'],
      ['Package', 'Net quantity'],
      ['Storage', 'Storage instructions'],
    ),
    complianceNote:
      'Perishable fulfillment, lot tracking, expiration dates, and food compliance need dedicated operations.',
  },
  {
    id: 'beverages',
    groupId: 'essentials',
    label: 'Beverages',
    description:
      'Water, coffee, tea, juice, soda, drink mixes, and non-alcoholic beverages.',
    categoryPath: ['Grocery', 'Beverages', 'Drinks'],
    options: [option('Flavor'), option('Size'), option('Pack count')],
    attributes: withBrand(
      ['Food details', 'Ingredients'],
      ['Food details', 'Caffeine content'],
      ['Food details', 'Dietary claims'],
      ['Package', 'Net volume'],
      ['Storage', 'Storage instructions'],
    ),
  },
  {
    id: 'alcohol',
    groupId: 'essentials',
    label: 'Alcohol & age-restricted beverages',
    description:
      'Beer, wine, spirits, and ready-to-drink products as a catalog structure only.',
    categoryPath: ['Grocery', 'Alcohol', 'Age-restricted beverages'],
    options: [option('Variety'), option('Size'), option('Pack count')],
    attributes: withBrand(
      ['Product details', 'Beverage type'],
      ['Product details', 'Alcohol by volume'],
      ['Product details', 'Country / region'],
      ['Package', 'Net volume'],
      ['Storage', 'Storage instructions'],
    ),
    complianceNote:
      'Age verification, licensing, shipping restrictions, tax, and local-law controls are not supplied by this preset.',
  },
  {
    id: 'household-essentials',
    groupId: 'essentials',
    label: 'Household essentials',
    description:
      'Cleaning, laundry, paper, disposable, pest-control, and home-care supplies.',
    categoryPath: ['Household', 'Household essentials', 'Cleaning & supplies'],
    options: [option('Scent'), option('Size'), option('Pack count')],
    attributes: withBrand(
      ['Product details', 'Product form'],
      ['Product details', 'Recommended use'],
      ['Package', 'Net quantity'],
      ['Safety', 'Warnings'],
      ['Storage', 'Storage instructions'],
    ),
  },
  {
    id: 'health-wellness',
    groupId: 'essentials',
    label: 'Health, OTC & wellness',
    description:
      'Over-the-counter health, vitamins, supplements, first aid, and wellness products.',
    categoryPath: ['Health', 'Health & wellness', 'OTC & wellness'],
    options: [
      option('Form', 'Tablet, Capsule, Liquid, Cream'),
      option('Strength'),
      option('Pack size'),
    ],
    attributes: withBrand(
      ['Product details', 'Active ingredient'],
      ['Product details', 'Strength'],
      ['Product details', 'Dosage form'],
      ['Package', 'Package size'],
      ['Storage', 'Storage instructions'],
    ),
    complianceNote:
      'Claims, labeling, age gates, and regulated-product controls remain the merchant’s responsibility.',
  },
  {
    id: 'pharmacy-regulated',
    groupId: 'essentials',
    label: 'Pharmacy & regulated health (catalog only)',
    description:
      'A catalog starting point for regulated pharmacy items and pharmacist-managed products.',
    categoryPath: ['Health', 'Pharmacy', 'Regulated health products'],
    options: [
      option('Dosage form'),
      option('Strength'),
      option('Package size'),
    ],
    attributes: withBrand(
      ['Medication details', 'Active ingredient'],
      ['Medication details', 'Strength'],
      ['Medication details', 'Dosage form'],
      ['Package', 'Package size'],
      ['Storage', 'Storage instructions'],
    ),
    complianceNote:
      'Prescription validation, pharmacist review, controlled-substance rules, patient privacy, and regulated fulfillment require certified integrations.',
  },
  {
    id: 'medical-supplies',
    groupId: 'essentials',
    label: 'Medical supplies & equipment',
    description:
      'Durable medical equipment, diagnostics, mobility, home-care, and clinical supplies.',
    categoryPath: ['Health', 'Medical supplies', 'Equipment & consumables'],
    options: [option('Size'), option('Model'), option('Pack size')],
    attributes: withBrand(
      ['Product details', 'Intended use'],
      ['Technical details', 'Model number'],
      ['Compliance', 'Certification / classification'],
      ['Package', 'Included components'],
      ['Storage', 'Storage instructions'],
    ),
    complianceNote:
      'Device classification, prescriptions, reimbursement, and medical compliance need dedicated workflows.',
  },
  {
    id: 'beauty',
    groupId: 'essentials',
    label: 'Beauty & cosmetics',
    description:
      'Makeup, skincare, haircare, fragrance, nail care, and beauty tools.',
    categoryPath: ['Beauty', 'Beauty & cosmetics', 'Personal beauty'],
    options: [option('Shade'), option('Size'), option('Finish')],
    attributes: withBrand(
      ['Product details', 'Product form'],
      ['Product details', 'Skin / hair type'],
      ['Product details', 'Ingredients'],
      ['Usage', 'Directions'],
      ['Package', 'Net quantity'],
    ),
  },
  {
    id: 'personal-care',
    groupId: 'essentials',
    label: 'Personal care & grooming',
    description:
      'Bath, body, oral care, shaving, grooming, feminine care, and hygiene products.',
    categoryPath: ['Personal care', 'Care & grooming', 'Daily care'],
    options: [option('Scent'), option('Size'), option('Pack count')],
    attributes: withBrand(
      ['Product details', 'Product form'],
      ['Product details', 'Recommended use'],
      ['Product details', 'Ingredients'],
      ['Package', 'Net quantity'],
      ['Usage', 'Directions'],
    ),
  },
  {
    id: 'baby',
    groupId: 'essentials',
    label: 'Baby & toddler',
    description:
      'Diapers, feeding, nursery, travel gear, toys, and baby clothing.',
    categoryPath: ['Baby', 'Baby & toddler', 'Baby products'],
    options: [option('Size'), option('Color'), option('Pack count')],
    attributes: withBrand(
      ['Product details', 'Age / stage'],
      ['Product details', 'Material'],
      ['Safety', 'Safety standard'],
      ['Measurements', 'Dimensions'],
      ['Care', 'Care instructions'],
    ),
  },
  {
    id: 'pet-supplies',
    groupId: 'essentials',
    label: 'Pet supplies',
    description:
      'Food, treats, toys, habitats, grooming, health, and farm-animal supplies.',
    categoryPath: ['Pets', 'Pet supplies', 'Animal care'],
    options: [
      option('Pet size'),
      option('Flavor / style'),
      option('Pack count'),
    ],
    attributes: withBrand(
      ['Pet details', 'Animal type'],
      ['Pet details', 'Life stage'],
      ['Product details', 'Ingredients / material'],
      ['Package', 'Net quantity'],
      ['Usage', 'Directions'],
    ),
  },

  {
    id: 'toys-games',
    groupId: 'lifestyle',
    label: 'Toys, games & outdoor play',
    description:
      'Toys, puzzles, learning products, dolls, building sets, ride-ons, and play equipment.',
    categoryPath: ['Toys', 'Toys & games', 'Play products'],
    options: [option('Style'), option('Color'), option('Pack / set')],
    attributes: withBrand(
      ['Product details', 'Age range'],
      ['Product details', 'Material'],
      ['Safety', 'Safety warnings'],
      ['Package', 'Pieces included'],
      ['Measurements', 'Dimensions'],
    ),
  },
  {
    id: 'sports-outdoors',
    groupId: 'lifestyle',
    label: 'Sports, fitness & outdoors',
    description:
      'Team sports, exercise, camping, fishing, cycling, recreation, and outdoor gear.',
    categoryPath: [
      'Sports & outdoors',
      'Sporting goods',
      'Fitness & outdoor recreation',
    ],
    options: [option('Size'), option('Color'), option('Weight / capacity')],
    attributes: withBrand(
      ['Product details', 'Sport / activity'],
      ['Product details', 'Material'],
      ['Measurements', 'Dimensions'],
      ['Product details', 'Skill level'],
      ['Safety', 'Safety information'],
    ),
  },
  {
    id: 'arts-crafts',
    groupId: 'lifestyle',
    label: 'Arts, crafts, sewing & fabric',
    description:
      'Art supplies, crafting, sewing, knitting, fabric, cutting, and maker tools.',
    categoryPath: ['Arts & crafts', 'Craft supplies', 'Art, sewing & making'],
    options: [option('Color'), option('Size'), option('Pack count')],
    attributes: withBrand(
      ['Product details', 'Material'],
      ['Product details', 'Skill level'],
      ['Measurements', 'Dimensions / yardage'],
      ['Package', 'Pieces included'],
      ['Usage', 'Recommended use'],
    ),
  },
  {
    id: 'party-seasonal',
    groupId: 'lifestyle',
    label: 'Party, seasonal & celebrations',
    description:
      'Party supplies, gift wrap, costumes, holiday décor, and seasonal merchandise.',
    categoryPath: ['Seasonal', 'Party & celebrations', 'Seasonal goods'],
    options: [option('Theme'), option('Color'), option('Pack count')],
    attributes: withBrand(
      ['Product details', 'Occasion'],
      ['Product details', 'Material'],
      ['Package', 'Pieces included'],
      ['Measurements', 'Dimensions'],
      ['Safety', 'Safety information'],
    ),
  },
  {
    id: 'musical-instruments',
    groupId: 'lifestyle',
    label: 'Musical instruments & pro audio',
    description:
      'Instruments, studio equipment, live sound, DJ equipment, and accessories.',
    categoryPath: ['Music', 'Musical instruments', 'Instruments & pro audio'],
    options: [option('Size'), option('Finish'), option('Configuration')],
    attributes: withBrand(
      ['Product details', 'Instrument type'],
      ['Construction', 'Material'],
      ['Technical details', 'Connectivity'],
      ['Package', 'Included components'],
      ['Warranty', 'Warranty'],
    ),
  },
  {
    id: 'fine-art-antiques',
    groupId: 'lifestyle',
    label: 'Fine art, antiques & vintage',
    description:
      'Original art, prints, sculpture, antiques, vintage objects, and authenticated works.',
    categoryPath: ['Collectibles', 'Fine art & antiques', 'Art & vintage'],
    options: [option('Medium'), option('Size'), option('Condition')],
    attributes: attributes(
      ['Artwork details', 'Artist / maker'],
      ['Artwork details', 'Title / subject'],
      ['Artwork details', 'Date / period'],
      ['Artwork details', 'Medium / materials'],
      ['Authenticity', 'Provenance / authentication'],
      ['Condition', 'Condition notes'],
      ['Measurements', 'Dimensions'],
    ),
  },
  {
    id: 'flowers-gift-baskets',
    groupId: 'lifestyle',
    label: 'Flowers, plants & gift baskets',
    description:
      'Floral arrangements, bouquets, delivered plants, food gifts, and curated gift baskets.',
    categoryPath: ['Gifts', 'Flowers & gift baskets', 'Delivered gifts'],
    options: [option('Arrangement'), option('Size'), option('Occasion')],
    attributes: withBrand(
      ['Gift details', 'Contents'],
      ['Gift details', 'Occasion'],
      ['Food details', 'Allergen information'],
      ['Care', 'Care instructions'],
      ['Delivery', 'Delivery restrictions'],
    ),
    complianceNote:
      'Delivery-date selection, gift messages, perishability, and local florist routing require fulfillment integrations.',
  },
  {
    id: 'photo-printing',
    groupId: 'lifestyle',
    label: 'Photo prints & custom printing (catalog only)',
    description:
      'Prints, photo books, cards, signage, canvas, and other customer-supplied print products.',
    categoryPath: [
      'Custom printing',
      'Photo & print products',
      'Personalized printing',
    ],
    options: [option('Size'), option('Paper / material'), option('Finish')],
    attributes: withBrand(
      ['Print details', 'Print method'],
      ['Print details', 'Resolution requirements'],
      ['Print details', 'Bleed / safe area'],
      ['Production', 'Production time'],
      ['Delivery', 'Delivery method'],
    ),
    complianceNote:
      'Customer file uploads, previews, proof approval, personalization, and production handoff require dedicated workflows.',
  },
  {
    id: 'collectibles',
    groupId: 'lifestyle',
    label: 'Collectibles & fan merchandise',
    description:
      'Trading cards, memorabilia, figures, coins, licensed goods, and limited editions.',
    categoryPath: [
      'Collectibles',
      'Collectibles & memorabilia',
      'Fan merchandise',
    ],
    options: [
      option('Character / team'),
      option('Edition'),
      option('Condition'),
    ],
    attributes: withBrand(
      ['Collectible details', 'Franchise / subject'],
      ['Collectible details', 'Edition / series'],
      ['Collectible details', 'Condition'],
      ['Collectible details', 'Authenticity / grading'],
      ['Measurements', 'Dimensions'],
    ),
  },

  {
    id: 'books',
    groupId: 'media',
    label: 'Books, magazines & educational media',
    description:
      'Printed books, textbooks, magazines, comics, and educational publications.',
    categoryPath: ['Media', 'Books', 'Books & publications'],
    options: [
      option('Format', 'Hardcover, Paperback, Large print'),
      option('Language'),
      option('Edition'),
    ],
    attributes: attributes(
      ['Publication', 'Author / creator'],
      ['Publication', 'Publisher'],
      ['Publication', 'ISBN / identifier'],
      ['Publication', 'Publication date'],
      ['Publication', 'Page count'],
    ),
  },
  {
    id: 'movies-music',
    groupId: 'media',
    label: 'Movies, TV, music & vinyl',
    description:
      'DVD, Blu-ray, vinyl, CDs, box sets, and other physical entertainment media.',
    categoryPath: ['Media', 'Movies & music', 'Physical media'],
    options: [option('Format'), option('Edition'), option('Region')],
    attributes: attributes(
      ['Media details', 'Artist / studio'],
      ['Media details', 'Genre'],
      ['Media details', 'Release date'],
      ['Media details', 'Runtime / track count'],
      ['Media details', 'Content rating'],
    ),
  },
  {
    id: 'office-school',
    groupId: 'media',
    label: 'Office, school & business supplies',
    description:
      'Writing, paper, filing, teaching, shipping, presentation, and workplace supplies.',
    categoryPath: [
      'Office & school',
      'Office supplies',
      'School & business supplies',
    ],
    options: [option('Color'), option('Size'), option('Pack count')],
    attributes: withBrand(
      ['Product details', 'Material'],
      ['Product details', 'Recommended use'],
      ['Measurements', 'Dimensions'],
      ['Package', 'Quantity'],
      ['Compatibility', 'Compatible equipment'],
    ),
  },
  {
    id: 'software-digital',
    groupId: 'media',
    label: 'Software & digital products',
    description:
      'Software licenses, downloadable goods, online access, and digital content.',
    categoryPath: ['Digital', 'Software & downloads', 'Digital products'],
    options: [
      option('Platform'),
      option('License term'),
      option('Delivery type'),
    ],
    attributes: attributes(
      ['Digital details', 'Publisher'],
      ['Digital details', 'System requirements'],
      ['Digital details', 'License type'],
      ['Digital details', 'Supported platforms'],
      ['Digital details', 'Delivery instructions'],
    ),
    complianceNote:
      'Secure key delivery, downloads, renewals, subscriptions, and license enforcement require a fulfillment integration.',
  },
  {
    id: 'subscriptions-replenishment',
    groupId: 'media',
    label: 'Subscriptions & replenishment (catalog only)',
    description:
      'Recurring boxes, memberships, publications, consumable refills, and scheduled replenishment.',
    categoryPath: [
      'Subscriptions',
      'Recurring products',
      'Plans & replenishment',
    ],
    options: [option('Plan'), option('Frequency'), option('Duration')],
    attributes: attributes(
      ['Subscription details', 'Billing frequency'],
      ['Subscription details', 'Delivery frequency'],
      ['Subscription details', 'Minimum term'],
      ['Subscription details', 'Cancellation policy'],
      ['Fulfillment', 'Items included'],
    ),
    complianceNote:
      'Recurring billing, renewals, plan changes, cancellations, and scheduled fulfillment require dedicated integrations.',
  },
  {
    id: 'gift-cards',
    groupId: 'media',
    label: 'Gift cards, vouchers & prepaid value',
    description:
      'Physical and digital stored-value products, vouchers, and prepaid cards.',
    categoryPath: ['Gifts', 'Gift cards', 'Stored value'],
    options: [option('Value'), option('Delivery type'), option('Design')],
    attributes: attributes(
      ['Gift card details', 'Issuer'],
      ['Gift card details', 'Redemption method'],
      ['Gift card details', 'Expiration policy'],
      ['Gift card details', 'Terms and restrictions'],
      ['Fulfillment', 'Delivery instructions'],
    ),
    complianceNote:
      'Activation, balance management, anti-fraud controls, and financial regulations require a dedicated provider.',
  },

  {
    id: 'automotive',
    groupId: 'commercial',
    label: 'Automotive, tires & vehicle parts',
    description:
      'Replacement parts, tires, fluids, tools, electronics, and interior/exterior accessories.',
    categoryPath: [
      'Automotive',
      'Auto parts & accessories',
      'Vehicle products',
    ],
    options: [
      option('Vehicle fitment'),
      option('Finish'),
      option('Pack count'),
    ],
    attributes: withBrand(
      ['Vehicle fitment', 'Year / make / model'],
      ['Product details', 'Part number'],
      ['Product details', 'Material'],
      ['Measurements', 'Dimensions'],
      ['Warranty', 'Warranty'],
    ),
    complianceNote:
      'VIN and year/make/model compatibility need a dedicated fitment database before production use.',
  },
  {
    id: 'powersports-rv',
    groupId: 'commercial',
    label: 'Motorcycle, powersports, marine & RV',
    description:
      'Parts, accessories, safety equipment, and maintenance goods for recreational vehicles.',
    categoryPath: ['Automotive', 'Powersports & RV', 'Parts & accessories'],
    options: [option('Vehicle type'), option('Size'), option('Finish')],
    attributes: withBrand(
      ['Vehicle fitment', 'Compatible vehicle'],
      ['Product details', 'Part number'],
      ['Product details', 'Material'],
      ['Safety', 'Certification'],
      ['Warranty', 'Warranty'],
    ),
    complianceNote:
      'Vehicle compatibility and safety certification must be validated by the merchant.',
  },
  {
    id: 'industrial-scientific',
    groupId: 'commercial',
    label: 'Industrial, scientific & lab supplies',
    description:
      'MRO, laboratory, testing, safety, packaging, and production supplies.',
    categoryPath: [
      'Business & industrial',
      'Industrial & scientific',
      'Equipment & supplies',
    ],
    options: [option('Size'), option('Material'), option('Pack count')],
    attributes: withBrand(
      ['Technical details', 'Model / part number'],
      ['Technical details', 'Material / composition'],
      ['Technical details', 'Measurement range'],
      ['Compliance', 'Certification / standard'],
      ['Package', 'Quantity'],
    ),
  },
  {
    id: 'restaurant-supplies',
    groupId: 'commercial',
    label: 'Restaurant & food-service supplies',
    description:
      'Commercial kitchen equipment, serving, storage, disposables, and sanitation supplies.',
    categoryPath: [
      'Business & industrial',
      'Food service',
      'Restaurant supplies',
    ],
    options: [option('Size'), option('Material'), option('Pack count')],
    attributes: withBrand(
      ['Product details', 'Material'],
      ['Measurements', 'Dimensions / capacity'],
      ['Technical details', 'Power requirements'],
      ['Compliance', 'Food-contact certification'],
      ['Care', 'Cleaning instructions'],
    ),
  },
  {
    id: 'farm-agriculture',
    groupId: 'commercial',
    label: 'Farm, agriculture & animal supplies',
    description:
      'Farm tools, livestock care, fencing, irrigation, seed, and agricultural supplies.',
    categoryPath: [
      'Business & industrial',
      'Farm & agriculture',
      'Agricultural supplies',
    ],
    options: [option('Size'), option('Capacity'), option('Pack count')],
    attributes: withBrand(
      ['Product details', 'Intended use'],
      ['Product details', 'Material / composition'],
      ['Measurements', 'Dimensions / coverage'],
      ['Safety', 'Warnings'],
      ['Storage', 'Storage instructions'],
    ),
  },
  {
    id: 'resale-refurbished',
    groupId: 'commercial',
    label: 'Resale, renewed & refurbished goods',
    description:
      'Used, open-box, renewed, vintage, and professionally refurbished merchandise.',
    categoryPath: ['Resale', 'Pre-owned & refurbished', 'Second-life products'],
    options: [option('Condition'), option('Grade'), option('Bundle')],
    attributes: withBrand(
      ['Condition', 'Condition grade'],
      ['Condition', 'Inspection / refurbishment'],
      ['Condition', 'Cosmetic notes'],
      ['Package', 'Included components'],
      ['Warranty', 'Warranty / return policy'],
    ),
  },
];

const defaultProductTemplate = PRODUCT_TEMPLATES.find(
  (template) => template.id === 'general',
);
if (!defaultProductTemplate) {
  throw new Error('The general product template is required.');
}
export const DEFAULT_PRODUCT_TEMPLATE = defaultProductTemplate;

function normalized(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

function validateProductTemplates(templates: ProductTemplate[]): void {
  const groupIds = new Set<string>(
    PRODUCT_TEMPLATE_GROUPS.map((group) => group.id),
  );
  const ids = new Set<string>();

  for (const template of templates) {
    if (!template.id || ids.has(template.id)) {
      throw new Error(
        `Duplicate or missing product template id: ${template.id || '(empty)'}`,
      );
    }
    ids.add(template.id);
    if (!groupIds.has(template.groupId)) {
      throw new Error(`Unknown group for product template: ${template.id}`);
    }
    if (
      template.categoryPath.length > 5 ||
      template.categoryPath.some((value) => !value.trim() || value.length > 80)
    ) {
      throw new Error(
        `Invalid category path for product template: ${template.id}`,
      );
    }
    if (template.options.length > 3) {
      throw new Error(`Too many options in product template: ${template.id}`);
    }
    if (template.attributes.length > 50) {
      throw new Error(
        `Too many specifications in product template: ${template.id}`,
      );
    }

    const optionNames = template.options.map((item) => normalized(item.name));
    if (
      new Set(optionNames).size !== optionNames.length ||
      optionNames.some((name) => !name || name.length > 40)
    ) {
      throw new Error(
        `Duplicate or missing option name in product template: ${template.id}`,
      );
    }
    const populatedValueCounts = template.options
      .map((item) => {
        const values = item.values.split(',').map(normalized).filter(Boolean);
        if (
          values.length > 30 ||
          values.some((value) => value.length > 40) ||
          new Set(values).size !== values.length
        ) {
          throw new Error(
            `Invalid option values in product template: ${template.id}`,
          );
        }
        return values.length;
      })
      .filter((count) => count > 0);
    const combinations = populatedValueCounts.reduce(
      (count, valueCount) => count * valueCount,
      1,
    );
    if (populatedValueCounts.length > 0 && combinations > 100) {
      throw new Error(
        `Too many prefilled variants in product template: ${template.id}`,
      );
    }

    const attributeKeys = template.attributes.map(
      (item) => `${normalized(item.groupName)}\u0000${normalized(item.name)}`,
    );
    if (
      new Set(attributeKeys).size !== attributeKeys.length ||
      template.attributes.some(
        (item) =>
          !item.groupName.trim() ||
          !item.name.trim() ||
          item.groupName.length > 60 ||
          item.name.length > 80,
      )
    ) {
      throw new Error(
        `Duplicate or missing specification in product template: ${template.id}`,
      );
    }
  }
}

validateProductTemplates(PRODUCT_TEMPLATES);
