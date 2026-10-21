import { describe, it, expect, beforeEach } from '@jest/globals';
import { CodeValidator } from '../../../src/agent/code-validator';
import { KURONAVI_SITE_MANIFEST } from '../../../src/adapter/sites/kuronavi';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let validator: CodeValidator;

describe('CodeValidator', () => {
  CodeValidatorTestGroup1();
});

function CodeValidatorTestGroup1(): void {
  beforeEach(CodeValidatorTestScenario1);
  it('should validate valid selectors', CodeValidatorTestShouldValidateValidSelectors);
  it('should reject empty selectors', CodeValidatorTestShouldRejectEmptySelectors);
  it('should reject selectors without export', CodeValidatorTestShouldRejectSelectorsWithoutExport);
  it('should validate valid parser', CodeValidatorTestShouldValidateValidParser);
  it('should reject empty parser', CodeValidatorTestShouldRejectEmptyParser);
  it('should validate both files', CodeValidatorTestShouldValidateBothFiles);
  it('should check JavaScript syntax', CodeValidatorTestShouldCheckJavaScriptSyntax);
  it('should check TypeScript syntax', CodeValidatorTestShouldCheckTypeScriptSyntax);
  it('should validate selector fixtures for Kuronavi', CodeValidatorTestShouldValidateSelectorFixturesForKuronavi);
}

function CodeValidatorTestScenario1() {
    validator = new CodeValidator();
}

async function CodeValidatorTestShouldValidateValidSelectors() {
    const content = 'export const selectors = { title: ".title" };';
    const result = await validator.validateSelectors(content);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.selectorsHash).toBeDefined();
    expect(result.syntaxValid).toBe(true);
}

async function CodeValidatorTestShouldRejectEmptySelectors() {
    const result = await validator.validateSelectors('');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Selectors content is empty');
}

async function CodeValidatorTestShouldRejectSelectorsWithoutExport() {
    const content = 'const selectors = { title: ".title" };';
    const result = await validator.validateSelectors(content);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('No export statement found');
}

async function CodeValidatorTestShouldValidateValidParser() {
    const content = 'export function parse(html: string) { return html; }';
    const result = await validator.validateParser(content);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.parserHash).toBeDefined();
    expect(result.syntaxValid).toBe(true);
}

async function CodeValidatorTestShouldRejectEmptyParser() {
    const result = await validator.validateParser('');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Parser content is empty');
}

async function CodeValidatorTestShouldValidateBothFiles() {
    const selectors = 'export const selectors = { title: ".title" };';
    const parser = 'export function parse(html: string) { return html; }';
    const result = await validator.validateBoth(selectors, parser);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.syntaxValid).toBe(true);
}

async function CodeValidatorTestShouldCheckJavaScriptSyntax() {
    const validCode = 'const x = 1 + 2;';
    const invalidCode = 'const x = ;';
    expect((await validator.checkSyntax(validCode)).valid).toBe(true);
    expect((await validator.checkSyntax(invalidCode)).valid).toBe(false);
}

async function CodeValidatorTestShouldCheckTypeScriptSyntax() {
    const validCode = 'export const selectors = { title: ".title" } as const;';
    const invalidCode = 'export const selectors = { title: ".title", }; const broken: = 1;';
    expect((await validator.checkTypeScriptSyntax(validCode, 'selectors.ts')).valid).toBe(true);
    expect((await validator.checkTypeScriptSyntax(invalidCode, 'selectors.ts')).valid).toBe(false);
}

async function CodeValidatorTestShouldValidateSelectorFixturesForKuronavi() {
    const selectorsContent = readFileSync(join(__dirname, '../../../src/adapter/sites/kuronavi/selectors.ts'), 'utf-8');
    const result = await validator.validateSelectorFixtures({
        manifest: KURONAVI_SITE_MANIFEST,
        selectorsContent,
    });
    expect(result.valid).toBe(true);
    expect(result.fixtureResults?.every((fixture) => fixture.valid)).toBe(true);
}
