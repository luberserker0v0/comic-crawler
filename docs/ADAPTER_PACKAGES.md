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
agent-workspaces/
  approved-fixtures/<adapter-id>/<version>/<fixture-id>/
```

`npm run clean` never removes this data. Use application-specific maintenance
or backup procedures for runtime data instead of build cleanup commands.

ComicCrawler reads only Adapter Catalog packages and version-owned approval
fixtures. It has no runtime fallback or migration path for former generated
Adapter records or domain-owned approval fixtures.

## Export and import

Run package commands from `repo/`:

```bash
npm run -w backend cli -- adapter-packages list
npm run -w backend cli -- adapter-packages inspect ../demo.ccadapter.json
npm run -w backend cli -- adapter-packages export demo --output ../demo.ccadapter.json
npm run -w backend cli -- adapter-packages import ../demo.ccadapter.json
```

Repository-maintained adapters use a separate, explicit build command:

```bash
npm run -w backend cli -- adapter-packages build-project comix \
  --created-at 2026-10-22T06:28:35.337Z \
  --output ../registry/packages/comix-v2026.10.22-818eaad9.ccadapter.json
```

`build-project` reads the registered project source and evaluates it with the
same restricted runtime used for imported Catalog packages. Internal Server
imports therefore fail before the package is written. `--created-at` is
required because it participates in the immutable version identifier.

Portable source may import Adapter capability classes, `ComicError`, and
`ErrorType` from `../../base`. Runtime imports outside that Adapter API are not
available to installed packages.

Export writes the exact immutable JSON document. It refuses to overwrite an
existing file unless `--force` is supplied. Use `--version` when exporting an
approved version that is not active.

Inspect validates the strict schema, version derivation, manifest checksum,
implementation checksum, and TypeScript contract without evaluating package
code. Import performs the same checks and installs the version inactive.

Activation is a separate trust decision:

```bash
npm run -w backend cli -- adapter-packages import ../demo.ccadapter.json --activate
```

Activation evaluates the TypeScript in the restricted Adapter draft runtime,
checks implementation identity and domain conflicts, then changes the active
Catalog pointer. Review third-party source before activating it.

The corresponding REST operations are:

- `GET /api/adapters/:id/versions/:version/package`
- `POST /api/adapter-packages/import`

Protect REST import with the `adapter:manage` permission in token mode. The
package carries approval fixture metadata, not the fixture file contents. A
receiving developer should capture a fresh local fixture before accepting a
shared adapter for an official release.

For signed remote installation and updates, see
[Official Adapter Registry](ADAPTER_REGISTRY.md). Remote packages pass the same
inspection and Catalog checks; download never bypasses local validation.
