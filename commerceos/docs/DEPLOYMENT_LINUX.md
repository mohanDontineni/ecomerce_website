# Deploy MDCart from Linux

This runbook covers local development and a production deployment operated
from a supported Linux workstation or CI runner. MDCart's production runtime
is **Cloudflare Workers with D1 and R2**. It is not currently a drop-in Node.js
service for a Linux VPS, systemd, Docker, or another database/object store.

Use [DEPLOYMENT.md](./DEPLOYMENT.md) for the architecture, security checklist,
backups, DNS, and rollback policy. Commands below start in a terminal.

## 1. Install the prerequisites

Install:

- Git
- Node.js 22.13.0 or newer
- a Linux distribution with glibc 2.35 or newer
- a Cloudflare account with an active DNS zone for direct production hosting

Confirm the host and install the package manager version pinned by MDCart:

```bash
git --version
node --version
ldd --version | head -n 1
npm install --global pnpm@11.25.0
pnpm --version
```

Do not continue if Node.js is older than 22.13.0 or glibc is older than 2.35.

## 2. Clone, validate, and run locally

```bash
git clone https://github.com/mohanDontineni/ecomerce_website.git
cd ecomerce_website/commerceos
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm deploy:doctor
pnpm db:local:apply
pnpm dev
```

Open `http://localhost:3000` and `http://localhost:3000/admin`. Local-only
bootstrap credentials are `admin` / `admin`; the first login requires a new
password and owner email verification. Stop the development server with
`Ctrl+C`.

Before a deployment, run the complete release check:

```bash
pnpm deploy:check
```

It lints, type-checks, builds, checks the Cloudflare bindings, and confirms
that the deployable output exists. Release maintainers should additionally run
`pnpm licenses:check` on the platform producing their release artifact.

## 3. Authenticate and create isolated resources

Interactive workstation authentication:

```bash
pnpm exec wrangler login
pnpm exec wrangler whoami
```

Create separate storage for staging and production:

```bash
pnpm exec wrangler d1 create mdcart-staging
pnpm exec wrangler d1 create mdcart-production
pnpm exec wrangler r2 bucket create mdcart-staging-files
pnpm exec wrangler r2 bucket create mdcart-production-files
cp wrangler.deploy.example.jsonc wrangler.deploy.jsonc
```

Edit the ignored `wrangler.deploy.jsonc` and:

1. Replace both `REPLACE_WITH_...` D1 IDs with the returned database IDs.
2. Replace both `example.com` hostnames with hostnames in the active zone.
3. Keep the binding names exactly `DB` and `FILES`.
4. Keep staging and production databases and buckets separate.
5. Set each `NEXT_PUBLIC_SITE_URL` to its exact public HTTPS origin.

Then validate it:

```bash
pnpm deploy:doctor
```

`wrangler deploy --dry-run` validates packaging, but it cannot prove that
remote resources, credentials, or DNS are correct. `pnpm deploy:doctor`
intentionally fails while placeholders remain.

For a headless runner, use a scoped token from its secret store instead of
`wrangler login`:

```bash
export CLOUDFLARE_ACCOUNT_ID='your-account-id'
export CLOUDFLARE_API_TOKEN='your-scoped-api-token'
pnpm exec wrangler whoami
```

Never put those values in Git, `.env.local`, Wrangler `vars`, or a public build
log.

## 4. Deploy and verify staging

Replace the hostname below with the one configured for staging:

```bash
export NEXT_PUBLIC_SITE_URL='https://staging-shop.example.com'
pnpm deploy:check
pnpm exec wrangler deploy --dry-run --config wrangler.deploy.jsonc --env staging
pnpm exec wrangler d1 migrations list DB --remote --config wrangler.deploy.jsonc --env staging
pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.deploy.jsonc --env staging
pnpm exec wrangler d1 migrations list DB --remote --config wrangler.deploy.jsonc --env staging
pnpm exec wrangler deploy --config wrangler.deploy.jsonc --env staging
```

For a fresh hosted database, set a unique one-time owner secret of at least 32
UTF-8 bytes. Wrangler prompts for the value so it does not enter shell history:

```bash
pnpm exec wrangler secret put MDCART_BOOTSTRAP_PASSWORD --config wrangler.deploy.jsonc --env staging
```

Sign in as `admin` with that secret, replace the password, and verify the owner
email. Then remove the bootstrap secret:

```bash
pnpm exec wrangler secret delete MDCART_BOOTSTRAP_PASSWORD --config wrangler.deploy.jsonc --env staging
```

Test the storefront, admin login, media upload, catalog, inventory, POS sale
and refund, receipt/report downloads, purchase receiving, and a review-only
import. Restrict staging with Cloudflare Access or equivalent authentication.

## 5. Deploy production

For an existing production store, first create one coordinated recovery point:

1. Export D1 or record a D1 Time Travel recovery point.
2. Copy every live R2 object to independent, versioned storage through R2's
   S3-compatible API.
3. Record the Git commit being deployed and retain the previous Worker version.

A fresh empty production store has no data to back up. For an update, do not
continue until both D1 and R2 recovery copies exist.

Replace the hostname and run:

```bash
export NEXT_PUBLIC_SITE_URL='https://shop.example.com'
pnpm deploy:check
pnpm exec wrangler deploy --dry-run --config wrangler.deploy.jsonc --env production
pnpm exec wrangler d1 migrations list DB --remote --config wrangler.deploy.jsonc --env production
pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.deploy.jsonc --env production
pnpm exec wrangler d1 migrations list DB --remote --config wrangler.deploy.jsonc --env production
pnpm exec wrangler deploy --config wrangler.deploy.jsonc --env production
```

On a fresh database only, put the production bootstrap secret, complete the
forced owner reset, and immediately delete it:

```bash
pnpm exec wrangler secret put MDCART_BOOTSTRAP_PASSWORD --config wrangler.deploy.jsonc --env production
```

Sign in as `admin`, replace the password, and verify the owner email. Only then
remove the one-time secret:

```bash
pnpm exec wrangler secret delete MDCART_BOOTSTRAP_PASSWORD --config wrangler.deploy.jsonc --env production
```

Verify DNS and the public endpoints:

```bash
dig +short shop.example.com
curl --fail --show-error --head https://shop.example.com/
curl --fail --show-error https://shop.example.com/api/storefront
```

Also test `/admin`, an image, an inventory adjustment, a POS sale/refund, and
receipt/report downloads. Remove temporary shell variables when finished:

```bash
unset NEXT_PUBLIC_SITE_URL CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN
```

## 6. Update or roll back

For every update, pull an explicitly reviewed `main`, install from the lockfile,
run `pnpm deploy:check`, back up D1 and R2 together, validate staging, and only
then repeat the production sequence.

Rolling back the Worker alone does not reverse a D1 migration. Restore the
compatible Worker, D1 recovery point, and matching R2 backup together.
