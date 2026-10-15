'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { CART_STORAGE_KEY } from '@/lib/branding';
import type { CartLine, StorefrontProduct, StorefrontVariant } from '@/lib/domain';

const STORAGE_KEY = CART_STORAGE_KEY;

type CartContextValue = {
  lines: CartLine[];
  count: number;
  subtotalCents: number;
  ready: boolean;
  addProduct: (
    product: StorefrontProduct,
    variant: StorefrontVariant,
    quantity?: number,
  ) => void;
  removeLine: (lineId: string) => void;
  setQuantity: (lineId: string, quantity: number) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as CartLine[];
        if (Array.isArray(parsed)) setLines(parsed.filter(validLine));
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (ready) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  }, [lines, ready]);

  const addProduct = useCallback((product: StorefrontProduct, variant: StorefrontVariant, quantity = 1) => {
    if (variant.stock < 1 || variant.status !== 'active') return;
    const safeQuantity = Math.max(1, Math.min(25, Math.trunc(quantity)));
    setLines((current) => {
      const existing = current.find((line) => line.lineId === variant.id);
      if (existing) {
        return current.map((line) =>
          line.lineId === variant.id
            ? {
                ...line,
                name: product.name,
                variantTitle: variant.isDefault ? null : variant.title,
                optionSummary: [...variant.optionValues]
                  .sort((a, b) => a.position - b.position)
                  .map((value) => `${value.name}: ${value.value}`)
                  .join(' · '),
                priceCents: variant.priceCents,
                imageUrl: product.images[0]?.url ?? '',
                sku: variant.sku,
                quantity: Math.min(
                  Math.min(variant.stock, 25),
                  line.quantity + safeQuantity,
                ),
                maxQuantity: variant.stock,
              }
            : line,
        );
      }
      return [
        ...current,
        {
          lineId: variant.id,
          productId: product.id,
          variantId: variant.id,
          name: product.name,
          variantTitle: variant.isDefault ? null : variant.title,
          optionSummary: [...variant.optionValues]
            .sort((a, b) => a.position - b.position)
            .map((value) => `${value.name}: ${value.value}`)
            .join(' · '),
          priceCents: variant.priceCents,
          quantity: Math.min(Math.min(variant.stock, 25), safeQuantity),
          maxQuantity: variant.stock,
          imageUrl: product.images[0]?.url ?? '',
          sku: variant.sku,
        },
      ];
    });
  }, []);

  const removeLine = useCallback((lineId: string) => {
    setLines((current) => current.filter((line) => line.lineId !== lineId));
  }, []);

  const setQuantity = useCallback((lineId: string, quantity: number) => {
    setLines((current) =>
      current.flatMap((line) => {
        if (line.lineId !== lineId) return [line];
        const nextQuantity = Math.max(
          0,
          Math.min(25, line.maxQuantity, Math.trunc(quantity)),
        );
        return nextQuantity === 0 ? [] : [{ ...line, quantity: nextQuantity }];
      }),
    );
  }, []);

  const clear = useCallback(() => setLines([]), []);
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const subtotalCents = lines.reduce(
    (sum, line) => sum + line.priceCents * line.quantity,
    0,
  );

  const value = useMemo(
    () => ({
      lines,
      count,
      subtotalCents,
      ready,
      addProduct,
      removeLine,
      setQuantity,
      clear,
    }),
    [lines, count, subtotalCents, ready, addProduct, removeLine, setQuantity, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside CartProvider.');
  return context;
}

function validLine(value: unknown): value is CartLine {
  if (!value || typeof value !== 'object') return false;
  const line = value as Partial<CartLine>;
  return (
    typeof line.productId === 'string' &&
    typeof line.lineId === 'string' &&
    typeof line.variantId === 'string' &&
    typeof line.name === 'string' &&
    (line.variantTitle === null || typeof line.variantTitle === 'string') &&
    typeof line.optionSummary === 'string' &&
    Number.isSafeInteger(line.priceCents) &&
    Number.isSafeInteger(line.quantity) &&
    Number(line.quantity) > 0 &&
    Number.isSafeInteger(line.maxQuantity) &&
    Number(line.maxQuantity) >= Number(line.quantity) &&
    typeof line.imageUrl === 'string' &&
    typeof line.sku === 'string'
  );
}
