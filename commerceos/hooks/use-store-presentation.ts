'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_STORE_TITLE } from '@/lib/branding';
import type { ThemeSettings } from '@/lib/domain';

type StorePresentation = {
  store: {
    title: string;
    currency: string;
    logoUrl: string | null;
    published: boolean;
  };
  theme: ThemeSettings | null;
};

const fallback: StorePresentation = {
  store: {
    title: DEFAULT_STORE_TITLE,
    currency: 'USD',
    logoUrl: null,
    published: true,
  },
  theme: null,
};

export function useStorePresentation(): StorePresentation {
  const [presentation, setPresentation] = useState(fallback);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/store-presentation', { signal: controller.signal })
      .then(async (response) =>
        response.ok ? ((await response.json()) as StorePresentation) : null,
      )
      .then((payload) => {
        if (payload?.store?.title && /^[A-Z]{3}$/.test(payload.store.currency)) {
          setPresentation(payload);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return presentation;
}
