import { describe, it, expect, beforeEach } from '@jest/globals';
import { CodeValidator } from '../../../src/agent/code-validator';
import { KURONAVI_SITE_MANIFEST } from '../../../src/adapter/sites/kuronavi';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('CodeValidator', () => {
  let validator: CodeValidator;

  beforeEach(() => {
    validator = new CodeValidator();
  });

  it('should validate valid selectors', async () => {
    const content = 'export const selectors = { title: ".title" };';
    const result = await validator.validateSelectors(content);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.selectorsHash).toBeDefined();
    expect(result.syntaxValid).toBe(true);
  });

  it('should reject empty selectors', async () => {
    const result = await validator.validateSelectors('');

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Selectors content is empty');
  });

  it('should reject selectors without export', async () => {
    const content = 'const selectors = { title: ".title" };';
    const result = await validator.validateSelectors(content);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('No export statement found');
  });

  it('should validate valid parser', async () => {
    const content = 'export function parse(html: string) { return html; }';
    const result = await validator.validateParser(content);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.parserHash).toBeDefined();
    expect(result.syntaxValid).toBe(true);
  });

  it('should reject empty parser', async () => {
    const result = await validator.validateParser('');

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Parser content is empty');
  });

  it('should validate both files', async () => {
    const selectors = 'export const selectors = { title: ".title" };';
    const parser = 'export function parse(html: string) { return html; }';

    const result = await validator.validateBoth(selectors, parser);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.syntaxValid).toBe(true);
  });

  it('should check JavaScript syntax', async () => {
    const validCode = 'const x = 1 + 2;';
    const invalidCode = 'const x = ;';

    expect((await validator.checkSyntax(validCode)).valid).toBe(true);
    expect((await validator.checkSyntax(invalidCode)).valid).toBe(false);
  });

  it('should check TypeScript syntax', async () => {
    const validCode = 'export const selectors = { title: ".title" } as const;';
    const invalidCode = 'export const selectors = { title: ".title", }; const broken: = 1;';

    expect((await validator.checkTypeScriptSyntax(validCode, 'selectors.ts')).valid).toBe(true);
    expect((await validator.checkTypeScriptSyntax(invalidCode, 'selectors.ts')).valid).toBe(false);
  });

  it('should validate selector fixtures for Kuronavi', async () => {
    const selectorsContent = readFileSync(
      join(__dirname, '../../../src/adapter/sites/kuronavi/selectors.ts'),
      'utf-8'
    );

    const result = await validator.validateSelectorFixtures({
      manifest: KURONAVI_SITE_MANIFEST,
      selectorsContent,
    });

    expect(result.valid).toBe(true);
    expect(result.fixtureResults?.every((fixture) => fixture.valid)).toBe(true);
  });
});
