import { getAdapterCapabilities } from '../adapter/registry';
import type { AoClient } from './ao-client';
import {
  DEFAULT_SELECTOR_DISCOVERY_AGENT,
  type ProviderDocument,
  type SelectorDiscoveryCapabilityDraft,
  type SelectorDiscoveryJob,
  type SelectorDiscoverySettings,
} from './types';

export function formatCapabilityDraftsForCompose(drafts: SelectorDiscoveryCapabilityDraft[]): string {
  if (drafts.length === 0) {
    return '# Capability Drafts\n\nNo capability drafts were produced.';
  }
  return `# Capability Drafts

${drafts.map((draft) => `## ${draft.stage}

### Validation

- valid: ${draft.validation?.valid ?? false}
- errors: ${draft.validation?.errors.join('; ') || 'none'}
- warnings: ${draft.validation?.warnings.join('; ') || 'none'}

### Source

\`\`\`ts
${draft.sourceTs ?? ''}
\`\`\`

### Review Notes

${draft.reviewMarkdown || 'none'}
`).join('\n')}`;
}

export function formatCapabilityDraftFailureReview(drafts: SelectorDiscoveryCapabilityDraft[]): string {
  const failed = drafts.filter((draft) => draft.validation && !draft.validation.valid);
  return `# Capability Draft Validation Failed

ComicCrawler stopped before compose because at least one capability draft was
invalid. Fix the AO-facing documents or retry after updating the prompt.

${failed.map((draft) => `## ${draft.stage}

- source path: ${draft.sourcePath}
- review path: ${draft.reviewPath}
- errors:
${(draft.validation?.errors ?? []).map((error) => `  - ${error}`).join('\n') || '  - unknown'}
`).join('\n')}`;
}

export function formatCapabilityStageSmokeReview(drafts: SelectorDiscoveryCapabilityDraft[]): string {
  const latest = drafts.at(-1);
  return `# Capability Stage Smoke Complete

ComicCrawler stopped after ${latest?.stage ?? 'unknown'} as requested.

${drafts.map((draft) => `## ${draft.stage}

- source path: ${draft.sourcePath}
- review path: ${draft.reviewPath}
- validation: ${draft.validation?.valid ? 'valid' : 'invalid'}
- errors: ${draft.validation?.errors.join('; ') || 'none'}
`).join('\n')}`;
}

export function adapterSupportsDiscoveryTarget(
  adapter: { capabilities?: { verification?: boolean; metadata: boolean; chapterImages: boolean } },
  target: 'full' | 'chapter-only'
): boolean {
  const capabilities = getAdapterCapabilities(adapter as any);
  if (target === 'chapter-only') return capabilities.chapterImages;
  return capabilities.metadata && capabilities.chapterImages;
}

export function shouldRetryCapabilityDraft(draft: SelectorDiscoveryCapabilityDraft): boolean {
  const errors = draft.validation?.errors ?? [];
  return errors.some((error) => (
    error.includes('template selectors') ||
    error.includes('not present in task DOM evidence') ||
    error.includes('not present in task URL evidence') ||
    error.includes('require() is not allowed') ||
    error.includes('Adapter identity must be readonly class fields') ||
    error.includes('must not declare adapter identity') ||
    error.includes('Capability extraction methods must not keep template placeholders') ||
    error.includes('Template placeholder values') ||
    error.includes('ComicStatus is a string union') ||
    error.includes('ChapterInfo entries must not use ComicStatus') ||
    error.includes('must populate ChapterInfo.id') ||
    error.includes('must populate ChapterInfo.url') ||
    error.includes('ChapterInfo uses url') ||
    error.includes('must not use new Date()') ||
    error.includes('must be absolute') ||
    error.includes('must be derived from the chapter URL path segment') ||
    error.includes('must not match the bare word "cloudflare"') ||
    error.includes('must not implement metadata or chapter image extraction methods') ||
    error.includes('Do not redeclare ComicCrawler framework classes') ||
    error.includes('must not export an AdapterBase shell') ||
    error.includes('must not implement common or verification capabilities')
  ));
}

export function createCapabilityRetryFeedback(draft: SelectorDiscoveryCapabilityDraft, attempt: number): string {
  const errors = draft.validation?.errors ?? [];
  const sourceMissing = !draft.sourceTs?.trim();
  const lines = [
    `Attempt ${attempt} failed.`,
    sourceMissing
      ? `The requested TypeScript file was empty or missing: ${draft.sourcePath}.`
      : 'The requested TypeScript file failed validation.',
    '',
    'Required correction:',
    `- Write TypeScript source directly to ${draft.sourcePath}.`,
    `- Write review notes directly to ${draft.reviewPath}.`,
    '- Do not put TypeScript only in chat.',
    '- Do not write JSON.',
    '- Do not write outputs/adapter-implementation.ts.',
  ];
  if (errors.length > 0) {
    lines.push('', 'Validation errors to fix:', ...errors.map((error) => `- ${error}`));
  }
  if (draft.stage === 'metadata') {
    lines.push(
      '',
      'Metadata stage reminders:',
      '- Output exactly one MetadataCapability subclass.',
      '- Do not throw for missing optional selectors; return undefined or [].',
      '- ComicStatus is a string union: return "ongoing", "completed", or "unknown".',
      '- ChapterInfo entries require id, title, and absolute url.',
      '- Do not set ChapterInfo.status, sourceUrl, totalImages, or completedImages.'
    );
  }
  return lines.join('\n');
}

export function createFunctionRevisionTaskMarkdown(
  job: SelectorDiscoveryJob,
  revisionTask: NonNullable<SelectorDiscoveryJob['functionRevisionTasks']>[number],
  source: string
): string {
  return `# Adapter Function Revision Task

## Task Goal

Revise exactly one adapter function in the existing TypeScript implementation.

## Adapter Build Job

- Discovery job id: ${job.id}
- URL: ${job.normalizedUrl}
- Hostname: ${job.hostname}
- Target: ${job.target ?? 'full'}
- Promotion mode: ${job.promotionMode ?? 'create'}
- Base adapter id: ${job.baseAdapterId ?? '-'}

## Function To Revise

${revisionTask.functionId}

## User Instruction

${revisionTask.instruction}

## Source Boundary

The complete current adapter implementation is provided in \`adapter-implementation.ts\`.

Only change logic needed for \`${revisionTask.functionId}\` and directly related helpers.

Preserve unrelated capabilities and functions unless the requested change makes a tiny helper adjustment necessary.

## Required Output Files

- \`outputs/revised-adapter-implementation.ts\`: full revised TypeScript implementation.
- \`outputs/function-revision-review.md\`: short review notes explaining what changed and what should be tested.
- \`outputs/function-revision-self-check.md\`: your own Markdown self-check.

## Validation Expectations

- The revised source must instantiate as a ComicCrawler AdapterBase implementation.
- It must keep the same adapter identity unless the instruction explicitly asks otherwise.
- It must not output JSON.
- It must not use browser globals such as document.querySelector.
- It must use the existing AdapterBase / capability contract visible in the source.

## Required Self-Check Headings

\`outputs/function-revision-self-check.md\` must contain:

- \`## Target Function\`
- \`## Signature Check\`
- \`## Runtime Context Check\`
- \`## Output Contract Check\`
- \`## Evidence\`
- \`## Risks\`

The Runtime Context Check must explicitly discuss helper function binding and whether any standalone helper incorrectly depends on \`this\`.

## Current Source Size

${source.length} characters.
`;
}

export async function runAoFunctionRevisionWithRetry(input: {
  client: AoClient;
  conversationId: string;
  model: string;
  revisionTask: NonNullable<SelectorDiscoveryJob['functionRevisionTasks']>[number];
  outputPath: string;
  reviewPath: string;
  selfCheckPath: string;
}): Promise<{ revisedSource: string; reviewNotes: string; selfCheckMarkdown: string }> {
  let lastChatText = '';
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await input.client.message(
      input.conversationId,
      createFunctionRevisionMessage(input.revisionTask, input.outputPath, input.reviewPath, input.selfCheckPath, lastErrors),
      input.model,
      DEFAULT_SELECTOR_DISCOVERY_AGENT
    );
    lastChatText = response.text?.trim() || '';

    const revisedSource = (await input.client.readFile(input.conversationId, input.outputPath).catch(() => '')).trim()
      || extractFirstTypeScriptFence(lastChatText);
    const reviewNotes = (await input.client.readFile(input.conversationId, input.reviewPath).catch(() => '')).trim()
      || `# Function Revision Review\n\nAO revised ${input.revisionTask.functionId}.`;
    const selfCheckMarkdown = (await input.client.readFile(input.conversationId, input.selfCheckPath).catch(() => '')).trim();

    lastErrors = [];
    if (!revisedSource) {
      lastErrors.push(`missing full revised TypeScript source at ${input.outputPath}`);
    }
    lastErrors.push(...validateFunctionRevisionSelfCheck(selfCheckMarkdown));
    if (lastErrors.length === 0) {
      return { revisedSource, reviewNotes, selfCheckMarkdown };
    }
  }

  const eventSummary = summarizeAoConversationEvents(
    await input.client.listEvents(input.conversationId).catch(() => undefined)
  );
  throw new Error([
    'AO function revision output is incomplete after retry.',
    ...lastErrors.map((error) => `- ${error}`),
    lastChatText ? `AO chat excerpt: ${truncateForError(lastChatText)}` : 'AO chat excerpt: (empty)',
    eventSummary ? `AO event summary: ${eventSummary}` : undefined,
  ].filter(Boolean).join('\n'));
}

export function summarizeAoConversationEvents(value: unknown): string {
  if (!Array.isArray(value)) return '';
  const messageEvents = value
    .filter((event): event is { payload?: Record<string, unknown> } => (
      Boolean(event && typeof event === 'object' && (event as { type?: unknown }).type === 'conversation.message')
    ))
    .slice(-3);
  if (messageEvents.length === 0) return '';
  return messageEvents.map((event) => {
    const payload = event.payload ?? {};
    const text = typeof payload.text === 'string' ? payload.text : '';
    const parts = Array.isArray(payload.parts) ? payload.parts : [];
    const tokenParts = parts
      .map((part) => (part && typeof part === 'object' ? (part as { tokens?: unknown }).tokens : undefined))
      .filter(Boolean);
    return `messageId=${String(payload.messageId ?? '-')}, textLength=${text.length}, parts=${parts.length}, tokens=${truncateForError(JSON.stringify(tokenParts), 400)}`;
  }).join(' | ');
}

export function createFunctionRevisionMessage(
  revisionTask: NonNullable<SelectorDiscoveryJob['functionRevisionTasks']>[number],
  outputPath: string,
  reviewPath: string,
  selfCheckPath: string,
  retryErrors: string[]
): string {
  const retryFeedback = retryErrors.length > 0
    ? `\n## Retry Feedback\n\nYour previous response was incomplete:\n${retryErrors.map((error) => `- ${error}`).join('\n')}\n\nRewrite all required output files now. Do not merely explain what you would do.\n`
    : '';
  return `# Adapter Function Revision Task

Read revision-task.md and adapter-implementation.ts.

Revise exactly this function target:

- ${revisionTask.functionId}

Use the user's instruction from revision-task.md. Keep the AdapterBase shell and all capability classes intact.

${retryFeedback}
## Required AO Output

- Write the full revised TypeScript adapter implementation to ${outputPath}.
- Write concise Markdown review notes to ${reviewPath}.
- Write your own Markdown self-check to ${selfCheckPath}.
- Return a short confirmation in chat.

Rules:

- Do not output JSON.
- Do not only output the function body; write the full TypeScript implementation file.
- Do not change adapter id, name, domains, parseMode, or capabilities unless the user instruction explicitly says so.
- Keep imports compatible with the existing source.
- Preserve unrelated functions as much as possible.

## Required Self-Check Markdown

${selfCheckPath} must include these headings:

- ## Target Function
- ## Signature Check
- ## Runtime Context Check
- ## Output Contract Check
- ## Evidence
- ## Risks

In Runtime Context Check, explicitly verify whether helper functions use valid binding. If a helper needs adapter methods, pass the adapter or URL resolver explicitly; do not rely on \`this\` inside standalone helpers.`;
}

export function formatAoFunctionRevisionFailure(
  error: unknown,
  settings: SelectorDiscoverySettings,
  providerDocument: ProviderDocument
): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const providerIds = Object.keys(providerDocument.provider);
  const configuredModelIds = providerIds.flatMap((providerId) => (
    Object.keys(providerDocument.provider[providerId]?.models ?? {}).map((modelId) => `${providerId}/${modelId}`)
  ));
  const selectedProviderId = settings.model.split('/')[0];
  const visibleProviderIds = selectedProviderId ? Array.from(new Set([...providerIds, selectedProviderId])) : providerIds;
  const visibleModelIds = Array.from(new Set([...configuredModelIds, settings.model]));
  const lines = [
    'Agent function revision failed while sending the task to AO.',
    '',
    `AO URL: ${settings.aoBaseUrl}`,
    `Model: ${settings.model}`,
    `Configured providers: ${visibleProviderIds.length > 0 ? visibleProviderIds.join(', ') : '(none)'}`,
    `Configured models: ${visibleModelIds.length > 0 ? visibleModelIds.join(', ') : '(none)'}`,
    `Raw AO error: ${rawMessage}`,
  ];

  if (rawMessage.includes('/message') && /fetch failed|INTERNAL_ERROR/i.test(rawMessage)) {
    lines.push(
      '',
      'Likely cause: AO accepted the conversation, but failed while fetching from the configured model provider.',
      'Check that the provider baseURL is reachable from the AO/OpenCode runtime and that the selected model exists there.'
    );
  }

  if (settings.warnings && settings.warnings.length > 0) {
    lines.push('', 'Configuration warnings:', ...settings.warnings.map((warning) => `- ${warning}`));
  }

  return lines.join('\n');
}

export function truncateForError(value: string, maxLength = 1200): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}…`;
}

export function validateFunctionRevisionSelfCheck(markdown: string): string[] {
  const errors: string[] = [];
  if (!markdown.trim()) {
    return ['missing outputs/function-revision-self-check.md'];
  }
  const requiredHeadings = [
    'Target Function',
    'Signature Check',
    'Runtime Context Check',
    'Output Contract Check',
    'Evidence',
    'Risks',
  ];
  for (const heading of requiredHeadings) {
    const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'im');
    if (!pattern.test(markdown)) {
      errors.push(`missing heading "## ${heading}"`);
    }
  }
  const runtimeContext = extractMarkdownSection(markdown, 'Runtime Context Check');
  if (!/helper|binding|this/i.test(runtimeContext)) {
    errors.push('Runtime Context Check must discuss helper binding and standalone this usage');
  }
  return errors;
}

export function extractMarkdownSection(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'i');
  const anyLevelTwoHeadingPattern = /^##\s+\S/;
  const startIndex = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (startIndex < 0) return '';

  const sectionLines: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (anyLevelTwoHeadingPattern.test(line.trim())) {
      break;
    }
    sectionLines.push(line);
  }
  return sectionLines.join('\n').trim();
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createAoPhaseRetryFeedback(outputPath: string, output: string, errors: string[]): string {
  const lines = [
    '',
    '## Retry Feedback',
    '',
    output.trim()
      ? `The previous response did not match the required Markdown contract for ${outputPath}.`
      : `The previous response did not write or return any Markdown for ${outputPath}.`,
    '',
    'Fix these issues and write the complete Markdown result again:',
    ...errors.map((error) => `- ${error}`),
    '',
    `You must write the full corrected Markdown to ${outputPath}.`,
    'Also return the same full corrected Markdown in chat.',
    'Do not summarize, do not wait for another agent, and do not output JSON.',
  ];
  return lines.join('\n');
}

export function formatAoPhaseFailureError(input: {
  outputPath: string;
  model: string;
  errors: string[];
  emptyOutput: boolean;
}): string {
  const prefix = input.emptyOutput
    ? `AO did not produce Phase 1 Markdown at ${input.outputPath}.`
    : `AO Phase 1 Markdown did not match the required contract at ${input.outputPath}.`;
  return [
    prefix,
    `Model: ${input.model}.`,
    ...input.errors,
  ].join(' ');
}

export function extractFirstTypeScriptFence(text: string): string {
  const match = /```(?:typescript|ts)\s*([\s\S]*?)```/i.exec(text);
  return match?.[1]?.trim() ?? '';
}
