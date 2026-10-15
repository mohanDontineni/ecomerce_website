# Contributing to MDCart

MDCart is an MIT-licensed, single-store ecommerce foundation. Contributions that improve portability, accessibility, security, performance, or merchant customization are welcome.

## Local setup

1. Install Node.js 22.13 or newer and pnpm.
2. Run `pnpm install`.
3. Run `pnpm db:local:apply` against a fresh local D1 database.
4. Start the application with `pnpm dev`.
5. Sign in at `/admin` with `admin` / `admin`, then complete the required password and email-verification setup.

New local catalogs intentionally start empty. Please create temporary records for testing and remove them before submitting a change.

## Catalog design rules

- Keep the core industry-neutral. Do not add a clothing-, jewelry-, pharmacy-, or footwear-only column when an editable category, option, specification, or adapter can represent it.
- Use **categories** for navigation, **options and variants** for sellable inventory, and **specifications** for descriptive facts.
- A catalog template copies suggestions into a new product. It must never silently change existing products or prefill claims, prices, inventory, or regulated-product instructions.
- Preserve server-authoritative prices, stock, permissions, and optimistic-concurrency checks.
- Keep payment, tax, shipping, email, and compliance integrations behind replaceable boundaries.

## Before opening a pull request

Run:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

Generate schema changes with `pnpm db:generate`, inspect the SQL, and commit both the migration and matching Drizzle metadata. Migrations must be additive and schema-only; put one-time data maintenance in an explicit application workflow.

Include a short explanation of the merchant or customer problem, the behavior you changed, and how you verified it. Add or update documentation when a public API, deployment requirement, security boundary, or merchant workflow changes.

If dependencies change, run `pnpm licenses:generate`, review the resulting license families and warnings, and commit the updated `THIRD_PARTY_NOTICES.md`. A generated report does not replace review of the exact release artifact.

## Contribution licensing and provenance

By submitting a contribution to MDCart, you represent that you have the right to submit it and agree that it is licensed under the project's MIT License. Do not contribute code, text, images, fonts, data, or other material unless its license is compatible and every required copyright, attribution, source, and modification notice is documented.

Record externally sourced or generated assets in `CREDITS.md` and keep applicable license text in `THIRD_PARTY_NOTICES.md` or `LICENSES/`. Merchant or customer content must never be committed as sample data without documented permission.

## Security

Do not open a public issue for a suspected vulnerability. Follow [SECURITY.md](./SECURITY.md) and contact the maintainers privately.
