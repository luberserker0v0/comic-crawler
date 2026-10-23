# Official Adapter Registry

ComicCrawler can query and install adapter packages from a signed static
registry. The registry may be hosted on GitHub Pages, release assets, or any
HTTPS static host. ComicCrawler does not trust a host name by itself.

## Trust model

1. An administrator provisions a local trust-store entry.
2. ComicCrawler fetches the configured registry index over HTTPS.
3. The index must have a valid Ed25519 signature.
4. The selected package must have a valid Ed25519 signature.
5. Package identity and checksums must match the signed index.
6. The package passes the normal strict schema and TypeScript checks.
7. ComicCrawler installs it inactive unless activation is explicit.

Private signing keys belong to the registry release process. Never mount or
copy a private signing key into ComicCrawler. The Server stores only public
keys selected by its administrator.

## Signed artifact contract

The index envelope is `{ schemaVersion, index, signature }`. The package
envelope is `{ schemaVersion, document, signature }`. Both use schema version
`1`. A signature contains:

- `algorithm`: `ed25519`;
- `keyId`: the trust-store key identifier;
- `signedAt`: an RFC 3339 timestamp;
- `value`: the Base64 Ed25519 signature.

The signed bytes are UTF-8 canonical JSON for
`{ payload, algorithm, keyId, signedAt }`. `payload` is the complete `index` or
package `document`. Canonical JSON sorts every object key lexically, preserves
array order, and emits no insignificant whitespace. The index package record
contains `adapterId`, `version`, `packageUrl`, `publishedAt`, both package
checksums, and `keyId`.

## Trust store

The default path is:

```text
<COMICCRAWLER_DATA_PATH>/config/adapter-registries.json
```

Override it with `COMICCRAWLER_ADAPTER_TRUST_STORE_PATH`. In Docker, the
image sets this path to the pinned, read-only official trust store at
`/app/defaults/adapter-registries.json`. Mount a custom file and override the
environment variable when additional registries are required.

```json
{
  "schemaVersion": 1,
  "registries": [
    {
      "id": "official",
      "indexUrl": "https://example.org/comiccrawler/index.json",
      "keyId": "release-2026",
      "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
      "enabled": true,
      "allowedPackageOrigins": ["https://example.org"]
    }
  ]
}
```

When `allowedPackageOrigins` is omitted, packages must use the index URL's
origin. Registry and package downloads require HTTPS, reject redirects, reject
private/reserved network addresses, time out after 30 seconds, and stop at 6 MB.

## CLI

Run from `repo/`:

```bash
npm run -w backend cli -- adapter-registry list
npm run -w backend cli -- adapter-registry check
npm run -w backend cli -- adapter-registry check comix
npm run -w backend cli -- adapter-registry install comix --registry official
npm run -w backend cli -- adapter-registry update
```

Install and update preserve the current active adapter. Use `--activate` only
after reviewing the downloaded package or when the registry key is approved for
direct activation:

```bash
npm run -w backend cli -- adapter-registry update comix --activate
```

## Publishing a registry

Publishing is a local maintainer-only CLI operation. It is intentionally not a
REST endpoint, so a deployed Server cannot be used as a signing oracle.

Generate one Ed25519 key pair. Keep the private key outside the repository and
back it up securely:

跨平台 npm command（請使用加密磁碟上的 repo 外路徑）：

```bash
npm run registry:keygen -- \
  --backup-directory "E:/ComicCrawler-Registry-Key-Backup" \
  --key-name "comiccrawler-official-2026-10"
```

`--backup-directory` is optional. Its default is the directory where the user
invoked `npm run`, using npm's `INIT_CWD` when available. Therefore this shorter
command writes all three files into the current invocation directory:

```bash
npm run registry:keygen
```

When that directory is inside the repository, the command prints a warning and
`.gitignore` excludes `*.private.pem`; move the private key into encrypted backup
storage immediately. The command refuses overwrite by default, requests
private-file mode `0600` on POSIX systems, and writes a metadata file containing
the public-key file SHA-256 fingerprint. Use `--force` only for an intentional
replacement. On Windows, Node file modes do not replace NTFS ACLs; use a private
directory on a BitLocker volume with access limited to your user.

The GitHub values are:

| Kind | Name | Value |
|---|---|---|
| Actions secret | `ADAPTER_REGISTRY_PRIVATE_KEY` | Complete contents of `comiccrawler-official-2026-10.private.pem` |
| Actions variable | `ADAPTER_REGISTRY_KEY_ID` | `comiccrawler-official-2026-10` |
| Actions variable | `ADAPTER_REGISTRY_ID` | `official` |
| Actions variable | `ADAPTER_REGISTRY_BASE_URL` | Final HTTPS Pages base URL |

Do not paste the private PEM into an issue, chat, workflow log, repository file,
or normal Actions artifact. Keep the generated metadata and public PEM with the
offline backup. Store at least one additional encrypted offline recovery copy.

The lower-level backend CLI is also available:

```bash
npm run -w backend cli -- adapter-registry keygen \
  --private-key ../secrets/adapter-registry-private.pem \
  --public-key ./registry-public.pem
```

Build a reviewed repository-maintained adapter directly into the Registry
source directory:

```bash
npm run -w backend cli -- adapter-packages build-project comix \
  --created-at 2026-10-22T06:28:35.337Z \
  --output ../registry/packages/comix-v2026.10.22-818eaad9.ccadapter.json
```

The command rejects project source that cannot execute as a portable Catalog
package. Review and test the source before committing the generated document.

For a developer-approved generated adapter already stored in Adapter Catalog,
export its immutable version instead:

```bash
npm run -w backend cli -- adapter-packages export comix \
  --output ../.artifacts/registry-input/comix.ccadapter.json
```

Keep every version that the index should advertise in that input directory.
The publisher scans directories recursively for `*.ccadapter.json`. It rebuilds
the complete index from the supplied inputs; it does not merge an old remote
index implicitly.

Build the static release:

```bash
npm run -w backend cli -- adapter-registry publish \
  ../.artifacts/registry-input \
  --output ../.artifacts/adapter-registry \
  --registry-id official \
  --base-url https://example.org/comiccrawler \
  --key-id release-2026 \
  --private-key ../secrets/adapter-registry-private.pem
```

The output is ready for a static HTTPS host:

```text
adapter-registry/
  index.json
  packages/<adapter-id>/<version>.json
```

The command validates every input before writing. It promotes the signed copy
to `origin: official`, recomputes its manifest checksum, signs every package,
sorts records deterministically, and signs the complete index. Existing targets
are not overwritten unless `--force` is present. `--timestamp` supplies a fixed
RFC 3339 release time for reproducible CI builds.

Publish only the output directory and `registry-public.pem`. Never publish the
private key or place it in the ComicCrawler Server data volume. Configure the
public key and final `index.json` URL in each Server trust store.

## GitHub Pages release pipeline

The repository includes `.github/workflows/adapter-registry-publish.yml`. It
builds reviewed inputs from `registry/packages/`, derives `public-key.pem`, and
deploys only the generated static directory to GitHub Pages.

Repository setup is intentionally manual and auditable:

1. Open repository Settings → Pages.
2. Select GitHub Actions as the publishing source.
3. Add the `ADAPTER_REGISTRY_PRIVATE_KEY` repository secret.
4. Optionally set `ADAPTER_REGISTRY_BASE_URL`, `ADAPTER_REGISTRY_ID`, and
   `ADAPTER_REGISTRY_KEY_ID` repository variables.
5. Review and merge package inputs under `registry/packages/`.
6. Manually run the `Publish Adapter Registry` workflow.
7. Pin the deployed public key in each Server trust store.

The default base URL is
`https://luberserker0v0.github.io/comic-crawler`. Override it before publishing
when the repository uses a custom Pages domain. A base URL mismatch creates
valid signatures with unusable package URLs, so it must be reviewed as release
configuration.

The signing job has read-only repository permission. Only the separate deploy
job receives `pages: write` and `id-token: write`. GitHub recommends the
`github-pages` environment; add a deployment protection rule for the default
branch or required reviewer when appropriate.

## REST API

- `GET /api/adapter-registry/packages`
- `GET /api/adapter-registry/updates?adapterId=comix`
- `POST /api/adapter-registry/install`
- `POST /api/adapter-registry/update`

Example install body:

```json
{
  "registryId": "official",
  "adapterId": "comix",
  "version": "v2026.10.22-1a2b3c4d",
  "activate": false
}
```

In token security mode, limit mutation endpoints with the existing
`adapter:manage` path policy. Query endpoints should require `adapter:read`.

## Update behavior

`check` selects the newest signed package by `publishedAt` for each adapter and
reports it only when that exact immutable version is absent locally. `update`
downloads those packages. It is a pull operation; the first version does not
run a background updater and does not silently change the active version.
