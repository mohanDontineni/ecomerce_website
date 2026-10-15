# Licensing guide

This guide explains how licensing is organized in MDCart. It is not legal
advice.

## What the MIT License covers

Unless a file says otherwise, the MDCart source code, documentation, favicon,
and social-preview artwork are licensed under the repository's
[MIT License](../LICENSE). The MIT License permits commercial and private use,
copying, modification, redistribution, sublicensing, and sale, provided that
the copyright and license notice is kept with substantial portions of the
software.

Forks should retain `LICENSE` and `NOTICE.md`. If a fork changes the product
name or branding, it should also update its own copyright and credit
statements without removing applicable third-party notices.

## What is covered by other licenses

Dependencies, generated component foundations, icons, and fonts remain under
their upstream licenses. MDCart records these in:

- [CREDITS.md](../CREDITS.md) for human-readable acknowledgments;
- [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for the installed package inventory and upstream license texts; and
- [LICENSES/OFL-1.1-Geist.txt](../LICENSES/OFL-1.1-Geist.txt) for the Geist font license that accompanies production font files.

After changing `package.json` or `pnpm-lock.yaml`, run:

```bash
pnpm install --frozen-lockfile
pnpm licenses:generate
pnpm licenses:check
```

The generator reads the exact installed dependency graph and groups identical
license and notice texts to keep the committed report reviewable. Optional
platform packages can differ between macOS, Linux, and Windows, so release
maintainers should regenerate the report on the platform used to produce the
release artifact.

## Content that is not licensed by MDCart

Merchant and customer content is not part of this software license. That
includes uploaded or remotely linked product images, logos, background
posters, descriptions, customer records, and integration data. Operators must
obtain the rights and permissions required for the content in their store and
must provide any attribution required by its owner.

The catalog templates use general retail terminology. References to product
types, payment providers, marketplaces, or other companies are descriptive
only and do not grant rights to third-party names, logos, product images, or
trademarks.

## Distributing a fork or hosted service

Before release:

1. Keep the MDCart MIT license and applicable contributor notices.
2. Regenerate and review `THIRD_PARTY_NOTICES.md` from the locked dependency graph.
3. Ship the Geist OFL file with any bundled Geist font binaries.
4. Review licenses for any new theme, icon set, font, image, plugin, or adapter.
5. Separate operator-provided content from the source distribution.
6. Obtain legal review for the jurisdiction, business model, and distribution method when needed.
