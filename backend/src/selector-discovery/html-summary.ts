import * as cheerio from 'cheerio';

export function summarizeHtmlForAgent(html: string, baseUrl: string, pageType: 'metadata' | 'chapter'): string {
  const $ = cheerio.load(html);
  const sections = {
    headings: collectHeadings($), meta: collectMeta($), anchors: collectAnchors($, baseUrl, pageType),
    images: collectImages($, pageType), containers: collectContainers($),
  };
  return formatOverview(html, baseUrl, $, sections);
}

function collectHeadings($: cheerio.CheerioAPI): string[] {
  return collect($, 'h1,h2,h3', (el) => `${describeElementSelector($, el)} | text=${compactText($(el).text())}`, 40);
}

function collectMeta($: cheerio.CheerioAPI): string[] {
  return collect($, 'meta[name],meta[property],meta[itemprop]', (el) => {
    const node = $(el);
    const key = node.attr('name') ?? node.attr('property') ?? node.attr('itemprop') ?? '';
    const value = node.attr('content') ?? '';
    return `${describeElementSelector($, el)} | ${key}: ${value}`;
  }, 40);
}

function collectAnchors($: cheerio.CheerioAPI, baseUrl: string, pageType: 'metadata' | 'chapter'): string[] {
  return collect($, 'a[href]', (el) => {
    const node = $(el);
    const href = node.attr('href') ?? '';
    const text = compactText(node.text());
    return `${describeElementSelector($, el)} | text=${text || '(no text)'} | href=${safeResolve(baseUrl, href)}`;
  }, pageType === 'metadata' ? 120 : 50, (value) => /chapter|manga|comic|read|reader|viewer|episode|ep/i.test(value));
}

function collectImages($: cheerio.CheerioAPI, pageType: 'metadata' | 'chapter'): string[] {
  return collect($, 'img,source', (el) => {
    const node = $(el);
    const attrs = ['src', 'data-src', 'data-original', 'data-lazy-src', 'srcset']
      .map((attr) => node.attr(attr) ? `${attr}=${node.attr(attr)}` : '')
      .filter(Boolean)
      .join(' ');
    const className = node.attr('class') ? ` class=${node.attr('class')}` : '';
    return `${describeElementSelector($, el)} | ${node[0]?.tagName ?? 'img'}${className} ${attrs}`.trim();
  }, pageType === 'chapter' ? 160 : 60);
}

function collectContainers($: cheerio.CheerioAPI): string[] {
  return collect($, 'main,article,section,div[class],ul[class],ol[class]', (el) => {
    const node = $(el);
    const tag = node[0]?.tagName ?? 'node';
    const id = node.attr('id') ? `#${node.attr('id')}` : '';
    const className = node.attr('class') ? `.${node.attr('class')!.trim().split(/\s+/).slice(0, 4).join('.')}` : '';
    const text = compactText(node.clone().children().remove().end().text());
    const childSummary = summarizeChildren(node);
    return `${describeElementSelector($, el)} | node=${tag}${id}${className} | children=${childSummary} | text=${text.slice(0, 120)}`;
  }, 140, (value) => /chapter|manga|comic|read|page|detail|content|list|episode|image|img|book|doc|main|article|section|box/i.test(value));
}

function formatOverview(html: string, baseUrl: string, $: cheerio.CheerioAPI,
  sections: { headings: string[]; meta: string[]; anchors: string[]; images: string[]; containers: string[] }): string {
  return `### DOM Overview
- URL: ${baseUrl}
- Document title: ${compactText($('title').first().text()) || 'unknown'}
- Body classes: ${$('body').attr('class') || 'none'}
- Original HTML length: ${html.length} characters

### Headings

${formatList(sections.headings)}

### Metadata-like Meta Tags

${formatList(sections.meta)}

### Candidate Links

${formatList(sections.anchors)}

### Candidate Image Nodes

${formatList(sections.images)}

### Candidate Structural Containers

${formatList(sections.containers)}
`;
}

export function collect(
  $: cheerio.CheerioAPI,
  selector: string,
  map: (element: any) => string,
  limit: number,
  filter?: (value: string) => boolean
): string[] {
  const values: string[] = [];
  $(selector).each((_, element) => {
    if (values.length >= limit) return false;
    const value = map(element).trim();
    if (!value) return;
    if (filter && !filter(value)) return;
    values.push(value);
    return;
  });
  return values;
}

export function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function safeResolve(baseUrl: string, href: string): string {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

export function describeElementSelector($: cheerio.CheerioAPI, element: any): string {
  const path: string[] = [];
  let current = $(element);
  for (let depth = 0; depth < 4 && current.length > 0; depth += 1) {
    const node = current.first();
    const raw = node.get(0);
    if (!raw || raw.type === 'root') break;
    const tag = raw.tagName ?? 'node';
    const id = node.attr('id');
    const className = node.attr('class');
    const attrSelector = selectorAttributeHint(node);
    const classSelector = className
      ? `.${className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map(cssEscapeLite).join('.')}`
      : '';
    path.unshift(`${tag}${id ? `#${cssEscapeLite(id)}` : ''}${classSelector}${attrSelector}`);
    current = node.parent();
  }
  return path.join(' > ') || 'unknown';
}

export function selectorAttributeHint(node: cheerio.Cheerio<any>): string {
  for (const attr of ['href', 'src', 'data-src', 'data-original', 'property', 'name', 'itemprop']) {
    const value = node.attr(attr);
    if (!value) continue;
    if (attr === 'href') {
      const stable = value.split('?')[0] ?? value;
      const segment = stable.split('/').filter(Boolean).at(0);
      return segment ? `[href*="/${cssEscapeLite(segment)}/"]` : '[href]';
    }
    if (['property', 'name', 'itemprop'].includes(attr)) {
      return `[${attr}="${cssEscapeLite(value)}"]`;
    }
    return `[${attr}]`;
  }
  return '';
}

export function cssEscapeLite(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s+/g, '.');
}

export function summarizeChildren(node: cheerio.Cheerio<any>): string {
  const counts = new Map<string, number>();
  node.children().each((_, child) => {
    const key = child.tagName ?? 'node';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return Array.from(counts.entries()).slice(0, 6).map(([key, count]) => `${key}:${count}`).join(',') || 'none';
}

export function formatList(values: string[]): string {
  if (values.length === 0) return '- none';
  return values.map((value) => `- ${value}`).join('\n');
}
