# Official Adapter Registry Sources

This directory contains reviewed source packages used to build the official
signed adapter registry. It does not contain signing private keys or generated
Pages output.

## Layout

```text
registry/
  packages/
    <adapter-id>-<version>.ccadapter.json
```

Every retained version advertised by `index.json` must remain under
`registry/packages/`. The publishing command rebuilds the complete index from
these files instead of merging a previously deployed index.

## Review requirements

1. Export an approved Catalog package or build reviewed project source.
2. Review its complete TypeScript implementation.
3. Verify adapter ID, domains, capabilities, and fixture provenance.
4. Run the relevant adapter and fixture tests.
5. Add the package under `registry/packages/`.
6. Merge it through normal code review.
7. Run the `Publish Adapter Registry` workflow manually.

The workflow requires the `ADAPTER_REGISTRY_PRIVATE_KEY` Actions secret. The
private key must never be committed. Repository variables may override:

- `ADAPTER_REGISTRY_BASE_URL`
- `ADAPTER_REGISTRY_ID`
- `ADAPTER_REGISTRY_KEY_ID`

The initial official key ID is `comiccrawler-official-2026-10`. Generate it
with `npm run registry:keygen`. Its optional `--backup-directory` defaults to
the npm invocation directory; a repo-external encrypted path is recommended.
The script and backup procedure are documented in `docs/ADAPTER_REGISTRY.md`.

GitHub Pages must use GitHub Actions as its publishing source. The deployed
root contains `index.json`, `public-key.pem`, and signed package envelopes.

See [Official Adapter Registry](../docs/ADAPTER_REGISTRY.md) for the complete
trust and publishing contract.
