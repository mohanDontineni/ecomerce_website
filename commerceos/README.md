# MDCart — open commerce platform

MDCart is a modular, MIT-licensed ecommerce application built with React 19, Vinext, Cloudflare Workers, D1, R2, Drizzle, and Tailwind CSS. It is designed as a production-oriented foundation: the included commerce flow works end to end with a mock payment provider, while vendor-specific payment, shipping, tax, identity, and email services remain replaceable adapters.

MDCart is a reference implementation rather than a turnkey regulated-commerce service. Evaluate the current Vinext runtime and complete the production integrations and hardening described in [SECURITY.md](./SECURITY.md) and [the deployment guide](./docs/DEPLOYMENT.md) before accepting live orders.

## Included modules

- **Storefront:** department/category discovery, specification-aware search, grouped product details, image galleries, option selection, variant-aware cart and checkout, customer account, and order history
- **Control center:** overview, reusable category paths, 50+ grouped retail product templates, up to three configurable option dimensions, grouped public/internal specifications, per-variant SKUs and inventory, multi-image uploads, stock ledger, order workflow, customer status, team invitations and roles, store copy/settings, audit log, appearance studio, and an owner-only clean-slate reset
- **Retail hub:** location-aware inventory and movement ledger, registers and cash shifts, barcode/SKU point of sale, downloadable individual/grouped bills, shift/register/product reporting with CSV exports, receipt-level sales history and full refunds, suppliers, purchase orders, partial receiving, and review-first bulk catalog/inventory imports
- **Identity:** session cookies, PBKDF2 password hashing, forced bootstrap-password replacement, email verification, team invitations, logout, and server-side route guards
- **Customization:** 12 palettes × 6 moods × 4 shape systems for 288 maintained combinations, custom colors, background/poster assets, overlay control, preview, publishing, and version history
- **Commerce:** integer-cent money values, server-authoritative variant pricing, SKU-level stock validation, immutable order option snapshots, idempotency keys, customer aggregates, and a provider-neutral payment interface
- **Storage:** D1 relational records and R2 object media, selected through `.openai/hosting.json`

## Run locally

Install Node.js 22.13 or newer and pnpm 11.25.0. The commands below are for
Linux/macOS; use the [Windows 11 PowerShell guide](./docs/DEPLOYMENT_WINDOWS.md)
for native Windows commands.

```bash
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm db:local:apply
pnpm dev
```

Storefront: `http://localhost:3000`

Admin: `http://localhost:3000/admin`

Local-development bootstrap credentials: `admin` / `admin`

On first login, MDCart restricts administration until the owner chooses a new password and verifies an email address. Local development displays the verification code in the setup flow; connect a transactional email adapter before public production use.

## Quality commands

```bash
pnpm lint
pnpm typecheck
pnpm build
```

Create a new migration after changing `db/schema.ts`:

```bash
pnpm db:generate
```

Database structure is migration-owned. Runtime initialization inserts only required store and theme defaults with `INSERT OR IGNORE`; new catalogs start empty.

## Clean-slate store reset

The store owner can open **Store settings → Danger zone** to delete every product, managed product/theme upload, online order, POS sale, purchase order, inventory movement, import job, register shift, and transaction idempotency record. The action requires the owner's current password plus the exact confirmation phrase shown in the dialog.

The reset preserves user and team accounts, customer profiles, store copy, theme colors, categories, suppliers, locations, and registers; customer order and spending totals return to zero. It also retains security and configuration audit history and adds one aggregate reset event, while removing catalog and transaction audit details. Export records required for accounting or tax retention first. Deleting MDCart's local payment record does not refund or cancel an external payment-provider charge.

## Configuration and deployment

- [Configuration reference](./docs/CONFIGURATION.md) — bindings, variables, environment isolation, authentication, and adapter boundaries
- [Deployment and global domain guide](./docs/DEPLOYMENT.md) — local, OpenAI Sites, Cloudflare staging/production, migrations, custom DNS, TLS, backups, and rollback
- [Linux deployment runbook](./docs/DEPLOYMENT_LINUX.md) — supported prerequisites and copy/paste staging and production steps
- [Windows 11 deployment runbook](./docs/DEPLOYMENT_WINDOWS.md) — native PowerShell setup, deployment, and verification
- [`wrangler.deploy.example.jsonc`](./wrangler.deploy.example.jsonc) — separate staging and production D1/R2 resources and Custom Domains
- [Security policy](./SECURITY.md) — production-hardening requirements and vulnerability reporting

Every persistent environment needs its own D1 database bound as `DB` and its own private R2 bucket bound as `FILES`. Set `NEXT_PUBLIC_SITE_URL` to the exact public HTTPS origin before each staging or production build. Never deploy the generated `dist/server/wrangler.json` unchanged; it intentionally contains local placeholder resources.

## Modular catalog model

MDCart keeps different product concerns separate so the same codebase can serve clothing, footwear, jewelry, health and wellness, home goods, electronics, and mixed catalogs:

- **Categories** place products in an editable tree such as `Women → Apparel → Shirts` or `Health → Wellness → Supplements`.
- **Options** create sellable SKUs and inventory combinations. A product can use up to three dimensions—such as Size/Color/Material, Metal/Size/Stone, or Form/Strength/Pack size—and up to 100 variants.
- **Specifications** describe a product without multiplying inventory. Merchants can create arbitrary groups and facts, choose which are storefront-visible, and search them from the catalog.
- **Product templates** provide 50+ grouped starting points spanning fashion, electronics, home, grocery, health, beauty, toys, media, automotive, industrial, and specialty retail. Selecting one copies its category path, option dimensions, and specifications; it never locks the product, and every copied field remains editable.

Regulated templates—including pharmacy, alcohol, medical products, gift cards, automotive fitment, and digital fulfillment—are catalog helpers rather than complete compliance or fulfillment systems. Merchants must add the authorization, jurisdiction, labeling, verification, fraud-control, and fulfillment workflows required for their market before production use.

## Retail hub and bulk inventory

The admin Retail hub extends the online catalog into store operations without creating a second product database:

- **POS** sells the same variants used by the storefront. Choose a location and register, open a shift with its opening cash, find items by SKU or barcode, build a cart, and record Cash, Venmo, Zelle, PayPal, or a described Other payment. Only Cash changes drawer expectations; the other choices are cashier-confirmed bookkeeping records and do not transfer or verify funds.
- **Sales** preserves receipt, location, register, cashier, line, tax, discount, tender, and shift details. The current refund workflow is a full refund: it records reversing tenders, returns quantities to the sale location, and updates shift cash totals where applicable.
- **Reports & bills** provides an independent date, location, register, and shift scope. It reconciles gross sales, refunds, net sales, units, opening/expected/closing cash, and variance and drills each shift into its products and bills. Owners and administrators can bulk-download grouped printable bills and export sales lines, products, shifts, and every configured register as CSV; users with sales access can download individual bills, with cashiers limited to their own. Printable HTML bills can be opened in a browser and saved as PDF.
- **Purchasing** manages suppliers and submitted purchase orders. Receiving can be partial, adds stock only to the destination location, and leaves a location-inventory movement trail.
- **Locations** separates on-hand quantities by store or warehouse, supports multiple registers, records exact-SKU adjustments, and displays the immutable movement ledger. The first retail visit creates a main location and register for an existing single-location catalog.

The Bulk import tab accepts CSV, TSV, JSON, and XLSX files in three modes: catalog upsert, inventory snapshot (replace on-hand with a counted quantity), and inventory delta (add or subtract a signed quantity). MDCart parses and maps the file in the browser, groups variants, resolves safe cross-sheet item-ID collisions, separates blocking errors from review guidance, and requires a staged review before anything is applied. A blank catalog price is imported as zero and displayed as `Free`; inventory-only modes never change prices. A staged job currently accepts 1–2,000 reviewed rows. See the [import configuration contract](./docs/CONFIGURATION.md#bulk-inventory-import-contract) and [sample catalog CSV](./docs/examples/inventory-import.csv).

For deterministic variant families, give every child row the same `parentSku`; that parent identifier must differ from every child `sku`. When it is absent, contiguous rows with options and the same normalized name, brand, and category are auto-grouped for review, can inherit shared parent fields, and receive a stable internal parent identifier. Ambiguous duplicate inferred families are rejected until an explicit parent is supplied. Interrupted jobs can be resumed safely from Import history. Rows without variant evidence stay independent. Owners and admins have every retail permission, including bulk report export. The `cashier` role can sell only against a shift that cashier opened, manage that shift, view inventory, and view sales; the `purchasing` role can manage inventory, suppliers and purchase orders, run catalog imports, and view sales/reports but cannot bulk-export reports.

## Architecture

The UI is organized under `app/` and `components/`. Server-only database, seed, catalog, authentication, and retail helpers live under `lib/server/`. Payment contracts live under `lib/payments/`. API handlers in `app/api/` validate requests and keep privileged mutations behind server-side session checks. Retail sales, shifts, suppliers, purchase orders, receiving, refunds, and import application are server-authoritative and append audit or inventory-movement records.

The mock payment adapter implements the same boundary expected of a real provider. A production adapter should create provider sessions, verify signed webhooks against the raw request body, persist payment attempts separately, and retain the existing idempotency behavior. Do not send raw card data through MDCart routes.

Retail POS accepts physical Cash and cashier-confirmed Venmo, Zelle, PayPal,
or described Other records. MDCart does not transfer, verify, settle, reconcile,
or refund those external funds; staff must confirm them outside MDCart. The API
still rejects card, gift-card, and store-credit tenders until a trusted
server-side adapter authorizes, captures, and verifies them. Such an adapter
must never send a PAN, CVV, PIN, track data, or terminal encryption key through
MDCart routes.

Product and theme media are written to R2 with generated object keys. Before exposing uploads to untrusted public users, add malware scanning and image re-encoding in the media adapter in addition to the current MIME and size validation.

## Deployment and operations

The checked-in Sites manifest binds D1 as `DB` and R2 as `FILES`. Apply the checked-in Drizzle migrations in each isolated environment, then deploy the compiled Worker and client assets. Use a private first deployment while replacing bootstrap provisioning and wiring production email, identity, and payment adapters. For copy/paste operator procedures use the [Linux](./docs/DEPLOYMENT_LINUX.md) or [Windows 11](./docs/DEPLOYMENT_WINDOWS.md) runbook; for an operator-owned worldwide hostname and architectural detail, follow [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).

For serious multi-store SaaS use, add tenant IDs and centralized tenant authorization to every business record. The current distribution is a single-store deployment that can be independently hosted and customized by each merchant.

## Security boundaries

- `admin` / `admin` is enabled only by the local development server on a loopback hostname. Hosted first-owner setup requires a 32-byte-or-longer `MDCART_BOOTSTRAP_PASSWORD` runtime secret, which should be deleted after the forced password replacement.
- Sessions and one-time codes are stored as hashes and expire.
- Administration APIs require both password replacement and verified owner email.
- Monetary totals and stock checks are calculated on the server.
- The mock provider never collects payment-card data.
- Retail checkout requires the cashier's own open register shift and an actor-scoped idempotency key; location inventory and cash expectations are updated on the server.

See [`SECURITY.md`](./SECURITY.md) for reporting and production-hardening guidance.

## License and credits

MDCart is distributed under the [MIT License](./LICENSE). Keep the license and notices when copying or distributing the project.

- [NOTICE.md](./NOTICE.md) explains the scope of the project license and merchant-provided content.
- [CREDITS.md](./CREDITS.md) acknowledges the major open-source projects, fonts, and project assets.
- [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) inventories the installed dependency graph and preserves upstream license and notice texts.
- [docs/LICENSING.md](./docs/LICENSING.md) contains the maintainer and downstream-distribution checklist.

Regenerate the third-party report after dependency changes with `pnpm licenses:generate`, and verify it in release checks with `pnpm licenses:check`.
