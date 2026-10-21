# Adapter Packages

ComicCrawler stores developer-approved generated adapters as immutable
TypeScript packages. A package is the durable unit used by the Adapter Catalog;
the runtime registry contains only its currently active version.

## Package contents

Each `AdapterPackageDocument` contains:

- a schema-versioned manifest;
- adapter identity, domains, capabilities, and `playwright` parse mode;
- origin and creation metadata;
- the complete TypeScript implementation;
- validation results;
- SHA-256 manifest and implementation checksums;
- the approval fixture summary when promotion captured one.

Version labels combine the creation date and implementation checksum. Package
content cannot be overwritten after that adapter ID and version are stored.

## Catalog lifecycle

1. Selector Discovery produces a TypeScript draft.
2. A developer reviews the draft.
3. Promotion captures and verifies the approval fixture.
4. ComicCrawler builds an `AdapterPackageDocument`.
5. The Catalog stores the immutable package.
6. The Catalog marks that version active.
7. The runtime registry loads the active implementation.

Deleting a catalog adapter clears its active pointer but keeps all approved
versions. Restore activates the last active version. Rollback activates a named
approved version, or the previous version when the request omits `version`.

Read the available versions before choosing an explicit rollback target:

```http
GET /api/adapters/{adapterId}/versions
```

```http
POST /api/adapters/{adapterId}/rollback
Content-Type: application/json

{ "version": "v2026.10.21-1a2b3c4d" }
```

## Storage

Catalog data lives below the configured ComicCrawler data root:

```text
adapter-catalog/
  index
  adapters/<adapter-id>/versions/<version>/package
```

`npm run clean` never removes this data. Use application-specific maintenance
or backup procedures for runtime data instead of build cleanup commands.

At startup, ComicCrawler performs the bounded migration of the former generated
TypeScript implementation record, verifies the new package, and removes the old
key. Runtime loading never falls back to that old record. Old selector-manifest
records are rejected and must be converted to TypeScript packages explicitly.

Package export, sharing, signed registries, and remote update channels are later
features. The current catalog provides the required local immutable foundation;
it does not claim those distribution operations are available yet.
