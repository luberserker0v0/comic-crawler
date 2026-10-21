import { describe, expect, it } from '@jest/globals';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateSelectorDiscoveryEvalPolicy, loadSelectorDiscoveryEvalCases } from '../../../src/selector-discovery/eval-suite';

describe('selector-discovery eval suite', () => {
  selectorDiscoveryEvalSuiteTestGroup1();
});

async function writeCase(root: string, id: string, value: unknown): Promise<void> {
  const directory = join(root, 'eval', 'cases', id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'case.json'), `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function selectorDiscoveryEvalSuiteTestGroup1(): void {
  it('loads enabled cases and filters by case id', selectorDiscoveryEvalSuiteTestLoadsEnabledCasesAndFiltersByCaseId);
  it('loads the repository seed suite with positive and enabled safety negative cases', selectorDiscoveryEvalSuiteTestLoadsTheRepositorySeedSuiteWithPositiveAndEnabledSafetyNegativeCases);
  it('can explicitly include repository live negative cases', selectorDiscoveryEvalSuiteTestCanExplicitlyIncludeRepositoryLiveNegativeCases);
  it('requires all negative cases to pass and supports positive thresholds', selectorDiscoveryEvalSuiteTestRequiresAllNegativeCasesToPassAndSupportsPositiveThresholds);
}

async function selectorDiscoveryEvalSuiteTestLoadsEnabledCasesAndFiltersByCaseId() {
    const root = await mkdtemp(join(tmpdir(), 'selector-discovery-eval-'));
    await writeEvalFixtures(root);
    const all = await loadSelectorDiscoveryEvalCases({ bundleRoot: root });
    const filtered = await loadSelectorDiscoveryEvalCases({ bundleRoot: root, caseId: 'positive-a' });
    const liveNegative = await loadSelectorDiscoveryEvalCases({ bundleRoot: root, includeLiveNegative: true });
    const includeDisabled = await loadSelectorDiscoveryEvalCases({ bundleRoot: root, includeDisabled: true });
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
        id: 'positive-a',
        type: 'positive',
        defaultRuns: 3,
    });
    expect(filtered.map((testCase) => testCase.id)).toEqual(['positive-a']);
    expect(liveNegative.map((testCase) => testCase.id)).toEqual(['negative-b', 'positive-a']);
    expect(includeDisabled.map((testCase) => testCase.id)).toEqual(['disabled-positive-c', 'negative-b', 'positive-a']);
}

async function writeEvalFixtures(root: string): Promise<void> {
  await writeCase(root, 'positive-a', {
    id: 'positive-a', type: 'positive', enabled: true,
    url: 'https://example.com/manga/a', defaultRuns: 3,
  });
  await writeCase(root, 'negative-b', {
    id: 'negative-b', type: 'negative', enabled: false,
    live: true, url: 'https://example.com/not-comic',
  });
  await writeCase(root, 'disabled-positive-c', {
    id: 'disabled-positive-c', type: 'positive', enabled: false,
    url: 'https://example.com/manga/c',
  });
}

async function selectorDiscoveryEvalSuiteTestLoadsTheRepositorySeedSuiteWithPositiveAndEnabledSafetyNegativeCases() {
    const cases = await loadSelectorDiscoveryEvalCases({
        bundleRoot: join(process.cwd(), '..', 'agent', 'ao', 'selector-discovery'),
    });
    expect(cases.map((testCase) => testCase.id)).toEqual(expect.arrayContaining([
        'kuronavi-an-haxing-jian-guo-jia-noe-de-ling-zhu',
        'negative-file-url',
        'negative-localhost-private-url',
    ]));
    expect(cases.some((testCase) => testCase.id === 'negative-kuronavi-search-page')).toBe(false);
    expect(cases.some((testCase) => testCase.type === 'positive')).toBe(true);
    expect(cases.some((testCase) => testCase.type === 'negative')).toBe(true);
}

async function selectorDiscoveryEvalSuiteTestCanExplicitlyIncludeRepositoryLiveNegativeCases() {
    const cases = await loadSelectorDiscoveryEvalCases({
        bundleRoot: join(process.cwd(), '..', 'agent', 'ao', 'selector-discovery'),
        includeLiveNegative: true,
    });
    expect(cases.map((testCase) => testCase.id)).toEqual(expect.arrayContaining([
        'negative-kuronavi-search-page',
        'negative-kuronavi-home-page',
    ]));
    expect(cases.find((testCase) => testCase.id === 'negative-kuronavi-search-page')?.live).toBe(true);
}

function selectorDiscoveryEvalSuiteTestRequiresAllNegativeCasesToPassAndSupportsPositiveThresholds() {
    const relaxed = evaluateSelectorDiscoveryEvalPolicy(policyFixture(true));
    expect(relaxed.passed).toBe(true);
    const negativeFailure = evaluateSelectorDiscoveryEvalPolicy(policyFixture(false));
    expect(negativeFailure.passed).toBe(false);
    expect(negativeFailure.reasons).toContain('Negative eval failures 1/1; negative cases must pass 100%.');
    const strictDefault = evaluateSelectorDiscoveryEvalPolicy({
        runs: [
            { caseId: 'p1', type: 'positive', passed: true },
            { caseId: 'p2', type: 'positive', passed: false },
        ],
    });
    expect(strictDefault.passed).toBe(false);
    expect(strictDefault.positive.minPasses).toBe(2);
}

function policyFixture(negativePassed: boolean) {
  return { minPositivePasses: 2, maxPositiveFailures: 1, runs: [
    { caseId: 'p1', type: 'positive' as const, passed: true },
    { caseId: 'p2', type: 'positive' as const, passed: true },
    { caseId: 'p3', type: 'positive' as const, passed: false },
    { caseId: 'n1', type: 'negative' as const, passed: negativePassed },
  ] };
}
