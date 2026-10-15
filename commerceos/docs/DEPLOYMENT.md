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

## 3. Deploy through OpenAI Sites

The checked-in `.openai/hosting.json` links this checkout to the original Site
and requests managed `DB` and `FILES` resources. A fork must create a new Site
so the platform gives it a new project ID and isolated resources. Do not copy
or reuse another operator's Site credentials, project ID, D1 database, or R2
bucket.

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

Test a clean bootstrap, uploads, inventory changes, checkout, email and payment
adapters, and rollback procedures in staging. Restrict staging with Cloudflare
Access or equivalent authentication; a hard-to-guess URL is not access
control.

## 6. Prepare and deploy production

Before the first public deployment:

- connect a real transactional email flow and remove client-visible codes;
- connect a hosted payment provider and signed, idempotent webhooks;
- replace or protect the `admin` / `admin` bootstrap flow;
- configure edge rate limits for authentication, checkout, and uploads;
- establish monitoring, retention, D1 recovery, and an independent R2 backup;
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
```

Migrations are forward SQL files under `drizzle/`; MDCart does not generate an
automatic down migration. A database rollback is a restore operation and must
be rehearsed with the matching R2 backup.

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
7. Smoke-test the storefront, admin login, media, inventory, and checkout.
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
