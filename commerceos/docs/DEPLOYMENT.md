# Deployment and global domain guide

MDCart's supported server runtime is Cloudflare Workers with D1 and R2. This
guide covers local development, a linked OpenAI Site, isolated Cloudflare
staging and production environments, and an operator-owned global DNS name.

Read [CONFIGURATION.md](./CONFIGURATION.md) and [SECURITY.md](../SECURITY.md)
before exposing a deployment publicly.

## 1. Prerequisites

- Node.js 22.13 or newer
- pnpm and the committed `pnpm-lock.yaml`
- For direct deployment: a Cloudflare account, Wrangler authentication, an
  active DNS zone in that account, one D1 database and one R2 bucket per
  persistent environment
- A canonical HTTPS hostname such as `shop.example.com`

Install and validate the locked source:

```bash
pnpm install --frozen-lockfile
pnpm check
```

## 2. Local development

```bash
cp .env.example .env.local
pnpm db:local:apply
pnpm dev
```

Open `http://localhost:3000` for the storefront and
`http://localhost:3000/admin` for administration. Local state is stored in the
ignored `.wrangler` directory. The initial development login is `admin` /
`admin`; the first login requires a new password and owner email verification.

Use local data only for development. Do not point local bindings at production
resources.

After the first login, open the Retail hub. A fresh database creates a main
location and register when retail defaults are first needed. For a local
end-to-end check, open a shift, sell a test SKU with a cash tender, inspect the
receipt, issue its full refund, and close the shift. Then stage the
[example inventory CSV](./examples/inventory-import.csv) and review it without
applying, or apply it only to disposable local data.

## 3. Deploy through OpenAI Sites

The checked-in `.openai/hosting.json` links this checkout to the original Site
and requests managed `DB` and `FILES` resources. A fork must create a new Site
so the platform gives it a new project ID and isolated resources. Do not copy
or reuse another operator's Site credentials, project ID, D1 database, or R2
bucket.

Before signing into a fresh hosted database—or upgrading one that still has the
historical forced-reset `admin` password—add a unique
`MDCART_BOOTSTRAP_PASSWORD` secret of at least 32 UTF-8 bytes in the Site's
hosting environment settings. Sign in with username `admin` and that one-time
secret, complete the forced password replacement, then remove the secret and
deploy once more. Hosted deployments never accept `admin` / `admin`.

OpenAI Sites supplies its own HTTPS hostname and deployment lifecycle. After a
Site has been published, an owner can attach a bare custom hostname in the
Site's hosting settings. The domain setup response supplies the exact records
to create: a CNAME target for a subdomain or A-record targets for a zone apex,
plus the required platform and certificate-validation records. Copy those
values exactly; do not create a guessed CNAME to the default Sites hostname.

Wait until the custom-domain status and certificate are active, set the Site's
production `NEXT_PUBLIC_SITE_URL` environment value to the new HTTPS origin,
then deploy a new version so canonical and social metadata use that hostname.
Keep production environment values in Sites rather than `.openai/hosting.json`
or a committed `.env` file.

The direct Cloudflare flow below is an alternative for operators who want to
own the Worker, D1, R2, and DNS configuration in their Cloudflare account.

## 4. Prepare direct Cloudflare environments

Authenticate and create isolated storage:

```bash
pnpm exec wrangler login
pnpm exec wrangler d1 create mdcart-staging
pnpm exec wrangler d1 create mdcart-production
pnpm exec wrangler r2 bucket create mdcart-staging-files
pnpm exec wrangler r2 bucket create mdcart-production-files
cp wrangler.deploy.example.jsonc wrangler.deploy.jsonc
```

Edit the ignored `wrangler.deploy.jsonc`:

1. Replace both D1 database ID placeholders with the IDs returned by Wrangler.
2. Replace `staging-shop.example.com` and `shop.example.com` with hostnames in
   an active Cloudflare zone owned by the same account.
3. Keep the binding names exactly `DB` and `FILES`.
4. Keep staging and production database and bucket names different.
5. Set each `NEXT_PUBLIC_SITE_URL` to its exact HTTPS origin, with no path.

Wrangler `vars` and service bindings are environment-specific and must be
repeated for staging and production.

## 5. Build, migrate, and deploy staging

Build with the same public origin that staging will use:

```bash
NEXT_PUBLIC_SITE_URL=https://staging-shop.example.com pnpm build
pnpm exec wrangler deploy --dry-run --config wrangler.deploy.jsonc --env staging
pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.deploy.jsonc --env staging
pnpm exec wrangler deploy --config wrangler.deploy.jsonc --env staging
```

Test a clean bootstrap, uploads, inventory changes, storefront checkout, Retail
hub roles, location/register creation, shifts, POS sales and full refunds,
supplier purchase-order receiving, bulk-import review/application, email and
payment adapters, and rollback procedures in staging. Restrict staging with
Cloudflare Access or equivalent authentication; a hard-to-guess URL is not
access control.

Configure the one-time owner secret in staging before login:

```bash
pnpm exec wrangler secret put MDCART_BOOTSTRAP_PASSWORD --config wrangler.deploy.jsonc --env staging
```

Use a unique value containing at least 32 UTF-8 bytes. This also rotates a
legacy forced-reset `admin` hash during an upgrade. Sign in as `admin`, complete
the forced password replacement, and remove the bootstrap secret:

```bash
pnpm exec wrangler secret delete MDCART_BOOTSTRAP_PASSWORD --config wrangler.deploy.jsonc --env staging
```

## 6. Prepare and deploy production

Before the first public deployment:

- connect a real transactional email flow and remove client-visible codes;
- connect a hosted payment provider and signed, idempotent webhooks;
- keep retail non-cash tenders disabled until the external payment
  terminal/provider adapter described below verifies capture server-side;
- configure a new production-only `MDCART_BOOTSTRAP_PASSWORD`, complete the
  forced first-owner reset, and delete the secret immediately afterward;
- configure edge rate limits for authentication, checkout, and uploads;
- establish monitoring, retention, D1 recovery, and an independent R2 backup;
- assign `cashier` and `purchasing` only to staff who need those duties,
  and rehearse shift close, refund, receiving, and import recovery procedures;
- confirm privacy, tax, shipping, accessibility, and regulated-product duties
  for the store's jurisdictions.

Back up D1 and R2 together. D1 contains references to media objects stored in
R2, so restoring only one service can leave missing images or orphaned files.
Record a D1 Time Travel bookmark or export before applying a production
migration, and retain a separately versioned copy of the live R2 objects.

Then build and deploy the exact production configuration:

```bash
NEXT_PUBLIC_SITE_URL=https://shop.example.com pnpm build
pnpm exec wrangler deploy --dry-run --config wrangler.deploy.jsonc --env production
pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.deploy.jsonc --env production
pnpm exec wrangler deploy --config wrangler.deploy.jsonc --env production
pnpm exec wrangler secret put MDCART_BOOTSTRAP_PASSWORD --config wrangler.deploy.jsonc --env production
```

Use that secret once to create the owner and complete the required password
reset, then delete it with `pnpm exec wrangler secret delete
MDCART_BOOTSTRAP_PASSWORD --config wrangler.deploy.jsonc --env production`.
Until the secret exists, a fresh production database rejects all first-owner
logins, including `admin` / `admin`.

Migrations are forward SQL files under `drizzle/`; MDCart does not generate an
automatic down migration. A database rollback is a restore operation and must
be rehearsed with the matching R2 backup.

### Retail production acceptance

Apply migrations before deploying the application version that exposes the
Retail hub. The same D1 database stores the online catalog and retail
locations, inventory, registers, shifts, sales, suppliers, purchase orders,
and import jobs. Do not split those records across independently restored
databases.

In staging, validate at least the following with production-like roles and
configuration:

1. Confirm the main location/register or create the intended store, warehouse,
   and virtual locations with correct IANA timezones and tax rates.
2. As a `cashier`, open a register shift, verify another cashier cannot use it,
   scan/search a SKU or barcode, complete a cash sale, review the receipt,
   perform the supported full refund, and close the shift with an explainable
   variance.
3. As `purchasing`, create a supplier and purchase order, partially receive
   it, finish receiving it, and verify stock moved only at the destination
   location.
4. Stage CSV/TSV/JSON/XLSX imports in catalog-upsert, inventory-snapshot, and
   inventory-delta modes. Correct every error and review category warnings
   before applying. The current server limit is 2,000 reviewed rows per staged
   job, so test the operator's file-splitting procedure for larger feeds.
5. Confirm rejected and repeated requests do not create duplicate sales,
   receipts, inventory movements, refunds, or import application. Preserve
   idempotency headers across safe client retries.

Staging an import writes only a review job; applying a ready, error-free job is
the separate mutation. Retain the original file, staged summary, operator, and
job ID for reconciliation. Test backups and restore with open/closed shifts,
partially received purchase orders, and completed import jobs present.

### External POS payment-terminal boundary

The deployed MDCart Worker records cash tenders but rejects non-cash POS
tenders. It does not talk directly to a card reader and must not receive raw
cardholder data. Enabling non-cash requires a trusted server-side terminal
adapter that must:

- use the terminal/provider's PCI-compliant SDK or hosted workflow;
- authorize or capture before writing the MDCart sale;
- verify capture server-side; a browser-supplied provider name/reference must
  never be sufficient;
- verify signatures, reconcile timeouts, and use provider-side idempotency;
- map approved refunds to the provider while keeping MDCart's refund and stock
  records consistent; and
- prevent a declined or indeterminate payment from completing a sale.

Keep terminal credentials and webhook secrets in each environment's secret
store, never in `NEXT_PUBLIC_` values, Wrangler `vars`, committed files, or
the browser bundle. MDCart does not currently implement terminal discovery,
pairing, key management, settlement, or chargeback handling; the operator's
adapter and procedures must own those functions.

## 7. Attach the global DNS name

The deployment template uses a Cloudflare Worker Custom Domain:

```jsonc
"routes": [
  {
    "pattern": "shop.example.com",
    "custom_domain": true
  }
]
```

For this mode, the Worker is the origin. The zone must be active in the same
Cloudflare account. Cloudflare creates the required DNS record and provisions
TLS; do not add a competing A, AAAA, or CNAME record for that hostname. Remove
or move an existing conflicting record before deployment. Custom Domains use
exact hostnames rather than wildcard patterns.

Choose one canonical hostname. Redirect `www.example.com` to `example.com`, or
the reverse, with a Cloudflare Redirect Rule instead of serving the same store
on both. MDCart's admin cookie is host-only and its metadata advertises the
single `NEXT_PUBLIC_SITE_URL` origin.

Use that same canonical HTTPS origin in any payment-provider or terminal
callback/webhook allowlist. DNS attachment changes routing only: it does not
copy D1/R2 data, create retail locations, or move terminal secrets between
local, staging, and production. Rebuild after changing
`NEXT_PUBLIC_SITE_URL`, and revalidate signed callbacks and cookie behavior
on the final hostname.

After certificate issuance and DNS propagation, verify:

```bash
dig +short shop.example.com
curl --fail --show-error --head https://shop.example.com/
curl --fail --show-error https://shop.example.com/api/storefront
```

Also verify `/admin`, a product page's canonical/social metadata, image upload
and retrieval, an invitation URL, and a checkout return URL. Do not place a
CDN cache rule over personalized or mutating routes.

For one independently hosted store, a Worker Custom Domain is sufficient.
Serving many merchant-owned vanity domains from a multi-tenant service is a
different architecture: it requires tenant isolation in MDCart and a managed
custom-hostname product such as Cloudflare for SaaS, including ownership and
certificate validation for every customer domain.

## 8. Updates and rollback

For each release:

1. Install from the lockfile and run `pnpm check` and `pnpm licenses:check`.
2. Back up production D1 and R2 as one recovery point.
3. Build once for the target canonical origin.
4. Dry-run the Worker upload.
5. Apply migrations to staging, test, then apply them to production.
6. Deploy the matching Worker artifact.
7. Smoke-test the storefront, admin login, media, inventory, checkout, Retail
   hub location/register selection, shift open/close, POS sale/refund,
   purchase-order receiving, and a review-only bulk import.
8. Retain the previous Worker version and the pre-migration data recovery point.

Rolling back only the Worker does not reverse a schema or data migration.
Restore application code, D1, and R2 to a compatible point.

## Other hosting providers

The current server imports `cloudflare:workers` and calls D1 and R2 binding
APIs directly. A generic Node.js server, VPS, Docker host, or another edge
provider is not a drop-in target. Porting requires database, object-storage,
asset-serving, and identity adapters plus a new build/deployment entrypoint.
Do not substitute a SQLite file path or public upload directory and call it a
production deployment.

## Official references

- [Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/)
- [Wrangler configuration and Custom Domains](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare Worker Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [D1 environment isolation](https://developers.cloudflare.com/d1/configuration/environments/)
- [R2 Worker bindings](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/)
- [Cloudflare for SaaS custom hostnames](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/)
