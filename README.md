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

Requires Node.js 22.13+ and pnpm 11.25.0.

Linux or macOS:

```bash
cd commerceos
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm db:local:apply
pnpm dev
```

Windows 11 PowerShell:

```powershell
Set-Location .\commerceos
npm install --global pnpm@11.25.0
pnpm.cmd install --frozen-lockfile
Copy-Item .env.example .env.local
pnpm.cmd db:local:apply
pnpm.cmd dev
```

Open `http://localhost:3000`, or visit `/admin` to configure the store.

Before deploying publicly, replace or protect the demo bootstrap flow, connect production email and customer identity, and implement a hosted payment provider with signed webhooks. MDCart never accepts or stores raw card data; the included checkout uses a mock payment provider.

See [`commerceos/README.md`](./commerceos/README.md) for architecture and
extension points, the [Linux](./commerceos/docs/DEPLOYMENT_LINUX.md) and
[Windows 11](./commerceos/docs/DEPLOYMENT_WINDOWS.md) step-by-step deployment
guides, the [full deployment reference](./commerceos/docs/DEPLOYMENT.md), and
the [downstream licensing guide](./commerceos/docs/LICENSING.md).

## License

MIT. See [`LICENSE`](./LICENSE), [`commerceos/NOTICE.md`](./commerceos/NOTICE.md), [`commerceos/CREDITS.md`](./commerceos/CREDITS.md), and [`commerceos/THIRD_PARTY_NOTICES.md`](./commerceos/THIRD_PARTY_NOTICES.md).
