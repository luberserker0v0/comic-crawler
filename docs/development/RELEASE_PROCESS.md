# Release process

Run release commands from `repo/`.

## Release assets

Every GitHub Release must contain:

- `comiccrawler-v<version>.zip`: tracked repository files from the release tag.
- `comiccrawler-browser-client-sdk-<version>.tgz`: installable Browser Client SDK.
- `SHA256SUMS.txt`: SHA-256 digests for both files.

Build the same files locally with:

```bash
npm run release:artifacts -- --ref v0.5.0
```

The command rejects a tag that differs from `package.json`. It also rejects SDK
sources that differ from the release tag.

## Publish sequence

1. Update all workspace, OpenAPI, Docker, and test versions.
2. Merge the release preparation PR.
3. Create and push the annotated version tag.
4. Publish the GitHub Release for that tag.
5. Let `Release Artifacts` upload the three required assets.
6. Let `Docker Publish` publish the version and `latest` images.
7. Verify the Release assets and Docker image labels.
8. Smoke-test `/api/status` with the versioned image.

The Release workflow is the asset gate. Docker publication does not replace the
GitHub archive, SDK package, checksum file, or curated release notes.
