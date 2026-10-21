# Deploy MDCart from Windows 11

This runbook covers local development and a production deployment operated
from a Windows 11 x64 PowerShell session. MDCart's production runtime is
**Cloudflare Workers with D1 and R2**. It is not currently a drop-in IIS,
Windows Service, generic Node.js, or Docker deployment.

Wrangler officially supports Windows 11. For Windows Server or an older
Windows release, use a supported Linux/WSL2 deployment environment instead.
Use [DEPLOYMENT.md](./DEPLOYMENT.md) for architecture, security, backups, DNS,
and rollback policy.

## 1. Install the prerequisites

Install Git and Node.js 22.13.0 or newer. One option from an elevated
PowerShell session is:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
```

Open a new PowerShell session, then verify the tools and install the package
manager version pinned by MDCart:

```powershell
git --version
node --version
npm install --global pnpm@11.25.0
pnpm.cmd --version
```

Do not continue if Node.js is older than 22.13.0. If organization policy blocks
`pnpm.ps1`, use `pnpm.cmd` as shown here instead of weakening PowerShell's
execution policy.

## 2. Clone, validate, and run locally

```powershell
git clone https://github.com/mohanDontineni/ecomerce_website.git
Set-Location .\ecomerce_website\commerceos
pnpm.cmd install --frozen-lockfile
Copy-Item .env.example .env.local
pnpm.cmd deploy:doctor
pnpm.cmd db:local:apply
pnpm.cmd dev
```

Open `http://localhost:3000` and `http://localhost:3000/admin`. Local-only
bootstrap credentials are `admin` / `admin`; the first login requires a new
password and owner email verification. Stop the development server with
`Ctrl+C`.

Before a deployment, run the complete release check:

```powershell
pnpm.cmd deploy:check
```

It lints, type-checks, builds, checks the Cloudflare bindings, and confirms
that the deployable output exists. Release maintainers should additionally run
`pnpm.cmd licenses:check` on the platform producing their release artifact.

## 3. Authenticate and create isolated resources

Interactive workstation authentication:

```powershell
pnpm.cmd exec wrangler login
pnpm.cmd exec wrangler whoami
```

Create separate storage for staging and production:

```powershell
pnpm.cmd exec wrangler d1 create mdcart-staging
pnpm.cmd exec wrangler d1 create mdcart-production
pnpm.cmd exec wrangler r2 bucket create mdcart-staging-files
pnpm.cmd exec wrangler r2 bucket create mdcart-production-files
Copy-Item wrangler.deploy.example.jsonc wrangler.deploy.jsonc
notepad wrangler.deploy.jsonc
```

In the ignored `wrangler.deploy.jsonc`:

1. Replace both `REPLACE_WITH_...` D1 IDs with the returned database IDs.
2. Replace both `example.com` hostnames with hostnames in the active zone.
3. Keep the binding names exactly `DB` and `FILES`.
4. Keep staging and production databases and buckets separate.
5. Set each `NEXT_PUBLIC_SITE_URL` to its exact public HTTPS origin.

Then validate it:

```powershell
pnpm.cmd deploy:doctor
```

`wrangler deploy --dry-run` validates packaging, but it cannot prove that
remote resources, credentials, or DNS are correct. `pnpm.cmd deploy:doctor`
intentionally fails while placeholders remain.

For a headless runner, use a scoped token from its secret store instead of
`wrangler login`:

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = 'your-account-id'
$env:CLOUDFLARE_API_TOKEN = 'your-scoped-api-token'
pnpm.cmd exec wrangler whoami
```

Never put those values in Git, `.env.local`, Wrangler `vars`, or a public build
log.

## 4. Deploy and verify staging

Replace the hostname below with the one configured for staging:

```powershell
$env:NEXT_PUBLIC_SITE_URL = 'https://staging-shop.example.com'
pnpm.cmd deploy:check
pnpm.cmd exec wrangler deploy --dry-run --config wrangler.deploy.jsonc --env staging
pnpm.cmd exec wrangler d1 migrations list DB --remote --config wrangler.deploy.jsonc --env staging
pnpm.cmd exec wrangler d1 migrations apply DB --remote --config wrangler.deploy.jsonc --env staging
pnpm.cmd exec wrangler d1 migrations list DB --remote --config wrangler.deploy.jsonc --env staging
pnpm.cmd exec wrangler deploy --config wrangler.deploy.jsonc --env staging
```

For a fresh hosted database, set a unique one-time owner secret of at least 32
UTF-8 bytes. Wrangler prompts for the value so it does not enter command
history:

```powershell
pnpm.cmd exec wrangler secret put MDCART_BOOTSTRAP_PASSWORD --config wrangler.deploy.jsonc --env staging
```

Sign in as `admin` with that secret, replace the password, and verify the owner
email. Then remove the bootstrap secret:

```powershell
pnpm.cmd exec wrangler secret delete MDCART_BOOTSTRAP_PASSWORD --config wrangler.deploy.jsonc --env staging
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

```powershell
$env:NEXT_PUBLIC_SITE_URL = 'https://shop.example.com'
pnpm.cmd deploy:check
pnpm.cmd exec wrangler deploy --dry-run --config wrangler.deploy.jsonc --env production
pnpm.cmd exec wrangler d1 migrations list DB --remote --config wrangler.deploy.jsonc --env production
pnpm.cmd exec wrangler d1 migrations apply DB --remote --config wrangler.deploy.jsonc --env production
pnpm.cmd exec wrangler d1 migrations list DB --remote --config wrangler.deploy.jsonc --env production
pnpm.cmd exec wrangler deploy --config wrangler.deploy.jsonc --env production
```

On a fresh database only, put the production bootstrap secret, complete the
forced owner reset, and immediately delete it:

```powershell
pnpm.cmd exec wrangler secret put MDCART_BOOTSTRAP_PASSWORD --config wrangler.deploy.jsonc --env production
```

Sign in as `admin`, replace the password, and verify the owner email. Only then
remove the one-time secret:

```powershell
pnpm.cmd exec wrangler secret delete MDCART_BOOTSTRAP_PASSWORD --config wrangler.deploy.jsonc --env production
```

Verify DNS and the public endpoints:

```powershell
Resolve-DnsName shop.example.com
(Invoke-WebRequest -Uri 'https://shop.example.com/' -Method Head).StatusCode
Invoke-RestMethod -Uri 'https://shop.example.com/api/storefront'
```

Also test `/admin`, an image, an inventory adjustment, a POS sale/refund, and
receipt/report downloads. Remove temporary session variables when finished:

```powershell
Remove-Item Env:NEXT_PUBLIC_SITE_URL -ErrorAction SilentlyContinue
Remove-Item Env:CLOUDFLARE_ACCOUNT_ID -ErrorAction SilentlyContinue
Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
```

## 6. Update or roll back

For every update, pull an explicitly reviewed `main`, install from the lockfile,
run `pnpm.cmd deploy:check`, back up D1 and R2 together, validate staging, and
only then repeat the production sequence.

Rolling back the Worker alone does not reverse a D1 migration. Restore the
compatible Worker, D1 recovery point, and matching R2 backup together.
