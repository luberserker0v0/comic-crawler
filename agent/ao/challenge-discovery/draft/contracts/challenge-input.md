# Challenge Discovery Input

## Task Goal

Determine whether the rendered page is blocked by a browser challenge and propose a constrained TypeScript strategy when needed.

## Source URL

The absolute URL under analysis.

## Browser Render Evidence

Include final URL, title, status, visible text summary, script URLs, iframe URLs, buttons, forms, and comic DOM candidate signals.

## Runtime Contract

The candidate must export `strategy` and implement `detect`, `autoAttempt`, and `verifyReady`.

## Forbidden Operations

No imports, require, process, page.evaluate, direct click, mouse, keyboard, stealth, fingerprint manipulation, or external solving services.

