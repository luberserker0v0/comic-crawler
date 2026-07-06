# Selector Discovery AO Bundle

This bundle is owned by ComicCrawler and uploaded to AgentOrchestrator before each selector-discovery run.

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

Run bundle evaluation from the CLI. This creates a discovery job, validates extraction, performs a shadow promote, compares the result against the built-in Kuronavi oracle, and writes an artifact under `data/agent-workspaces/bundle-evaluations/<bundleHash>/`.

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

Each eval case is described by `eval/cases/<caseId>/case.json`. This JSON is system configuration for ComicCrawler; it is not provided to AO agents. Agent-facing input/output remains Markdown-only.

After a passing eval, freeze the draft bundle into `releases/vN` and update `active.json`:

```bash
comiccrawler agent bundle-freeze --eval-bundle-hash <bundleHash>
```

Runtime loads `draft/` only while `active.json` has no release. Once `active.json` points to a frozen release, ComicCrawler verifies the release directory SHA-256 before loading it.
