# Adapter Implementation Discovery AO Bundle

This bundle is owned by ComicCrawler and uploaded to AgentOrchestrator before each adapter implementation discovery run.

AO receives `task.md`, sanitized DOM evidence, and one small stage prompt. It
writes one capability subclass and short review notes. Current stage files are:

```text
outputs/common-verification.ts
outputs/metadata-capability.ts
outputs/reader-preparation.ts
outputs/chapter-images-capability.ts
```

ComicCrawler validates each stage and assembles the `AdapterBase` shell. AO
does not write that shell, browser behavior, or JSON contracts.

## Provider JSON

Use `provider.example.json` as the starting point. The provider document must include a top-level `provider` field.

Important: `{file:...}` paths are resolved by AO/OpenCode, not ComicCrawler. If AO runs in Docker or Linux, do not use a Windows host path such as `C:\Users\...` unless that path is mounted and visible inside AO exactly as written.

For the local LM Studio provider used during development, `apiKey` can be set to `"nopassword"`.

Recommended Docker-style token reference:

```json
{
  "apiKey": "nopassword"
}
```

## Initial evaluation target

- URL: `https://kuronavi.one/manga/an-haxing-jian-guo-jia-noe-de-ling-zhu`
- Model: choose one from AO `GET /api/conversations/:id/providers`, for example `opencode/big-pickle` when available.

## Eval and release flow

Run bundle evaluation from the CLI. It creates a discovery job, stores each
capability draft, composes the adapter, and runs static validation. Promotion
still requires developer review.

List eval case inventory without AO/provider/model configuration:

```bash
comiccrawler agent bundle-eval --list-cases
```

Preview the eval plan without calling AO:

```bash
comiccrawler agent bundle-eval \
  --ao-url http://127.0.0.1:32768 \
  --provider-json agent/ao/selector-discovery/provider.example.json \
  --model <provider/model> \
  --dry-run
```

```bash
comiccrawler agent bundle-eval \
  --ao-url http://127.0.0.1:32768 \
  --provider-json agent/ao/selector-discovery/provider.example.json \
  --model <provider/model>
```

Run one case or repeat each selected case:

```bash
comiccrawler agent bundle-eval \
  --ao-url http://127.0.0.1:32768 \
  --provider-json agent/ao/selector-discovery/provider.example.json \
  --model <provider/model> \
  --case kuronavi-an-haxing-jian-guo-jia-noe-de-ling-zhu \
  --repeat 3
```

Live negative cases, such as search or home pages that may call AO, are disabled by default. Include them explicitly:

```bash
comiccrawler agent bundle-eval \
  --ao-url http://127.0.0.1:32768 \
  --provider-json agent/ao/selector-discovery/provider.example.json \
  --model <provider/model> \
  --live-negative
```

Release policy defaults:

- positive eval runs must all pass
- negative eval runs must pass 100%
- at least one positive eval run must execute

For a larger release gate, relax positive flake tolerance explicitly while keeping negatives strict:

```bash
comiccrawler agent bundle-eval \
  --ao-url http://127.0.0.1:32768 \
  --provider-json agent/ao/selector-discovery/provider.example.json \
  --model <provider/model> \
  --repeat 3 \
  --min-positive-passes 23 \
  --max-positive-failures 1 \
  --live-negative
```

Each eval case is described by `eval/cases/<caseId>/case.json`. This JSON is system configuration for ComicCrawler; it is not provided to AO agents. Agent-facing task/review artifacts remain Markdown, while implementation output is TypeScript.

After a passing eval, freeze the draft bundle into `releases/vN` and update `active.json`:

```bash
comiccrawler agent bundle-freeze --eval-bundle-hash <bundleHash>
```

Runtime loads `draft/` only while `active.json` has no release. Once `active.json` points to a frozen release, ComicCrawler verifies the release directory SHA-256 before loading it.
