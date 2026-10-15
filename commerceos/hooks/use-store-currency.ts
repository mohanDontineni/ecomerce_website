import { useStorePresentation } from './use-store-presentation';

export function useStoreCurrency(): string {
  return useStorePresentation().store.currency;
}
