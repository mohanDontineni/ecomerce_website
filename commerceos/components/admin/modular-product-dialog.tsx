'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Save, Sparkles, Trash2, X } from 'lucide-react';
import {
  DEFAULT_PRODUCT_TEMPLATE,
  PRODUCT_TEMPLATE_GROUPS,
  PRODUCT_TEMPLATES,
  type ProductTemplate,
} from '@/lib/catalog-templates';
import type { CategoryNode, Product } from '@/lib/domain';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

type VariantDraft = {
  id?: string;
  optionValues: string[];
  sku: string;
  price: string;
  stock: string;
  status: 'active' | 'archived';
};

type AttributeDraft = {
  key: string;
  groupName: string;
  name: string;
  value: string;
  visible: boolean;
};

type OptionDraft = {
  name: string;
  values: string[];
};

function templateAttributes(template: ProductTemplate): AttributeDraft[] {
  return template.attributes.map((attribute, index) => ({
    key: `${template.id}-${index}`,
    ...attribute,
    value: '',
    visible: true,
  }));
}

type Props = {
  open: boolean;
  product: Product | null;
  currency: string;
  categories: CategoryNode[];
  onOpenChange: (open: boolean) => void;
  onSaved: (message: string) => Promise<void>;
  showNotice: (message: string) => void;
};

function formText(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === 'string' ? value : '';
}

function listValues(value: string): string[] {
  return Array.from(
    new Map(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => [item.toLocaleLowerCase(), item]),
    ).values(),
  );
}

function optionDraftError(options: OptionDraft[]): string | null {
  const activeOptions = options.filter((option) => option.values.length > 0);
  if (activeOptions.length === 0) {
    return 'Add an option name and at least one value before generating variants.';
  }
  if (activeOptions.some((option) => !option.name)) {
    return 'Name every option that has values.';
  }
  if (activeOptions.some((option) => option.name.length > 40)) {
    return 'Option names can use up to 40 characters.';
  }
  if (
    activeOptions.some(
      (option) =>
        option.values.length > 30 || option.values.some((value) => value.length > 40),
    )
  ) {
    return 'Each option supports 1–30 values, up to 40 characters each.';
  }
  const optionNames = activeOptions.map((option) =>
    option.name.normalize('NFKC').toLocaleLowerCase(),
  );
  if (new Set(optionNames).size !== optionNames.length) {
    return 'Option names must be unique.';
  }
  return null;
}

function skuPart(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 16);
}

function generatedSku(baseSku: string, values: string[], index: number): string {
  const optionSuffix = values.map(skuPart).filter(Boolean).join('-') || 'VAR';
  const ordinal = (index + 1).toString(36).toUpperCase().padStart(2, '0');
  const suffix = `${optionSuffix}-${ordinal}`;
  const normalizedBase = (baseSku || 'SKU')
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'SKU';
  const availableBaseLength = Math.max(2, 64 - suffix.length - 1);
  return `${normalizedBase.slice(0, availableBaseLength)}-${suffix}`.slice(0, 64);
}

function combinations(valueGroups: string[][]): string[][] {
  return valueGroups.reduce<string[][]>(
    (rows, values) => rows.flatMap((row) => values.map((value) => [...row, value])),
    [[]],
  );
}

function pathKey(values: string[]): string {
  return values.map((value) => value.toLocaleLowerCase()).join('\u0000');
}

function findNode(nodes: CategoryNode[], name: string): CategoryNode | undefined {
  return nodes.find((node) => node.name.toLocaleLowerCase() === name.toLocaleLowerCase());
}

export function ModularProductDialog({
  open,
  product,
  currency,
  categories,
  onOpenChange,
  onSaved,
  showNotice,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [department, setDepartment] = useState('');
  const [category, setCategory] = useState('');
  const [productType, setProductType] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [catalogLeaf, setCatalogLeaf] = useState('');
  const [baseSku, setBaseSku] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [simpleStock, setSimpleStock] = useState('0');
  const [threshold, setThreshold] = useState('5');
  const [hasOptions, setHasOptions] = useState(false);
  const [templateId, setTemplateId] = useState(DEFAULT_PRODUCT_TEMPLATE.id);
  const [optionOneName, setOptionOneName] = useState('Option');
  const [optionOneValues, setOptionOneValues] = useState('');
  const [optionTwoName, setOptionTwoName] = useState('');
  const [optionTwoValues, setOptionTwoValues] = useState('');
  const [optionThreeName, setOptionThreeName] = useState('');
  const [optionThreeValues, setOptionThreeValues] = useState('');
  const [variantRows, setVariantRows] = useState<VariantDraft[]>([]);
  const [attributeRows, setAttributeRows] = useState<AttributeDraft[]>([]);

  useEffect(() => {
    if (!open) return;
    const path = product?.categoryPath.map((item) => item.name) ?? [];
    setDepartment(path[0] ?? product?.category ?? '');
    setCategory(path[1] ?? '');
    setProductType(path[2] ?? '');
    setSubcategory(path[3] ?? '');
    setCatalogLeaf(path[4] ?? '');
    setBaseSku(product?.sku ?? '');
    setBasePrice(product ? String(product.priceCents / 100) : '');
    setSimpleStock(
      String(product?.variants.find((variant) => variant.isDefault)?.stock ?? product?.stock ?? 0),
    );
    setThreshold(String(product?.lowStockThreshold ?? 5));
    const configurable = Boolean(product?.options.length);
    setHasOptions(configurable);
    setTemplateId(DEFAULT_PRODUCT_TEMPLATE.id);
    setOptionOneName(product?.options[0]?.name ?? 'Option');
    setOptionOneValues(
      product?.options[0]?.values.map((value) => value.value).join(', ') ?? '',
    );
    setOptionTwoName(product?.options[1]?.name ?? '');
    setOptionTwoValues(
      product?.options[1]?.values.map((value) => value.value).join(', ') ?? '',
    );
    setOptionThreeName(product?.options[2]?.name ?? '');
    setOptionThreeValues(
      product?.options[2]?.values.map((value) => value.value).join(', ') ?? '',
    );
    setVariantRows(
      configurable
          ? (product?.variants ?? [])
            .filter(
              (variant) =>
                !variant.isDefault &&
                variant.optionValues.length === (product?.options.length ?? 0),
            )
            .map((variant) => ({
              id: variant.id,
              optionValues: [...variant.optionValues]
                .sort((a, b) => a.position - b.position)
                .map((value) => value.value),
              sku: variant.sku,
              price:
                variant.priceOverrideCents == null
                  ? ''
                  : String(variant.priceOverrideCents / 100),
              stock: String(variant.stock),
              status: variant.status,
            }))
        : [],
    );
    setAttributeRows(
      product
        ? product.attributes.map((attribute) => ({
            key: attribute.id,
            groupName: attribute.groupName,
            name: attribute.name,
            value: attribute.value,
            visible: attribute.visible,
          }))
        : templateAttributes(DEFAULT_PRODUCT_TEMPLATE),
    );
    setError('');
  }, [open, product]);

  const departmentNode = useMemo(
    () => findNode(categories, department),
    [categories, department],
  );
  const categoryNodes = departmentNode?.children ?? categories.flatMap((node) => node.children);
  const categoryNode = useMemo(
    () => findNode(categoryNodes, category),
    [categoryNodes, category],
  );
  const productTypeNodes =
    categoryNode?.children ?? categoryNodes.flatMap((node) => node.children);
  const productTypeNode = useMemo(
    () => findNode(productTypeNodes, productType),
    [productTypeNodes, productType],
  );
  const subcategoryNodes =
    productTypeNode?.children ?? productTypeNodes.flatMap((node) => node.children);
  const subcategoryNode = useMemo(
    () => findNode(subcategoryNodes, subcategory),
    [subcategoryNodes, subcategory],
  );
  const catalogLeafNodes =
    subcategoryNode?.children ?? subcategoryNodes.flatMap((node) => node.children);
  const selectedTemplate =
    PRODUCT_TEMPLATES.find((template) => template.id === templateId) ??
    DEFAULT_PRODUCT_TEMPLATE;

  function applyTemplate(nextId: ProductTemplate['id']) {
    const template =
      PRODUCT_TEMPLATES.find((candidate) => candidate.id === nextId) ??
      DEFAULT_PRODUCT_TEMPLATE;
    const [nextDepartment = '', nextCategory = '', nextProductType = '', nextSubcategory = '', nextCatalogLeaf = ''] = template.categoryPath;
    setTemplateId(template.id);
    setDepartment(nextDepartment);
    setCategory(nextCategory);
    setProductType(nextProductType);
    setSubcategory(nextSubcategory);
    setCatalogLeaf(nextCatalogLeaf);
    setHasOptions(template.options.some((item) => listValues(item.values).length > 0));
    setOptionOneName(template.options[0]?.name ?? 'Option');
    setOptionOneValues(template.options[0]?.values ?? '');
    setOptionTwoName(template.options[1]?.name ?? '');
    setOptionTwoValues(template.options[1]?.values ?? '');
    setOptionThreeName(template.options[2]?.name ?? '');
    setOptionThreeValues(template.options[2]?.values ?? '');
    setVariantRows([]);
    setAttributeRows(templateAttributes(template));
    setError('');
    showNotice(`${template.label} template applied.`);
  }

  function generateVariants() {
    setError('');
    const optionDrafts = [
      { name: optionOneName.trim(), values: listValues(optionOneValues) },
      { name: optionTwoName.trim(), values: listValues(optionTwoValues) },
      { name: optionThreeName.trim(), values: listValues(optionThreeValues) },
    ].filter((option) => option.values.length > 0);
    const optionError = optionDraftError(optionDrafts);
    if (optionError) {
      setError(optionError);
      return;
    }
    const valueGroups = optionDrafts.map((option) => option.values);
    const nextCombinations = combinations(valueGroups);
    if (nextCombinations.length > 100) {
      setError('This creates more than 100 variants. Use fewer option values.');
      return;
    }
    const existing = new Map(variantRows.map((row) => [pathKey(row.optionValues), row]));
    const nextRows: VariantDraft[] = nextCombinations.map((values, index) => {
      const saved = existing.get(pathKey(values));
      return (
        saved ?? {
          optionValues: values,
          sku: generatedSku(baseSku, values, index),
          price: '',
          stock: '0',
          status: 'active',
        }
      );
    });
    if (new Set(nextRows.map((row) => row.sku)).size !== nextRows.length) {
      setVariantRows(nextRows);
      setError('Generated SKUs are not unique. Shorten the option values or edit the SKUs.');
      return;
    }
    setVariantRows(nextRows);
  }

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const optionDrafts = [
      { name: optionOneName.trim(), values: listValues(optionOneValues) },
      { name: optionTwoName.trim(), values: listValues(optionTwoValues) },
      { name: optionThreeName.trim(), values: listValues(optionThreeValues) },
    ];
    const optionError = hasOptions ? optionDraftError(optionDrafts) : null;
    if (optionError) {
      setSaving(false);
      setError(optionError);
      return;
    }
    const options = hasOptions
      ? optionDrafts.filter((option) => option.values.length > 0)
      : [];
    const expectedVariants = hasOptions
      ? options.reduce((count, option) => count * option.values.length, 1)
      : 0;
    const expectedVariantKeys = new Set(
      hasOptions ? combinations(options.map((option) => option.values)).map(pathKey) : [],
    );
    if (
      hasOptions &&
      (options.length === 0 ||
        options.some((option) => !option.name) ||
        expectedVariants === 0 ||
        variantRows.length !== expectedVariants ||
        variantRows.some((variant) => !expectedVariantKeys.has(pathKey(variant.optionValues))))
    ) {
      setSaving(false);
      setError('Option values changed. Generate all combinations again before saving.');
      return;
    }
    if (
      hasOptions &&
      new Set(variantRows.map((variant) => variant.sku.trim().toUpperCase())).size !==
        variantRows.length
    ) {
      setSaving(false);
      setError('Every variant needs a unique SKU.');
      return;
    }
    const incompleteAttribute = attributeRows.find(
      (attribute) => attribute.value.trim() && !attribute.name.trim(),
    );
    if (incompleteAttribute) {
      setSaving(false);
      setError('Name every specification that has a value.');
      return;
    }
    const attributes = attributeRows
      .filter((attribute) => attribute.name.trim() && attribute.value.trim())
      .map((attribute) => ({
        groupName: attribute.groupName.trim() || 'Details',
        name: attribute.name.trim(),
        value: attribute.value.trim(),
        visible: attribute.visible,
      }));
    const payload = {
      name: formText(form, 'name'),
      description: formText(form, 'description'),
      categoryPath: [department, category, productType, subcategory, catalogLeaf]
        .map((value) => value.trim())
        .filter(Boolean),
      sku: baseSku,
      priceCents: Math.round(Number(basePrice) * 100),
      compareAtCents: form.get('compareAt')
        ? Math.round(Number(form.get('compareAt')) * 100)
        : null,
      costCents: form.get('cost') ? Math.round(Number(form.get('cost')) * 100) : null,
      stock: Math.max(0, Math.trunc(Number(simpleStock || 0))),
      lowStockThreshold: Math.max(0, Math.trunc(Number(threshold || 0))),
      status: formText(form, 'status'),
      featured: form.get('featured') === 'on',
      imageUrl: formText(form, 'imageUrl'),
      expectedUpdatedAt: product?.updatedAt,
      attributes,
      options,
      variants: hasOptions
        ? variantRows.map((variant) => ({
            id: variant.id,
            optionValues: variant.optionValues,
            sku: variant.sku,
            priceCents:
              variant.price.trim() === '' ? null : Math.round(Number(variant.price) * 100),
            compareAtCents: null,
            costCents: null,
            stock: Math.max(0, Math.trunc(Number(variant.stock || 0))),
            lowStockThreshold: Math.max(0, Math.trunc(Number(threshold || 0))),
            status: variant.status,
          }))
        : [],
    };
    try {
      const response = await fetch(product ? `/api/products/${product.id}` : '/api/products', {
        method: product ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { productId?: string; error?: string };
      if (!response.ok) throw new Error(result.error || 'Product could not be saved.');
      const productId = product?.id ?? result.productId;
      const files = form
        .getAll('images')
        .filter((value): value is File => value instanceof File && value.size > 0);
      if (productId) {
        for (const file of files) {
          const imageForm = new FormData();
          imageForm.append('file', file);
          imageForm.append('alt', payload.name);
          const upload = await fetch(`/api/products/${productId}/images`, {
            method: 'POST',
            body: imageForm,
          });
          if (!upload.ok) {
            const uploadError = (await upload.json()) as { error?: string };
            throw new Error(uploadError.error || 'One image could not be uploaded.');
          }
        }
      }
      await onSaved(product ? 'Product updated.' : 'Product created.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Product could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function removeImage(imageId: string) {
    if (!product) return;
    const response = await fetch(
      `/api/products/${product.id}/images?imageId=${encodeURIComponent(imageId)}`,
      { method: 'DELETE' },
    );
    if (response.ok) showNotice('Image removed. Reopen the product to refresh the gallery.');
    else showNotice('Could not remove that image.');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="product-dialog modular-product-dialog sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{product ? 'Edit product' : 'Create product'}</DialogTitle>
          <DialogDescription>
            Organize the catalog, build sellable variants, set inventory, and add a gallery.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <section className="product-form-section">
            <div className="product-form-section-heading">
              <span>1</span>
              <div><strong>Product details</strong><small>The shared information customers see.</small></div>
            </div>
            <div className="product-form-grid">
              {!product && (
                <div className="form-span-2 product-template-picker">
                  <Label htmlFor="product-template">Retail / product template ({PRODUCT_TEMPLATES.length} types)</Label>
                  <div className="product-template-controls">
                    <NativeSelect
                      id="product-template"
                      className="w-full"
                      value={templateId}
                      onChange={(event) => setTemplateId(event.target.value)}
                    >
                      {PRODUCT_TEMPLATE_GROUPS.map((group) => (
                        <NativeSelectOptGroup key={group.id} label={group.label}>
                          {PRODUCT_TEMPLATES.filter((template) => template.groupId === group.id).map((template) => (
                            <NativeSelectOption key={template.id} value={template.id}>
                              {template.label}
                            </NativeSelectOption>
                          ))}
                        </NativeSelectOptGroup>
                      ))}
                    </NativeSelect>
                    <Button type="button" onClick={() => applyTemplate(templateId)}>
                      <Sparkles /> Apply template
                    </Button>
                  </div>
                  <small className="field-help">
                    {selectedTemplate.description}
                    {selectedTemplate.categoryPath.length > 0
                      ? ` Suggested path: ${selectedTemplate.categoryPath.join(' → ')}.`
                      : ''}{' '}
                    Apply template to replace the current category, option, and specification drafts. Every copied field stays editable.
                    {selectedTemplate.complianceNote
                      ? ` Important: ${selectedTemplate.complianceNote}`
                      : ''}
                  </small>
                </div>
              )}
              <div className="form-span-2">
                <Label htmlFor="product-name">Title</Label>
                <Input id="product-name" name="name" defaultValue={product?.name} required />
              </div>
              <div className="form-span-2">
                <Label htmlFor="product-description">Description</Label>
                <Textarea id="product-description" name="description" defaultValue={product?.description} rows={4} />
              </div>
            </div>
          </section>

          <section className="product-form-section">
            <div className="product-form-section-heading">
              <span>2</span>
              <div><strong>Catalog organization</strong><small>Create any hierarchy—from audience and department to category and product type.</small></div>
            </div>
            <div className="catalog-path-grid">
              <div>
                <Label htmlFor="product-department">Department</Label>
                <Input id="product-department" list="department-suggestions" value={department} onChange={(event) => { setDepartment(event.target.value); setCategory(''); setProductType(''); setSubcategory(''); setCatalogLeaf(''); }} placeholder="Women, Jewelry, Health…" maxLength={80} required />
                <datalist id="department-suggestions">{categories.map((node) => <option key={node.id} value={node.name} />)}</datalist>
              </div>
              <div>
                <Label htmlFor="product-category">Category</Label>
                <Input id="product-category" list="category-suggestions" value={category} onChange={(event) => { setCategory(event.target.value); setProductType(''); setSubcategory(''); setCatalogLeaf(''); }} placeholder="Apparel, Rings, Wellness…" maxLength={80} />
                <datalist id="category-suggestions">{categoryNodes.map((node) => <option key={node.id} value={node.name} />)}</datalist>
              </div>
              <div>
                <Label htmlFor="product-type">Product type</Label>
                <Input id="product-type" list="type-suggestions" value={productType} onChange={(event) => { setProductType(event.target.value); setSubcategory(''); setCatalogLeaf(''); }} placeholder="Shirts, Sneakers, Supplements…" maxLength={80} />
                <datalist id="type-suggestions">{productTypeNodes.map((node) => <option key={node.id} value={node.name} />)}</datalist>
              </div>
              <div>
                <Label htmlFor="product-subcategory">Subcategory <small>(optional)</small></Label>
                <Input id="product-subcategory" list="subcategory-suggestions" value={subcategory} onChange={(event) => { setSubcategory(event.target.value); setCatalogLeaf(''); }} placeholder="Casual, Fine jewelry…" maxLength={80} />
                <datalist id="subcategory-suggestions">{subcategoryNodes.map((node) => <option key={node.id} value={node.name} />)}</datalist>
              </div>
              <div>
                <Label htmlFor="product-catalog-leaf">Collection / subtype <small>(optional)</small></Label>
                <Input id="product-catalog-leaf" list="catalog-leaf-suggestions" value={catalogLeaf} onChange={(event) => setCatalogLeaf(event.target.value)} placeholder="Oxford, Birthstone…" maxLength={80} />
                <datalist id="catalog-leaf-suggestions">{catalogLeafNodes.map((node) => <option key={node.id} value={node.name} />)}</datalist>
              </div>
            </div>
            <div className="category-path-preview">
              <Sparkles />
              {[department, category, productType, subcategory, catalogLeaf].filter(Boolean).join(' → ') || 'Add a department to start the catalog path'}
            </div>
          </section>

          <section className="product-form-section">
            <div className="product-form-section-heading">
              <span>3</span>
              <div><strong>Pricing & publishing</strong><small>The base price is used unless a variant overrides it.</small></div>
            </div>
            <div className="product-form-grid">
              <div>
                <Label htmlFor="product-sku">Base SKU</Label>
                <Input id="product-sku" value={baseSku} onChange={(event) => setBaseSku(event.target.value.toUpperCase())} placeholder="PRODUCT-001" required />
              </div>
              <div>
                <Label htmlFor="product-price">Base price ({currency})</Label>
                <Input id="product-price" type="number" min="0" step="0.01" value={basePrice} onChange={(event) => setBasePrice(event.target.value)} required />
              </div>
              <div>
                <Label htmlFor="product-compare-price">Compare-at price</Label>
                <Input id="product-compare-price" name="compareAt" type="number" min="0" step="0.01" defaultValue={product?.compareAtCents ? product.compareAtCents / 100 : ''} />
              </div>
              <div>
                <Label htmlFor="product-cost">Unit cost</Label>
                <Input id="product-cost" name="cost" type="number" min="0" step="0.01" defaultValue={product?.costCents ? product.costCents / 100 : ''} />
              </div>
              <div>
                <Label htmlFor="product-status">Publishing status</Label>
                <NativeSelect id="product-status" name="status" className="w-full" defaultValue={product?.status ?? 'draft'}>
                  <NativeSelectOption value="draft">Draft</NativeSelectOption>
                  <NativeSelectOption value="active">Active</NativeSelectOption>
                  <NativeSelectOption value="archived">Archived</NativeSelectOption>
                </NativeSelect>
              </div>
              <div>
                <Label htmlFor="low-stock-threshold">Low-stock alert at</Label>
                <Input id="low-stock-threshold" type="number" min="0" value={threshold} onChange={(event) => setThreshold(event.target.value)} />
              </div>
              <label className="switch-field">
                <Switch name="featured" defaultChecked={product?.featured} />
                <span><strong>Featured product</strong><small>Show this item prominently.</small></span>
              </label>
            </div>
          </section>

          <section className="product-form-section">
            <div className="product-form-section-heading product-options-heading">
              <span>4</span>
              <div><strong>Options & variants</strong><small>Track each size, color, material, or other combination separately.</small></div>
              <Switch checked={hasOptions} onCheckedChange={setHasOptions} aria-label="Product has options" />
            </div>
            {hasOptions ? (
              <>
                <div className="option-builder-grid">
                  <div>
                    <Label htmlFor="option-one-name">Option 1 name</Label>
                    <Input id="option-one-name" value={optionOneName} onChange={(event) => setOptionOneName(event.target.value)} placeholder="Size" maxLength={40} />
                  </div>
                  <div>
                    <Label htmlFor="option-one-values">Values, separated by commas</Label>
                    <Input id="option-one-values" value={optionOneValues} onChange={(event) => setOptionOneValues(event.target.value)} placeholder="S, M, L, XL" maxLength={1229} />
                  </div>
                  <div>
                    <Label htmlFor="option-two-name">Option 2 name <small>(optional)</small></Label>
                    <Input id="option-two-name" value={optionTwoName} onChange={(event) => setOptionTwoName(event.target.value)} placeholder="Color" maxLength={40} />
                  </div>
                  <div>
                    <Label htmlFor="option-two-values">Values, separated by commas</Label>
                    <Input id="option-two-values" value={optionTwoValues} onChange={(event) => setOptionTwoValues(event.target.value)} placeholder="Black, White, Blue" maxLength={1229} />
                  </div>
                  <div>
                    <Label htmlFor="option-three-name">Option 3 name <small>(optional)</small></Label>
                    <Input id="option-three-name" value={optionThreeName} onChange={(event) => setOptionThreeName(event.target.value)} placeholder="Material, Width, Pack size…" maxLength={40} />
                  </div>
                  <div>
                    <Label htmlFor="option-three-values">Values, separated by commas</Label>
                    <Input id="option-three-values" value={optionThreeValues} onChange={(event) => setOptionThreeValues(event.target.value)} placeholder="Regular, Wide" maxLength={1229} />
                  </div>
                </div>
                {variantRows.length === 0 && (
                  <p className="variant-builder-help">Add the values you sell, then generate every combination before saving.</p>
                )}
                <Button type="button" variant="outline" onClick={generateVariants}>
                  <RefreshCw /> Generate combinations
                </Button>
                {variantRows.length > 0 && (
                  <div className="variant-matrix-wrap">
                    <div className="variant-summary">
                      <strong>{variantRows.length} variants</strong>
                      <span>{variantRows.reduce((sum, row) => sum + Number(row.stock || 0), 0)} total units</span>
                    </div>
                    <div className="variant-matrix">
                      <div className="variant-matrix-head"><span>Variant</span><span>SKU</span><span>Price</span><span>Stock</span><span>Status</span></div>
                      {variantRows.map((variant, index) => (
                        <div className="variant-matrix-row" key={pathKey(variant.optionValues)}>
                          <strong>{variant.optionValues.join(' / ')}</strong>
                          <Input aria-label={`${variant.optionValues.join(' / ')} SKU`} value={variant.sku} onChange={(event) => setVariantRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, sku: event.target.value.toUpperCase() } : row))} required />
                          <Input aria-label={`${variant.optionValues.join(' / ')} price override`} type="number" min="0" step="0.01" value={variant.price} placeholder={basePrice || 'Base price'} onChange={(event) => setVariantRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, price: event.target.value } : row))} />
                          <Input aria-label={`${variant.optionValues.join(' / ')} stock`} type="number" min="0" step="1" value={variant.stock} onChange={(event) => setVariantRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, stock: event.target.value } : row))} required />
                          <NativeSelect aria-label={`${variant.optionValues.join(' / ')} status`} value={variant.status} onChange={(event) => setVariantRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, status: event.target.value as 'active' | 'archived' } : row))}>
                            <NativeSelectOption value="active">Active</NativeSelectOption>
                            <NativeSelectOption value="archived">Archived</NativeSelectOption>
                          </NativeSelect>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="simple-inventory-field">
                <div>
                  <Label htmlFor="product-stock">Inventory</Label>
                  <Input id="product-stock" type="number" min="0" value={simpleStock} onChange={(event) => setSimpleStock(event.target.value)} />
                </div>
                <p>This product has one default sellable SKU. Turn options on for sizes, colors, or other variations.</p>
              </div>
            )}
          </section>

          <section className="product-form-section">
            <div className="product-form-section-heading">
              <span>5</span>
              <div><strong>Specifications</strong><small>Options create SKUs and inventory; specifications describe the product without multiplying stock.</small></div>
            </div>
            <div className="attribute-builder">
              {attributeRows.length > 0 && (
                <div className="attribute-builder-head" aria-hidden="true">
                  <span>Group</span><span>Name</span><span>Value</span><span>Storefront</span><span />
                </div>
              )}
              {attributeRows.map((attribute, index) => (
                <div className="attribute-builder-row" key={attribute.key}>
                  <Input
                    aria-label={`Specification ${index + 1} group`}
                    value={attribute.groupName}
                    placeholder="Details"
                    maxLength={60}
                    onChange={(event) => setAttributeRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, groupName: event.target.value } : row))}
                  />
                  <Input
                    aria-label={`Specification ${index + 1} name`}
                    value={attribute.name}
                    placeholder="Material, weight, brand…"
                    maxLength={80}
                    onChange={(event) => setAttributeRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, name: event.target.value } : row))}
                  />
                  <Input
                    aria-label={`Specification ${index + 1} value`}
                    value={attribute.value}
                    placeholder="Enter a value"
                    maxLength={500}
                    onChange={(event) => setAttributeRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, value: event.target.value } : row))}
                  />
                  <label className="attribute-visibility">
                    <Switch
                      checked={attribute.visible}
                      onCheckedChange={(visible) => setAttributeRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, visible } : row))}
                      aria-label={`Show ${attribute.name || `specification ${index + 1}`} on the storefront`}
                    />
                    <span>{attribute.visible ? 'Shown' : 'Internal'}</span>
                  </label>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setAttributeRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}
                    aria-label={`Remove ${attribute.name || `specification ${index + 1}`}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              {attributeRows.length === 0 && (
                <p className="attribute-builder-empty">No specifications yet. Add only the details that matter for this product.</p>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={attributeRows.length >= 50}
                onClick={() => setAttributeRows((rows) => [...rows, { key: crypto.randomUUID(), groupName: 'Details', name: '', value: '', visible: true }])}
              >
                <Plus /> {attributeRows.length >= 50 ? '50 specification limit' : 'Add specification'}
              </Button>
            </div>
          </section>

          <section className="product-form-section">
            <div className="product-form-section-heading">
              <span>6</span>
              <div><strong>Product gallery</strong><small>Add up to 12 customer-facing images.</small></div>
            </div>
            <div className="product-form-grid">
              <div className="form-span-2">
                <Label htmlFor="product-images">Upload product pictures</Label>
                <Input id="product-images" name="images" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple />
                <small className="field-help">JPEG, PNG, WebP, or AVIF. Up to 10 MB each.</small>
              </div>
              {!product && (
                <div className="form-span-2">
                  <Label htmlFor="product-image-url">Or start with a remote HTTPS image</Label>
                  <Input id="product-image-url" name="imageUrl" type="url" placeholder="https://…" />
                </div>
              )}
            </div>
            {product?.images.length ? (
              <div className="existing-images">
                {product.images.map((image) => (
                  <div key={image.id}>
                    <img src={image.url} alt={image.alt} />
                    <Button type="button" size="icon-xs" variant="destructive" onClick={() => void removeImage(image.id)} aria-label="Remove image"><X /></Button>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          {error && <p className="form-error" role="alert">{error}</p>}
          <DialogFooter className="product-form-footer">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? <RefreshCw className="spin" /> : <Save />}
              {saving ? 'Saving…' : product ? 'Save changes' : 'Create product'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
