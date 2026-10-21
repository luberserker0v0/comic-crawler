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
  { pattern: /\bdeclare\s+class\s+(?:AdapterBase|CommonCapability|VerificationCapability|MetadataCapability|ChapterImagesCapability)\b/m, message: 'Do not redeclare ComicCrawler framework classes. Import AdapterBase and capability classes from the adapter base.' },
  { pattern: /\bimport\s*{[^}]*\bCapability\b[^}]*}\s*from/m, message: 'Generic Capability imports/usages are not part of the AdapterBase contract.' },
  { pattern: /\bfrom\s+['"]comiccrawler['"]/m, message: 'Importing from "comiccrawler" is not valid in adapter implementation drafts.' },
  { pattern: /\bfrom\s+['"]\.\/capabilities['"]/m, message: 'Importing from "./capabilities" is not valid in adapter implementation drafts.' },
  { pattern: /\bfrom\s+['"][^'"]*contracts\/adapter-base-api(?:\.md)?['"]/m, message: 'adapter-base-api.md is documentation and must not be imported.' },
  { pattern: /\bexample\.com\b|\bmy-site-adapter\b|\bGeneric Comic Site\b|\bExample Site\b/m, message: 'Template placeholder values must be replaced with site-specific identity and domains.' },
  { pattern: /\bsuper\s*\(\s*{/m, message: 'Adapter identity must be readonly class fields, not constructor super() options.' },
  { pattern: /\bverifyDom\s*\(/m, message: 'VerificationCapability must implement detectVerificationRequired(input: string), not verifyDom().' },
  { pattern: /Replace with site-specific|throw\s+new\s+Error\s*\(/m, message: 'Capability extraction methods must not keep template placeholders or throw for missing optional selectors; return undefined or an empty array when data is unavailable.' },
  { pattern: /\bextends\s+\w+Capability\s+implements\s+\w+Capability\b/m, message: 'Capability handlers must not be combined with implements; create one site-specific subclass per capability base class.' },
  { pattern: /\bmatch(?:Title|Author|Description|CoverUrl|Tags|Status|ChapterList|ChapterImageUrls)\b/m, message: 'Use exact extract* capability method names, not match* method names.' },
  { pattern: /new\s+(?:CommonCapability|VerificationCapability|MetadataCapability|ChapterImagesCapability)\s*\(/m, message: 'Capability base classes must not be instantiated directly; create site-specific subclasses.' },
];

export function validateCapabilityDraft(
  source: string,
  options: { stage: SelectorDiscoveryCapabilityStage; target?: 'full' | 'chapter-only' }
): AdapterImplementationValidation {
  const { errors, syntax } = validateSourceBasics(source, 'Capability draft source is empty.');
  const warnings: string[] = [];
  errors.push(...validateCapabilityStage(source, options.stage));
  return { valid: errors.length === 0, errors, warnings, syntaxValid: syntax.valid };
}

function validateSourceBasics(source: string, emptyMessage: string) {
  const errors: string[] = [];
  if (!source.trim()) errors.push(emptyMessage);
  const syntax = checkTypeScriptSyntax(source);
  if (!syntax.valid) errors.push(`TypeScript syntax check failed: ${syntax.error}`);
  for (const forbidden of FORBIDDEN_PATTERNS)
    if (forbidden.pattern.test(source)) errors.push(forbidden.message);
  return { errors, syntax };
}

function validateCapabilityStage(source: string, stage: SelectorDiscoveryCapabilityStage): string[] {
  if (stage === 'common-verification') return validateCommonVerificationDraft(source);
  if (stage === 'metadata') return validateMetadataCapabilityDraft(source);
  return validateChapterImagesCapabilityDraft(source);
}

export function validateAdapterImplementationDraft(
  source: string,
  options: { target?: 'full' | 'chapter-only' } = {}
): AdapterImplementationValidation {
  const { errors, syntax } = validateSourceBasics(source, 'Adapter implementation source is empty.');
  const warnings: string[] = [];
  errors.push(...validateAdapterDeclarations(source));
  errors.push(...validateCapabilityStructure(source, options.target));
  const requiredFunctions = options.target === 'chapter-only'
    ? REQUIRED_CHAPTER_ONLY_SNIPPETS
    : REQUIRED_FULL_SNIPPETS;
  errors.push(...validateRequiredFunctions(source, requiredFunctions));
  errors.push(...validateRequiredSignatures(source, requiredFunctions));
  return { valid: errors.length === 0, errors, warnings, syntaxValid: syntax.valid };
}

function validateAdapterDeclarations(source: string): string[] {
  const errors: string[] = [];
  if (!/\bexport\s+class\s+\w+\s+extends\s+AdapterBase\b/.test(source))
    errors.push('Implementation must export a class that extends AdapterBase.');
  for (const snippet of REQUIRED_SNIPPETS) if (!source.includes(snippet))
    errors.push(`Missing required adapter declaration: ${snippet}.`);
  if (!/readonly\s+parseMode\s*[^=]*=\s*['"]playwright['"]/.test(source))
    errors.push('parseMode must be "playwright".');
  if (!/capabilities\s*=\s*{[^}]*verification\s*:\s*(?:true|false)[^}]*metadata\s*:\s*(?:true|false)[^}]*chapterImages\s*:\s*(?:true|false)/s.test(source))
    errors.push('capabilities must be boolean flags for verification, metadata, and chapterImages.');
  if (!/capabilities\s*=\s*{[^}]*verification\s*:\s*true/s.test(source))
    errors.push('Every adapter implementation must declare verification: true because VerificationCapability gates DOM trust.');
  return errors;
}

function validateRequiredFunctions(source: string, names: string[]): string[] {
  return names.filter((name) => !new RegExp(`\\b${name}\\b`).test(source))
    .map((name) => `Missing required extraction function: ${name}.`);
}

function validateRequiredSignatures(source: string, functionNames: string[]): string[] {
  const errors: string[] = [];
  for (const functionName of functionNames) {
    const match = new RegExp(`\\b${functionName}\\s*\\(([^)]*)\\)\\s*(?::\\s*[^\\{]+)?\\{`, 'm').exec(source);
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
  errors.push(...directExtractionMethodErrors(adapterClass));
  const required = ['CommonCapability', 'VerificationCapability', 'ChapterImagesCapability'];
  if (target !== 'chapter-only') required.push('MetadataCapability');
  for (const capability of required)
    if (!new RegExp(`\\bclass\\s+\\w+\\s+extends\\s+${capability}\\b`).test(source))
      errors.push(`Missing site-specific ${capability} subclass.`);
  return errors;
}

function directExtractionMethodErrors(adapterClass: string): string[] {
  const methods = ['extractTitle', 'extractAuthor', 'extractDescription', 'extractCoverUrl',
    'extractTags', 'extractStatus', 'extractChapterList', 'extractChapterImageUrls'];
  return methods.filter((name) => new RegExp(`\\b${name}\\s*\\(`).test(adapterClass))
    .map((name) => `Extraction method ${name} must be implemented in a capability subclass, not directly on the AdapterBase shell class.`);
}

function validateCommonVerificationDraft(source: string): string[] {
  const errors = commonVerificationStructureErrors(source);
  const verificationBody = extractMethodBody(source, 'detectVerificationRequired');
  if (hasUnsafeCloudflareMatch(verificationBody)) {
    errors.push('detectVerificationRequired must not match the bare word "cloudflare"; normal pages can contain Cloudflare scripts. Match challenge-specific signals instead.');
  }
  if (/\bextract(?:Title|Author|Description|CoverUrl|Tags|Status|ChapterList|ChapterImageUrls)\s*\(/.test(source)) {
    errors.push('Common/verification draft must not implement metadata or chapter image extraction methods.');
  }
  return errors;
}

function commonVerificationStructureErrors(source: string): string[] {
  const checks: Array<[boolean, string]> = [
    [/\bextends\s+AdapterBase\b/.test(source), 'Common/verification draft must not export or implement an AdapterBase shell.'],
    [/\bconstructor\s*\(|\breadonly\s+(?:id|name|domains|parseMode|capabilities|common|verification|metadata|chapterImages)\b/.test(source), 'Common/verification draft must not declare adapter identity, constructor, capability flags, or handler fields.'],
    [!/\bclass\s+\w+\s+extends\s+CommonCapability\b/.test(source), 'Missing site-specific CommonCapability subclass.'],
    [!/\bclass\s+\w+\s+extends\s+VerificationCapability\b/.test(source), 'Missing site-specific VerificationCapability subclass.'],
    [!/\bmatchUrl\s*\(\s*url\s*:\s*string\s*\)\s*:\s*boolean/.test(source), 'CommonCapability must implement matchUrl(url: string): boolean.'],
    [!/\bdetectVerificationRequired\s*\(\s*input\s*:\s*string\s*\)\s*:\s*boolean/.test(source), 'VerificationCapability must implement detectVerificationRequired(input: string): boolean.'],
    [!/\bdescribeVerificationHandoff\s*\(\s*\)\s*:/.test(source), 'VerificationCapability must implement describeVerificationHandoff().'],
  ];
  return checks.filter(([invalid]) => invalid).map(([, message]) => message);
}

function hasUnsafeCloudflareMatch(body: string): boolean {
  return Boolean(body && (hasBareCloudflareRegexAlternative(body)
    || (/cloudflare/i.test(body) && !hasCloudflareChallengeSpecificSignal(body))));
}

function hasBareCloudflareRegexAlternative(value: string): boolean {
  return /(?:\/|\|)\s*cloudflare\s*(?:\||\/[a-z]*)/i.test(value);
}

function hasCloudflareChallengeSpecificSignal(value: string): boolean {
  return /cf[-_]?chl|cf_clearance|just a moment|checking your browser|attention required/i.test(value)
    || /cloudflare.{0,80}(?:challenge|verification)|(?:challenge|verification).{0,80}cloudflare/i.test(value);
}

function validateMetadataCapabilityDraft(source: string): string[] {
  const errors = metadataStructureErrors(source);
  const required = [
    'extractTitle', 'extractAuthor', 'extractDescription', 'extractCoverUrl',
    'extractTags', 'extractStatus', 'extractChapterList',
  ];
  for (const name of required) if (!new RegExp(`\\b${name}\\s*\\(`).test(source))
    errors.push(`Missing metadata extraction function: ${name}.`);
  errors.push(...validateRequiredSignatures(source, required));
  errors.push(...chapterListErrors(extractMethodBody(source, 'extractChapterList')));
  if (usesUnchangedMetadataTemplate(source)) errors.push(
    'Metadata draft still uses template selectors instead of site-specific selectors from task evidence.');
  return errors;
}

function metadataStructureErrors(source: string): string[] {
  const checks: Array<[boolean, string]> = [
    [!/\bclass\s+\w+\s+extends\s+MetadataCapability\b/.test(source), 'Metadata draft must contain a site-specific MetadataCapability subclass.'],
    [/\bexport\s+class\s+\w+\s+extends\s+AdapterBase\b/.test(source), 'Metadata draft must not export an AdapterBase shell.'],
    [/\bclass\s+\w+\s+extends\s+(?:CommonCapability|VerificationCapability)\b/.test(source), 'Metadata draft must not implement common or verification capabilities.'],
    [/\bconstructor\s*\(|\breadonly\s+(?:id|name|domains|parseMode|common|verification)\b/.test(source), 'Metadata draft must not declare adapter identity, constructor, common, or verification fields.'],
    [/\bclass\s+\w+\s+extends\s+ChapterImagesCapability\b/.test(source), 'Metadata draft must not implement ChapterImagesCapability.'],
    [/\bComicStatus\.\w+\b/.test(source), 'ComicStatus is a string union; return "ongoing", "completed", or "unknown" instead of ComicStatus enum members.'],
    [/status\s*:\s*(?:ComicStatus\.|['"](?:ongoing|completed|unknown)['"])/.test(source), 'ChapterInfo entries must not use ComicStatus for status; status is task state metadata, not comic publication status.'],
  ];
  return checks.filter(([invalid]) => invalid).map(([, message]) => message);
}

function chapterListErrors(body: string): string[] {
  if (!body) return [];
  const checks: Array<[boolean, string]> = [
    [!hasObjectFieldOrShorthand(body, 'id'), 'extractChapterList must populate ChapterInfo.id for each chapter.'],
    [!hasObjectFieldOrShorthand(body, 'url'), 'extractChapterList must populate ChapterInfo.url with an absolute chapter URL.'],
    [/\bsourceUrl\s*:|[{,]\s*sourceUrl\s*[,}]/.test(body), 'ChapterInfo uses url, not sourceUrl.'],
    [/new\s+Date\s*\(\s*\)/.test(body), 'extractChapterList must not use new Date() as a placeholder for chapter dates.'],
    [/\burl\s*:\s*(?:relativeUrl|rawHref|href)\b/.test(body), 'ChapterInfo.url must be absolute; resolve relative hrefs with this.adapter.resolveUrl(sourceUrl, rawHref).'],
    [/\bid\s*:\s*String\s*\(\s*index\s*\+\s*1\s*\)/.test(body), 'ChapterInfo.id must be derived from the chapter URL path segment, not list index.'],
  ];
  return checks.filter(([invalid]) => invalid).map(([, message]) => message);
}

function usesUnchangedMetadataTemplate(source: string): boolean {
  const unchanged = [
    'main h1',
    '.author a',
    '.description',
    '.cover img',
    '.tags a',
    '.status',
    '.chapter-list a[href*="/read/"]',
  ].filter((selector) => source.includes(selector));
  const siteSpecific = /meta\[(?:name|property)=["'](?:author|keywords|description|og:title|og:description|og:image)["']\]/i.test(source) ||
    /href\*=["'][^"']*\/chapter-/i.test(source) ||
    /href\^=["'][^"']*\/chapter-/i.test(source);
  return unchanged.length >= 3 && !siteSpecific;
}

function hasObjectFieldOrShorthand(source: string, field: string): boolean {
  const escaped = escapeRegExp(field);
  return new RegExp(`\\b${escaped}\\s*:`).test(source) ||
    new RegExp(`[\\{,]\\s*${escaped}\\s*(?:[,\\}])`).test(source);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMethodBody(source: string, methodName: string): string {
  const startMatch = new RegExp(`\\b${methodName}\\s*\\([^)]*\\)\\s*(?::\\s*[^\\{]+)?\\{`, 'm').exec(source);
  if (!startMatch?.index) return '';
  let depth = 0;
  const start = startMatch.index + startMatch[0].length - 1;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, index);
    }
  }
  return '';
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
