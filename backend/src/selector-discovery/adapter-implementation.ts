import * as ts from 'typescript';
import type { AdapterImplementationValidation, SelectorDiscoveryCapabilityStage } from './types';

const REQUIRED_SNIPPETS = [
  'extends AdapterBase',
  'readonly id',
  'readonly name',
  'readonly domains',
  'readonly parseMode',
  'readonly capabilities',
];

const REQUIRED_FULL_SNIPPETS = [
  'readonly common',
  'readonly verification',
  'readonly metadata',
  'readonly chapterImages',
  'extractTitle',
  'extractChapterList',
  'extractChapterImageUrls',
];

const REQUIRED_CHAPTER_ONLY_SNIPPETS = [
  'readonly common',
  'readonly verification',
  'readonly chapterImages',
  'extractChapterImageUrls',
];

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /\bfrom\s+['"](?:node:)?fs(?:\/[^'"]*)?['"]/m, message: 'Filesystem imports are not allowed.' },
  { pattern: /\bfrom\s+['"](?:node:)?child_process(?:\/[^'"]*)?['"]/m, message: 'child_process imports are not allowed.' },
  { pattern: /\bfrom\s+['"](?:node:)?worker_threads(?:\/[^'"]*)?['"]/m, message: 'worker_threads imports are not allowed.' },
  { pattern: /\bimport\s*\(\s*['"](?:node:)?fs(?:\/[^'"]*)?['"]\s*\)/m, message: 'Filesystem imports are not allowed.' },
  { pattern: /\bimport\s*\(\s*['"](?:node:)?child_process(?:\/[^'"]*)?['"]\s*\)/m, message: 'child_process imports are not allowed.' },
  { pattern: /\bimport\s*\(\s*['"](?:node:)?worker_threads(?:\/[^'"]*)?['"]\s*\)/m, message: 'worker_threads imports are not allowed.' },
  { pattern: /\brequire\s*\(/m, message: 'require() is not allowed.' },
  { pattern: /\beval\s*\(/m, message: 'eval() is not allowed.' },
  { pattern: /\bnew\s+Function\s*\(/m, message: 'new Function() is not allowed.' },
  { pattern: /\bprocess\./m, message: 'Direct process access is not allowed.' },
  { pattern: /\bthis\.dom\b/m, message: 'this.dom is not part of the AdapterBase contract. Use this.adapter.asCheerio(document).' },
  { pattern: /\bdocument\.querySelector|\bdocument\.querySelectorAll|\bdocument\.getElementById/m, message: 'Browser document APIs are not allowed. Use Cheerio via this.adapter.asCheerio(document).' },
  { pattern: /\bimport\s*{[^}]*\bCapability\b[^}]*}\s*from/m, message: 'Generic Capability imports/usages are not part of the AdapterBase contract.' },
  { pattern: /\bfrom\s+['"]comiccrawler['"]/m, message: 'Importing from "comiccrawler" is not valid in adapter implementation drafts.' },
  { pattern: /\bfrom\s+['"]\.\/capabilities['"]/m, message: 'Importing from "./capabilities" is not valid in adapter implementation drafts.' },
  { pattern: /\bfrom\s+['"][^'"]*contracts\/adapter-base-api(?:\.md)?['"]/m, message: 'adapter-base-api.md is documentation and must not be imported.' },
  { pattern: /\bsuper\s*\(\s*{/m, message: 'Adapter identity must be readonly class fields, not constructor super() options.' },
  { pattern: /\bmatch(?:Title|Author|Description|CoverUrl|Tags|Status|ChapterList|ChapterImageUrls)\b/m, message: 'Use exact extract* capability method names, not match* method names.' },
  { pattern: /new\s+(?:CommonCapability|VerificationCapability|MetadataCapability|ChapterImagesCapability)\s*\(/m, message: 'Capability base classes must not be instantiated directly; create site-specific subclasses.' },
];

export function validateCapabilityDraft(
  source: string,
  options: { stage: SelectorDiscoveryCapabilityStage; target?: 'full' | 'chapter-only' }
): AdapterImplementationValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const trimmed = source.trim();

  if (!trimmed) {
    errors.push('Capability draft source is empty.');
  }

  const syntax = checkTypeScriptSyntax(source);
  if (!syntax.valid) {
    errors.push(`TypeScript syntax check failed: ${syntax.error}`);
  }

  for (const forbidden of FORBIDDEN_PATTERNS) {
    if (forbidden.pattern.test(source)) {
      errors.push(forbidden.message);
    }
  }

  if (/fetchMetadata|fetchChapterImages/.test(source)) {
    errors.push('Capability draft must not mention old facade functions fetchMetadata or fetchChapterImages.');
  }

  switch (options.stage) {
    case 'common-verification':
      errors.push(...validateCommonVerificationDraft(source));
      break;
    case 'metadata':
      errors.push(...validateMetadataCapabilityDraft(source));
      break;
    case 'chapter-images':
      errors.push(...validateChapterImagesCapabilityDraft(source));
      break;
    case 'compose':
      return validateAdapterImplementationDraft(source, { target: options.target });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    syntaxValid: syntax.valid,
  };
}

export function validateAdapterImplementationDraft(
  source: string,
  options: { target?: 'full' | 'chapter-only' } = {}
): AdapterImplementationValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const trimmed = source.trim();

  if (!trimmed) {
    errors.push('Adapter implementation source is empty.');
  }

  const syntax = checkTypeScriptSyntax(source);
  if (!syntax.valid) {
    errors.push(`TypeScript syntax check failed: ${syntax.error}`);
  }

  for (const forbidden of FORBIDDEN_PATTERNS) {
    if (forbidden.pattern.test(source)) {
      errors.push(forbidden.message);
    }
  }

  if (!/\bexport\s+class\s+\w+\s+extends\s+AdapterBase\b/.test(source)) {
    errors.push('Implementation must export a class that extends AdapterBase.');
  }

  for (const snippet of REQUIRED_SNIPPETS) {
    if (!source.includes(snippet)) {
      errors.push(`Missing required adapter declaration: ${snippet}.`);
    }
  }

  if (!/readonly\s+parseMode\s*[^=]*=\s*['"](?:static|dynamic|interactive)['"]/.test(source)) {
    errors.push('parseMode must be one of "static", "dynamic", or "interactive".');
  }

  if (!/capabilities\s*=\s*{[^}]*verification\s*:\s*(?:true|false)[^}]*metadata\s*:\s*(?:true|false)[^}]*chapterImages\s*:\s*(?:true|false)/s.test(source)) {
    errors.push('capabilities must be boolean flags for verification, metadata, and chapterImages.');
  }
  if (!/capabilities\s*=\s*{[^}]*verification\s*:\s*true/s.test(source)) {
    errors.push('Every adapter implementation must declare verification: true because VerificationCapability gates DOM trust.');
  }

  errors.push(...validateCapabilityStructure(source, options.target));

  const requiredFunctions = options.target === 'chapter-only'
    ? REQUIRED_CHAPTER_ONLY_SNIPPETS
    : REQUIRED_FULL_SNIPPETS;
  for (const functionName of requiredFunctions) {
    if (!new RegExp(`\\b${functionName}\\b`).test(source)) {
      errors.push(`Missing required extraction function: ${functionName}.`);
    }
  }

  const signatureErrors = validateRequiredSignatures(source, requiredFunctions);
  errors.push(...signatureErrors);

  if (/fetchMetadata|fetchChapterImages/.test(source)) {
    errors.push('Implementation must not mention old facade functions fetchMetadata or fetchChapterImages.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    syntaxValid: syntax.valid,
  };
}

function validateRequiredSignatures(source: string, functionNames: string[]): string[] {
  const errors: string[] = [];
  for (const functionName of functionNames) {
    const match = new RegExp(`\\b${functionName}\\s*\\(([^)]*)\\)`, 'm').exec(source);
    if (!match) continue;
    const params = match[1] ?? '';
    if (!/\bdocument\b/.test(params) || !/\bsourceUrl\b/.test(params)) {
      errors.push(`Extraction function ${functionName} must accept (document: unknown, sourceUrl: string).`);
    }
  }
  return errors;
}

function validateCapabilityStructure(source: string, target?: 'full' | 'chapter-only'): string[] {
  const errors: string[] = [];
  const adapterClassMatch = /\bexport\s+class\s+\w+\s+extends\s+AdapterBase\s*{([\s\S]*?)(?:\n}\s*(?:class|$))/m.exec(`${source}\nclass __Sentinel`);
  const adapterClass = adapterClassMatch?.[1] ?? '';
  if (adapterClass) {
    for (const methodName of [
      'extractTitle',
      'extractAuthor',
      'extractDescription',
      'extractCoverUrl',
      'extractTags',
      'extractStatus',
      'extractChapterList',
      'extractChapterImageUrls',
    ]) {
      if (new RegExp(`\\b${methodName}\\s*\\(`).test(adapterClass)) {
        errors.push(`Extraction method ${methodName} must be implemented in a capability subclass, not directly on the AdapterBase shell class.`);
      }
    }
  }

  if (!/\bclass\s+\w+\s+extends\s+CommonCapability\b/.test(source)) {
    errors.push('Missing site-specific CommonCapability subclass.');
  }
  if (!/\bclass\s+\w+\s+extends\s+VerificationCapability\b/.test(source)) {
    errors.push('Missing site-specific VerificationCapability subclass.');
  }
  if (!/\bclass\s+\w+\s+extends\s+ChapterImagesCapability\b/.test(source)) {
    errors.push('Missing site-specific ChapterImagesCapability subclass.');
  }
  if (target !== 'chapter-only' && !/\bclass\s+\w+\s+extends\s+MetadataCapability\b/.test(source)) {
    errors.push('Missing site-specific MetadataCapability subclass.');
  }
  return errors;
}

function validateCommonVerificationDraft(source: string): string[] {
  const errors: string[] = [];
  if (!/\bexport\s+class\s+\w+\s+extends\s+AdapterBase\b/.test(source)) {
    errors.push('Common/verification draft must export the AdapterBase shell class.');
  }
  for (const snippet of REQUIRED_SNIPPETS) {
    if (!source.includes(snippet)) {
      errors.push(`Missing required adapter declaration: ${snippet}.`);
    }
  }
  if (!/\breadonly\s+common\s*=/.test(source)) {
    errors.push('Common/verification draft must declare readonly common handler.');
  }
  if (!/\breadonly\s+verification\s*=/.test(source)) {
    errors.push('Common/verification draft must declare readonly verification handler.');
  }
  if (!/\bclass\s+\w+\s+extends\s+CommonCapability\b/.test(source)) {
    errors.push('Missing site-specific CommonCapability subclass.');
  }
  if (!/\bclass\s+\w+\s+extends\s+VerificationCapability\b/.test(source)) {
    errors.push('Missing site-specific VerificationCapability subclass.');
  }
  if (!/\bmatchUrl\s*\(\s*url\s*:\s*string\s*\)\s*:\s*boolean/.test(source)) {
    errors.push('CommonCapability must implement matchUrl(url: string): boolean.');
  }
  if (!/\bdetectVerificationRequired\s*\(\s*input\s*:\s*string\s*\)\s*:\s*boolean/.test(source)) {
    errors.push('VerificationCapability must implement detectVerificationRequired(input: string): boolean.');
  }
  if (!/\bdescribeVerificationHandoff\s*\(\s*\)\s*:/.test(source)) {
    errors.push('VerificationCapability must implement describeVerificationHandoff().');
  }
  if (!/capabilities\s*=\s*{[^}]*verification\s*:\s*true/s.test(source)) {
    errors.push('Every adapter draft must declare verification: true because VerificationCapability gates DOM trust.');
  }
  return errors;
}

function validateMetadataCapabilityDraft(source: string): string[] {
  const errors: string[] = [];
  if (!/\bclass\s+\w+\s+extends\s+MetadataCapability\b/.test(source)) {
    errors.push('Metadata draft must contain a site-specific MetadataCapability subclass.');
  }
  const required = [
    'extractTitle',
    'extractAuthor',
    'extractDescription',
    'extractCoverUrl',
    'extractTags',
    'extractStatus',
    'extractChapterList',
  ];
  for (const functionName of required) {
    if (!new RegExp(`\\b${functionName}\\s*\\(`).test(source)) {
      errors.push(`Missing metadata extraction function: ${functionName}.`);
    }
  }
  errors.push(...validateRequiredSignatures(source, required));
  if (/\bclass\s+\w+\s+extends\s+ChapterImagesCapability\b/.test(source)) {
    errors.push('Metadata draft must not implement ChapterImagesCapability.');
  }
  return errors;
}

function validateChapterImagesCapabilityDraft(source: string): string[] {
  const errors: string[] = [];
  if (!/\bclass\s+\w+\s+extends\s+ChapterImagesCapability\b/.test(source)) {
    errors.push('Chapter-images draft must contain a site-specific ChapterImagesCapability subclass.');
  }
  if (!/\bextractChapterImageUrls\s*\(/.test(source)) {
    errors.push('Missing chapter image extraction function: extractChapterImageUrls.');
  }
  errors.push(...validateRequiredSignatures(source, ['extractChapterImageUrls']));
  if (/\bclass\s+\w+\s+extends\s+MetadataCapability\b/.test(source)) {
    errors.push('Chapter-images draft must not implement MetadataCapability.');
  }
  return errors;
}

function checkTypeScriptSyntax(content: string): { valid: boolean; error?: string } {
  const result = ts.transpileModule(content, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      strict: true,
    },
    fileName: 'adapter-implementation.ts',
    reportDiagnostics: true,
  });

  const errors = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (errors.length === 0) return { valid: true };

  return {
    valid: false,
    error: errors
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('; '),
  };
}
