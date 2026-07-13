# Adapter Implementation Discovery AO Bundle

This bundle is owned by ComicCrawler and uploaded to AgentOrchestrator before each adapter implementation discovery run.

AO receives Markdown task files and sanitized DOM summaries. Final output is a
TypeScript adapter implementation draft plus Markdown review notes:

```text
outputs/adapter-implementation.ts
outputs/review-notes.md
```

The implementation must export one class that extends ComicCrawler
`AdapterBase`. AO must not output JSON contracts and must not implement
`fetchMetadata()` or `fetchChapterImages()`.

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
- Model: `my_local_lmstudio/gemma-4-e4b-uncensored-hauhaucs-aggressive`

## Eval and release flow

Run bundle evaluation from the CLI. During the Stage 1 calibration period this
creates a discovery job, saves AO TypeScript/review artifacts, and validates the
implementation draft statically. Runtime promotion of AO TypeScript adapters is
handled in a later stage after sandboxing and review policy are finalized.

List eval case inventory without AO/provider/model configuration:

```bash
comiccrawler agent bundle-eval --list-cases
```

Preview the eval plan without calling AO:

```bash
comiccrawler agent bundle-eval \
  --ao-url http://127.0.0.1:32768 \
  --provider-json agent/ao/selector-discovery/provider.example.json \
  --model my_local_lmstudio/gemma-4-e4b-uncensored-hauhaucs-aggressive \
  --dry-run
```

```bash
comiccrawler agent bundle-eval \
  --ao-url http://127.0.0.1:32768 \
  --provider-json agent/ao/selector-discovery/provider.example.json \
  --model my_local_lmstudio/gemma-4-e4b-uncensored-hauhaucs-aggressive
```

Run one case or repeat each selected case:

```bash
comiccrawler agent bundle-eval \
  --ao-url http://127.0.0.1:32768 \
  --provider-json agent/ao/selector-discovery/provider.example.json \
  --model my_local_lmstudio/gemma-4-e4b-uncensored-hauhaucs-aggressive \
  --case kuronavi-an-haxing-jian-guo-jia-noe-de-ling-zhu \
  --repeat 3
```

Live negative cases, such as search or home pages that may call AO, are disabled by default. Include them explicitly:

```bash
comiccrawler agent bundle-eval \
  --ao-url http://127.0.0.1:32768 \
  --provider-json agent/ao/selector-discovery/provider.example.json \
  --model my_local_lmstudio/gemma-4-e4b-uncensored-hauhaucs-aggressive \
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
  --model my_local_lmstudio/gemma-4-e4b-uncensored-hauhaucs-aggressive \
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
