# MDCart

MDCart is an open-source ecommerce foundation with a fast customer storefront and an end-to-end store control center. It includes product and image management, inventory history, customer and team administration, order workflows, store settings, a 288-preset theme studio, background/poster uploads, audit history, and a mock checkout provider that can be replaced by a live payment adapter.

The application lives in [`commerceos`](./commerceos).

## Highlights

- Responsive storefront, product galleries, guest cart, mock checkout, customer account, and order history
- Admin dashboard for catalog, stock, orders, customers, staff invitations, store content, appearance, and an owner-protected clean-slate data reset
- D1-backed data with checked-in Drizzle migrations and R2-backed product/background media
- Secure session cookies, PBKDF2 password hashing, one-time verification tokens, audit events, and idempotent checkout
- Default demo login `admin` / `admin`, with mandatory password replacement and owner email verification before administration is unlocked
- Provider interfaces for payments and browser-facing WebMCP tools for cart actions

## Quick start

Requires Node.js 22.13+ and pnpm.

```bash
cd commerceos
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm db:local:apply
pnpm dev
```

Open `http://localhost:3000`, or visit `/admin` to configure the store.

Before deploying publicly, replace or protect the demo bootstrap flow, connect production email and customer identity, and implement a hosted payment provider with signed webhooks. MDCart never accepts or stores raw card data; the included checkout uses a mock payment provider.

See [`commerceos/README.md`](./commerceos/README.md) for architecture and extension points, [`commerceos/docs/DEPLOYMENT.md`](./commerceos/docs/DEPLOYMENT.md) for environment and global-domain setup, and [`commerceos/docs/LICENSING.md`](./commerceos/docs/LICENSING.md) for downstream licensing guidance.

## License

MIT. See [`LICENSE`](./LICENSE), [`commerceos/NOTICE.md`](./commerceos/NOTICE.md), [`commerceos/CREDITS.md`](./commerceos/CREDITS.md), and [`commerceos/THIRD_PARTY_NOTICES.md`](./commerceos/THIRD_PARTY_NOTICES.md).
