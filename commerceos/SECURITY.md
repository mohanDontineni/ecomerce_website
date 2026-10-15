# Security policy

Please report suspected vulnerabilities privately to the repository maintainers rather than opening a public issue. Include affected routes, reproduction steps, impact, and any suggested mitigation.

## Production checklist

Before making a deployment public:

1. Replace the `admin` / `admin` bootstrap with an environment-provided, one-time owner setup secret or identity-provider provisioning.
2. Connect transactional email for verification and invitations; do not expose verification codes in production UI or logs.
3. Add request throttling at the edge for login, verification, invitations, checkout, and uploads.
4. Connect a PCI-compliant hosted payment flow and signed, idempotent webhook handler. Never accept raw card data.
5. Add image re-encoding, content scanning, strict quotas, and CDN transformation for untrusted uploads.
6. Configure monitoring, backups, data-retention policies, privacy requests, and a tested migration/rollback process.
7. If operating more than one merchant in one deployment, add tenant scoping to the schema and authorization layer first.
8. For medicines, supplements, age-restricted goods, or other regulated products, add jurisdiction-specific authorization, labeling, professional review, shipping restrictions, and audit controls before accepting orders.

Supported source changes receive security fixes on the current main branch. There is no security guarantee for unmaintained forks or deployments that retain demo configuration.
