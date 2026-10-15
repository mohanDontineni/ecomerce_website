# MDCart — open commerce platform

MDCart is a modular, MIT-licensed ecommerce application built with React 19, Vinext, Cloudflare Workers, D1, R2, Drizzle, and Tailwind CSS. It is designed as a production-oriented foundation: the included commerce flow works end to end with a mock payment provider, while vendor-specific payment, shipping, tax, identity, and email services remain replaceable adapters.

MDCart is a reference implementation rather than a turnkey regulated-commerce service. Evaluate the current Vinext runtime and complete the production integrations and hardening described in [SECURITY.md](./SECURITY.md) and [the deployment guide](./docs/DEPLOYMENT.md) before accepting live orders.

## Included modules

- **Storefront:** department/category discovery, specification-aware search, grouped product details, image galleries, option selection, variant-aware cart and checkout, customer account, and order history
- **Control center:** overview, reusable category paths, 50+ grouped retail product templates, up to three configurable option dimensions, grouped public/internal specifications, per-variant SKUs and inventory, multi-image uploads, stock ledger, order workflow, customer status, team invitations and roles, store copy/settings, audit log, and appearance studio
- **Identity:** session cookies, PBKDF2 password hashing, forced bootstrap-password replacement, email verification, team invitations, logout, and server-side route guards
- **Customization:** 12 palettes × 6 moods × 4 shape systems for 288 maintained combinations, custom colors, background/poster assets, overlay control, preview, publishing, and version history
- **Commerce:** integer-cent money values, server-authoritative variant pricing, SKU-level stock validation, immutable order option snapshots, idempotency keys, customer aggregates, and a provider-neutral payment interface
- **Storage:** D1 relational records and R2 object media, selected through `.openai/hosting.json`

## Run locally

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm db:local:apply
pnpm dev
```

Storefront: `http://localhost:3000`

Admin: `http://localhost:3000/admin`

Demo bootstrap credentials: `admin` / `admin`

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

## Configuration and deployment

- [Configuration reference](./docs/CONFIGURATION.md) — bindings, variables, environment isolation, authentication, and adapter boundaries
- [Deployment and global domain guide](./docs/DEPLOYMENT.md) — local, OpenAI Sites, Cloudflare staging/production, migrations, custom DNS, TLS, backups, and rollback
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

## Architecture

The UI is organized under `app/` and `components/`. Server-only database, seed, catalog, and authentication helpers live under `lib/server/`. Payment contracts live under `lib/payments/`. API handlers in `app/api/` validate requests and keep privileged mutations behind server-side session checks.

The mock payment adapter implements the same boundary expected of a real provider. A production adapter should create provider sessions, verify signed webhooks against the raw request body, persist payment attempts separately, and retain the existing idempotency behavior. Do not send raw card data through MDCart routes.

Product and theme media are written to R2 with generated object keys. Before exposing uploads to untrusted public users, add malware scanning and image re-encoding in the media adapter in addition to the current MIME and size validation.

## Deployment and operations

The checked-in Sites manifest binds D1 as `DB` and R2 as `FILES`. Apply the checked-in Drizzle migrations in each isolated environment, then deploy the compiled Worker and client assets. Use a private first deployment while replacing bootstrap provisioning and wiring production email, identity, and payment adapters. For an operator-owned worldwide hostname, follow the Worker Custom Domain procedure in [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).

For serious multi-store SaaS use, add tenant IDs and centralized tenant authorization to every business record. The current distribution is a single-store deployment that can be independently hosted and customized by each merchant.

## Security boundaries

- The requested `admin` / `admin` credential exists only until the first successful password replacement. Treat it as a demo/bootstrap convenience, not a production secret.
- Sessions and one-time codes are stored as hashes and expire.
- Administration APIs require both password replacement and verified owner email.
- Monetary totals and stock checks are calculated on the server.
- The mock provider never collects payment-card data.

See [`SECURITY.md`](./SECURITY.md) for reporting and production-hardening guidance.

## License and credits

MDCart is distributed under the [MIT License](./LICENSE). Keep the license and notices when copying or distributing the project.

- [NOTICE.md](./NOTICE.md) explains the scope of the project license and merchant-provided content.
- [CREDITS.md](./CREDITS.md) acknowledges the major open-source projects, fonts, and project assets.
- [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) inventories the installed dependency graph and preserves upstream license and notice texts.
- [docs/LICENSING.md](./docs/LICENSING.md) contains the maintainer and downstream-distribution checklist.

Regenerate the third-party report after dependency changes with `pnpm licenses:generate`, and verify it in release checks with `pnpm licenses:check`.
