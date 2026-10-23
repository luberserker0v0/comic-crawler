import type { AdapterPackageDocument } from '@comiccrawler/shared';
import { AdapterCatalog } from '../adapter/catalog';
import { formatError } from '../error/types';
import type { CliCommandContext } from './command-context';

export function setupFixtureCommand(ctx: CliCommandContext): void {
  const fixture = ctx.program
    .command('fixtures')
    .description('Verify approved adapter fixtures');

  fixture
    .command('verify')
    .description('Replay every approved adapter fixture and fail on output differences')
    .action(async () => verifyFixtures(ctx));
}

async function verifyFixtures(ctx: CliCommandContext): Promise<void> {
  const storage = ctx.options.storage;
  const service = ctx.options.fixtureCaptureService;
  if (!storage || !service) { ctx.ui.renderError('Fixture verification is not available.'); process.exitCode = 1; return; }
  try {
    const approved = (await new AdapterCatalog(storage).getActivePackages())
      .filter((document) => document.manifest.approvalFixture);
    if (approved.length === 0) { ctx.ui.renderInfo('No approved adapter fixtures were found.'); return; }
    const rows = await Promise.all(approved.map((record) => verifyFixture(ctx, record)));
    ctx.ui.renderTable(['adapter', 'fixture', 'result'], rows);
    if (rows.some((row) => row[2] !== 'passed')) {
      ctx.ui.renderError('Approved adapter fixture verification failed.'); process.exitCode = 1; return;
    }
    ctx.ui.renderSuccess(`Verified ${approved.length} approved adapter fixture(s).`);
  } catch (error) { ctx.ui.renderError(formatError(error)); process.exitCode = 1; }
}

async function verifyFixture(ctx: CliCommandContext, document: AdapterPackageDocument): Promise<string[]> {
  const fixture = document.manifest.approvalFixture!;
  const adapterId = document.manifest.adapterId;
  const adapter = ctx.options.adapterRegistry.get(adapterId);
  if (!adapter) return [adapterId, fixture.id, 'missing adapter'];
  const result = await ctx.options.fixtureCaptureService!.verifyApprovedAdapterFixture(document.manifest, adapter);
  return [adapterId, fixture.id, result.passed ? 'passed' : 'failed'];
}
