# Security policy

Please report suspected vulnerabilities privately to the repository maintainers rather than opening a public issue. Include affected routes, reproduction steps, impact, and any suggested mitigation.

## Production checklist

Before making a deployment public:

1. Configure a unique 32-byte-or-longer `MDCART_BOOTSTRAP_PASSWORD` runtime secret, complete the forced first-login reset, and delete the bootstrap secret. On upgrades it also replaces a legacy forced-reset default hash. `admin` / `admin` is local-development-only.
2. Connect transactional email for verification and invitations; do not expose verification codes in production UI or logs.
3. Add request throttling at the edge for login, verification, invitations, checkout, and uploads.
4. Treat POS Venmo, Zelle, PayPal, and described Other methods as unverified cashier-confirmed bookkeeping only; they do not transfer or prove payment. Use a trusted server-side adapter for every automated non-cash authorization, capture, reconciliation, and refund, and connect a PCI-compliant hosted online payment flow with signed, idempotent webhooks. Never accept raw card data.
5. Keep the built-in image type, byte-size, dimension, and pixel-count limits; add image re-encoding, content scanning, strict quotas, and CDN transformation before accepting uploads from untrusted users.
6. Configure monitoring, backups, data-retention policies, privacy requests, and a tested migration/rollback process.
7. If operating more than one merchant in one deployment, add tenant scoping to the schema and authorization layer first.
8. For medicines, supplements, age-restricted goods, or other regulated products, add jurisdiction-specific authorization, labeling, professional review, shipping restrictions, and audit controls before accepting orders.

Supported source changes receive security fixes on the current main branch. There is no security guarantee for unmaintained forks or deployments that retain demo configuration.
