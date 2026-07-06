import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Script } from 'node:vm';
import * as ts from 'typescript';
import * as cheerio from 'cheerio';
import type { SiteSelectors } from '@comiccrawler/shared';
import type { SiteManifest } from '../adapter/sites/types';
import { DomExtractionStrategy } from '../crawler/extraction/strategies/dom';

export interface FixtureValidationResult {
  valid: boolean;
  fixtureName: string;
  errors: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  selectorsHash?: string;
  parserHash?: string;
  syntaxValid?: boolean;
  fixtureResults?: FixtureValidationResult[];
}

export class CodeValidator {
  async validateSelectors(content: string): Promise<ValidationResult> {
    const errors: string[] = [];

    if (!content || content.trim().length === 0) {
      errors.push('Selectors content is empty');
    }

    if (!content.includes('export')) {
      errors.push('No export statement found');
    }

    if (!content.includes('selector') && !content.includes('Selector')) {
      errors.push('No selector definition found');
    }

    const syntax = await this.checkTypeScriptSyntax(content, 'selectors.ts');
    if (!syntax.valid) {
      errors.push(`TypeScript syntax check failed: ${syntax.error}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      selectorsHash: createHash('sha256').update(content).digest('hex'),
      syntaxValid: syntax.valid,
    };
  }

  async validateParser(content: string): Promise<ValidationResult> {
    const errors: string[] = [];

    if (!content || content.trim().length === 0) {
      errors.push('Parser content is empty');
    }

    if (!content.includes('export')) {
      errors.push('No export statement found');
    }

    if (!content.includes('function') && !content.includes('=>')) {
      errors.push('No function definition found');
    }

    const syntax = await this.checkTypeScriptSyntax(content, 'parser.ts');
    if (!syntax.valid) {
      errors.push(`TypeScript syntax check failed: ${syntax.error}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      parserHash: createHash('sha256').update(content).digest('hex'),
      syntaxValid: syntax.valid,
    };
  }

  async validateBoth(
    selectorsContent: string,
    parserContent: string
  ): Promise<ValidationResult> {
    const selectorsResult = await this.validateSelectors(selectorsContent);
    const parserResult = await this.validateParser(parserContent);

    return {
      valid: selectorsResult.valid && parserResult.valid,
      errors: [...selectorsResult.errors, ...parserResult.errors],
      selectorsHash: selectorsResult.selectorsHash,
      parserHash: parserResult.parserHash,
      syntaxValid: Boolean(selectorsResult.syntaxValid && parserResult.syntaxValid),
    };
  }

  async validateSelectorFixtures(options: {
    manifest: SiteManifest;
    selectorsContent: string;
  }): Promise<ValidationResult> {
    const selectorsResult = await this.validateSelectors(options.selectorsContent);
    const fixtureResults: FixtureValidationResult[] = [];
    const errors = [...selectorsResult.errors];

    if (!selectorsResult.valid) {
      return {
        ...selectorsResult,
        fixtureResults,
      };
    }

    let selectors: SiteSelectors;
    try {
      selectors = this.loadSelectorsModule(
        options.selectorsContent,
        options.manifest.maintenance.selectorExportName
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to evaluate selectors module: ${message}`);
      return {
        valid: false,
        errors,
        selectorsHash: selectorsResult.selectorsHash,
        syntaxValid: selectorsResult.syntaxValid,
        fixtureResults,
      };
    }

    const metadataFixture = await this.validateMetadataFixture(options.manifest, selectors);
    fixtureResults.push(metadataFixture);
    errors.push(...metadataFixture.errors);

    if (options.manifest.maintenance.imageFixture) {
      const imageFixture = await this.validateImageFixture(options.manifest, selectors);
      fixtureResults.push(imageFixture);
      errors.push(...imageFixture.errors);
    }

    return {
      valid: errors.length === 0,
      errors,
      selectorsHash: selectorsResult.selectorsHash,
      syntaxValid: selectorsResult.syntaxValid,
      fixtureResults,
    };
  }

  async checkSyntax(content: string): Promise<{ valid: boolean; error?: string }> {
    try {
      new Function(content);
      return { valid: true };
    } catch (error: any) {
      return { valid: false, error: error.message };
    }
  }

  async checkTypeScriptSyntax(content: string, fileName: string): Promise<{ valid: boolean; error?: string }> {
    const result = ts.transpileModule(content, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        strict: true,
      },
      fileName,
      reportDiagnostics: true,
    });

    const diagnostics = result.diagnostics ?? [];
    const errors = diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);

    if (errors.length === 0) {
      return { valid: true };
    }

    return {
      valid: false,
      error: errors
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
        .join('; '),
    };
  }

  private loadSelectorsModule(content: string, exportName: string): SiteSelectors {
    const transpiled = ts.transpileModule(content, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
      fileName: 'selectors.ts',
    }).outputText;

    const module = { exports: {} as Record<string, unknown> };
    const script = new Script(transpiled, { filename: 'selectors.js' });
    const sandbox = {
      module,
      exports: module.exports,
      require,
      __dirname: '.',
      __filename: 'selectors.js',
    };

    script.runInNewContext(sandbox);
    const exportsObject = module.exports as Record<string, unknown>;
    const selectors = exportsObject[exportName];

    if (!selectors || typeof selectors !== 'object') {
      throw new Error(`Expected selector export "${exportName}" was not found`);
    }

    return selectors as SiteSelectors;
  }

  private async validateMetadataFixture(manifest: SiteManifest, selectors: SiteSelectors): Promise<FixtureValidationResult> {
    const fixture = manifest.maintenance.metadataFixture;
    const html = await fs.readFile(join(manifest.maintenance.fixturesRoot, fixture.htmlFile), 'utf-8');
    const expected = JSON.parse(
      await fs.readFile(join(manifest.maintenance.fixturesRoot, fixture.expectedFile!), 'utf-8')
    ) as {
      id: string;
      title: string;
      cover: string;
      description: string;
      genres: string[];
      chapters: Array<{ id: string; title: string; url: string }>;
    };

    const strategy = new DomExtractionStrategy();
    const metadata = await strategy.extractMetadata({
      $: cheerio.load(html),
      baseUrl: fixture.baseUrl,
      selectors,
      pageType: 'metadata',
    });

    const errors: string[] = [];
    if (metadata.id !== expected.id) {
      errors.push(`metadata.id mismatch: expected "${expected.id}" but received "${metadata.id}"`);
    }
    if (metadata.title !== expected.title) {
      errors.push(`metadata.title mismatch: expected "${expected.title}" but received "${metadata.title}"`);
    }
    if (metadata.coverUrl !== expected.cover) {
      errors.push(`metadata.coverUrl mismatch: expected "${expected.cover}" but received "${metadata.coverUrl}"`);
    }
    if (metadata.description !== expected.description) {
      errors.push('metadata.description mismatch');
    }
    if (JSON.stringify(metadata.tags ?? []) !== JSON.stringify(expected.genres)) {
      errors.push('metadata.tags mismatch');
    }
    if (metadata.chapters.length !== expected.chapters.length) {
      errors.push(`metadata.chapters length mismatch: expected ${expected.chapters.length} but received ${metadata.chapters.length}`);
    }

    return {
      valid: errors.length === 0,
      fixtureName: fixture.name,
      errors,
    };
  }

  private async validateImageFixture(manifest: SiteManifest, selectors: SiteSelectors): Promise<FixtureValidationResult> {
    const fixture = manifest.maintenance.imageFixture!;
    const html = await fs.readFile(join(manifest.maintenance.fixturesRoot, fixture.htmlFile), 'utf-8');
    const expected = JSON.parse(
      await fs.readFile(join(manifest.maintenance.fixturesRoot, fixture.expectedFile!), 'utf-8')
    ) as Array<{ url: string; index: number; filename: string }>;

    const strategy = new DomExtractionStrategy();
    const images = await strategy.extractImages({
      $: cheerio.load(html),
      baseUrl: fixture.baseUrl,
      selectors,
      pageType: 'images',
    });

    const errors: string[] = [];
    if (images.length !== expected.length) {
      errors.push(`images length mismatch: expected ${expected.length} but received ${images.length}`);
      return {
        valid: false,
        fixtureName: fixture.name,
        errors,
      };
    }

    expected.forEach((expectedImage, index) => {
      const actual = images[index];
      if (!actual) {
        errors.push(`missing image at index ${index}`);
        return;
      }
      if (actual.url !== expectedImage.url) {
        errors.push(`image[${index}].url mismatch`);
      }
      if (actual.filename !== expectedImage.filename) {
        errors.push(`image[${index}].filename mismatch`);
      }
    });

    return {
      valid: errors.length === 0,
      fixtureName: fixture.name,
      errors,
    };
  }
}
