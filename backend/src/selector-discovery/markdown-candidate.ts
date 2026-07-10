import type { MarkdownCandidateValidation, ParsedMarkdownCandidate } from './types';

export const REQUIRED_CANDIDATE_HEADINGS = [
  'Adapter Identity',
  'URL Patterns',
  'Title Extraction',
  'Author Extraction',
  'Description Extraction',
  'Cover URL Extraction',
  'Tags Extraction',
  'Status Extraction',
  'Chapter List Extraction',
  'Chapter Image URL Extraction',
  'Evidence',
  'Confidence',
  'Reviewer Checklist',
];

export function splitMarkdownSections(markdown: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let current = 'Preamble';
  sections[current] = '';

  for (const line of lines) {
    const heading = /^#{2,3}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = normalizeHeading(heading[1]!.trim());
      sections[current] = '';
      continue;
    }
    sections[current] = `${sections[current] ?? ''}${line}\n`;
  }

  return Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, value.trim()]));
}

export function validateMarkdownCandidate(
  markdown: string,
  options?: { target?: 'full' | 'chapter-only'; allowExistingImageSelectors?: boolean }
): MarkdownCandidateValidation {
  const sections = splitMarkdownSections(markdown);
  const parsed = parseMarkdownCandidate(markdown);
  const missingHeadings = REQUIRED_CANDIDATE_HEADINGS.filter((heading) => !sections[heading]?.trim());
  const warnings: string[] = [];

  const trimmed = markdown.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    warnings.push('Candidate appears to be JSON-only output; Markdown sections are required.');
  }

  if (/```json/i.test(markdown)) {
    warnings.push('Candidate contains a JSON code block; reviewer should verify the Markdown sections instead.');
  }

  if (missingHeadings.length > 0) {
    warnings.push(`Candidate did not use every exact contract heading: ${missingHeadings.join(', ')}`);
  }

  const hasMinimumImageSelectors = options?.allowExistingImageSelectors
    ? true
    : Boolean(parsed.selectors.images?.item && parsed.selectors.images?.srcAttr);
  const hasMinimumSelectors = options?.target === 'chapter-only'
    ? hasMinimumImageSelectors
    : Boolean(
        parsed.selectors.metadata?.title &&
        (parsed.selectors.chapters?.item || parsed.selectors.chapters?.url) &&
        hasMinimumImageSelectors
      );

  return {
    valid: missingHeadings.length === 0 || hasMinimumSelectors,
    missingHeadings,
    warnings,
  };
}

export function parseMarkdownCandidate(markdown: string): ParsedMarkdownCandidate {
  const rawSections = splitMarkdownSections(markdown);
  const sourceUrl = readFirstUrl(markdown);
  const sourceHostname = sourceUrl ? new URL(sourceUrl).hostname : undefined;
  const identity = rawSections['Adapter Identity'] ?? '';
  const metadata = rawSections['Metadata Selectors'] ?? '';
  const titleExtraction = rawSections['Title Extraction'] ?? '';
  const authorExtraction = rawSections['Author Extraction'] ?? '';
  const descriptionExtraction = rawSections['Description Extraction'] ?? '';
  const coverExtraction = rawSections['Cover URL Extraction'] ?? rawSections['Cover Extraction'] ?? '';
  const tagsExtraction = rawSections['Tags Extraction'] ?? '';
  const statusExtraction = rawSections['Status Extraction'] ?? '';
  const chapters = rawSections['Chapter Selectors'] ?? rawSections['Chapter List Extraction'] ?? '';
  const images = [
    rawSections['Image Selectors'] ?? '',
    rawSections['Chapter Image URL Extraction'] ?? '',
    rawSections['Image Lazy-Loading Candidates (For Optimization)'] ?? '',
    rawSections['Image Lazy-Loading Candidates'] ?? '',
  ].filter(Boolean).join('\n\n');
  const chapterLink = readSelector(chapters, 'Individual Chapter Link')
    ?? readSelectorFromSections(rawSections, 'Chapter Item')
    ?? readSelector(chapters, 'URL Selector')
    ?? readSelector(chapters, 'Item Selector')
    ?? readSelector(chapters, 'URL')
    ?? readSelector(chapters, 'Url')
    ?? '';
  const imageItem = readSelector(images, 'Lazy-Loaded Image Item')
    ?? readSelector(images, 'Primary Chapter Image Item')
    ?? readSelectorFromSections(rawSections, 'Image Item Selector')
    ?? readSelector(images, 'Item Selector')
    ?? readSelector(images, 'Item')
    ?? '';

  return {
    adapterId: readLabeledValue(identity, 'Adapter ID') ?? readLabeledValue(identity, 'ID') ?? (sourceHostname ? slugify(sourceHostname) : undefined),
    name: readLabeledValue(identity, 'Name') ?? sourceHostname,
    domains: [...readList(rawSections['URL Patterns'] ?? '', 'Domain'), ...(sourceHostname ? [sourceHostname] : [])].filter(unique),
    urlPatterns: [...readList(rawSections['URL Patterns'] ?? '', 'Pattern'), ...(sourceUrl ? [`${new URL(sourceUrl).origin}/manga/*`] : [])].filter(unique),
    selectors: {
      metadata: {
        title: readSelector(titleExtraction, 'Selector') ?? readSelector(metadata, 'Title') ?? readSelectorFromSections(rawSections, 'Title') ?? '',
        author: readSelector(authorExtraction, 'Selector') ?? readSelector(metadata, 'Author') ?? readSelectorFromSections(rawSections, 'Author') ?? '',
        cover: readSelector(coverExtraction, 'Selector') ?? readSelector(metadata, 'Cover Image') ?? readSelector(metadata, 'Cover') ?? readSelectorFromSections(rawSections, 'Cover Image URL') ?? '',
        status: readSelector(statusExtraction, 'Selector') ?? readSelector(metadata, 'Status') ?? readSelectorFromSections(rawSections, 'Status') ?? '',
        tags: readSelector(tagsExtraction, 'Selector') ?? readSelector(metadata, 'Tags') ?? readSelectorFromSections(rawSections, 'Tags') ?? '',
        description: readSelector(descriptionExtraction, 'Selector') ?? readSelector(metadata, 'Description') ?? readSelectorFromSections(rawSections, 'Description'),
      },
      chapters: {
        list: readSelector(chapters, 'List Selector') ?? readSelector(chapters, 'Chapter List Container') ?? readSelector(chapters, 'List') ?? readSelectorFromSections(rawSections, 'Chapter List Container') ?? '',
        item: readSelector(chapters, 'Item Selector') ?? readSelector(chapters, 'Item') ?? chapterLink,
        title: readSelector(chapters, 'Title Selector') ?? readSelector(chapters, 'Title'),
        url: chapterLink,
      },
      images: {
        container: readSelector(images, 'Container'),
        item: imageItem,
        srcAttr: readSelector(images, 'Source Attribute') ?? readSelector(images, 'Src Attribute') ?? readSelectorFromSections(rawSections, 'Image Source Attribute') ?? inferImageSourceAttribute(imageItem, images),
      },
    },
    confidence: (rawSections['Confidence'] ?? '').trim() || undefined,
    rawSections,
  };
}

function normalizeHeading(heading: string): string {
  const direct = REQUIRED_CANDIDATE_HEADINGS.find((required) =>
    heading === required || heading.startsWith(`${required} `) || heading.startsWith(`${required} (`)
  );
  if (direct) return direct;
  if (/^Metadata Selectors\b/i.test(heading)) return 'Metadata Selectors';
  if (/^Image Selectors\b/i.test(heading)) return 'Image Selectors';
  if (/^Chapter List Selectors\b/i.test(heading)) return 'Chapter Selectors';
  if (/^Summary of Findings|Confidence Assessment|Validation/i.test(heading)) return 'Confidence';
  return heading;
}

function readLabeledValue(section: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*:\\s*(.+)`, 'i').exec(section);
  return cleanMarkdownValue(match?.[1]?.trim());
}

function readSelector(section: string, label: string): string | undefined {
  const value = readLabeledValue(section, label);
  if (!value) return undefined;
  const inlineCode = /`([^`]+)`/.exec(value);
  return (inlineCode?.[1] ?? value).replace(/^`|`$/g, '').replace(/\s+within\s+`([^`]+)`/i, '').trim();
}

function readSelectorFromSections(sections: Record<string, string>, heading: string): string | undefined {
  const section = sections[heading];
  if (!section) return undefined;
  return readSelector(section, 'Selector') ?? readSelector(section, 'URL') ?? readFirstInlineCode(section);
}

function readList(section: string, label: string): string[] {
  const values: string[] = [];
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?${escaped}s?(?:\\*\\*)?\\s*:\\s*(.+)`, 'gi');
  let match;
  while ((match = regex.exec(section)) !== null) {
    values.push(
      ...match[1]!
        .split(',')
        .map((item) => item.trim().replace(/^`|`$/g, ''))
        .filter(Boolean)
    );
  }
  return Array.from(new Set(values));
}

function cleanMarkdownValue(value?: string): string | undefined {
  if (!value) return undefined;
  return value.replace(/^\*\*|\*\*$/g, '').trim();
}

function readFirstUrl(markdown: string): string | undefined {
  const match = /https?:\/\/[^\s`)]+/i.exec(markdown);
  return match?.[0];
}

function readFirstInlineCode(markdown: string): string | undefined {
  const match = /`([^`]+)`/.exec(markdown);
  return match?.[1]?.trim();
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function unique<T>(value: T, index: number, values: T[]): boolean {
  return Boolean(value) && values.indexOf(value) === index;
}

function inferImageSourceAttribute(itemSelector: string, imageSection: string): string {
  const attrMatch = /\[([a-zA-Z0-9_-]+)\]/.exec(itemSelector);
  if (attrMatch?.[1]) return attrMatch[1];
  if (/data-original/i.test(imageSection)) return 'data-original';
  if (/data-src/i.test(imageSection)) return 'data-src';
  return 'src';
}
