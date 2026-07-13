import * as ts from 'typescript';
import type { AdapterImplementationValidation } from './types';

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
  'readonly metadata',
  'readonly chapterImages',
  'extractTitle',
  'extractChapterList',
  'extractChapterImageUrls',
];

const REQUIRED_CHAPTER_ONLY_SNIPPETS = [
  'readonly common',
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
  { pattern: /\bCapability\b/m, message: 'Generic Capability imports/usages are not part of the AdapterBase contract.' },
  { pattern: /\bfrom\s+['"]comiccrawler['"]/m, message: 'Importing from "comiccrawler" is not valid in adapter implementation drafts.' },
  { pattern: /\bfrom\s+['"]\.\/capabilities['"]/m, message: 'Importing from "./capabilities" is not valid in adapter implementation drafts.' },
  { pattern: /\bsuper\s*\(\s*{/m, message: 'Adapter identity must be readonly class fields, not constructor super() options.' },
  { pattern: /\bmatch(?:Title|Author|Description|CoverUrl|Tags|Status|ChapterList|ChapterImageUrls)\b/m, message: 'Use exact extract* capability method names, not match* method names.' },
];

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
    errors.push('Implementation must not mention old façade functions fetchMetadata or fetchChapterImages.');
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
