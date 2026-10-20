import { ACTIVE_IMPLEMENTATION_ADAPTERS_KEY } from '../adapter/runtime-state';
import type { ActiveImplementationAdapterRecord } from '../selector-discovery/service';
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
    const records = (await storage.read<ActiveImplementationAdapterRecord[]>(ACTIVE_IMPLEMENTATION_ADAPTERS_KEY)) ?? [];
    const approved = records.filter((record) => record.approvalFixture);
    if (approved.length === 0) { ctx.ui.renderInfo('No approved adapter fixtures were found.'); return; }
    const rows = await Promise.all(approved.map((record) => verifyFixture(ctx, record)));
    ctx.ui.renderTable(['adapter', 'fixture', 'result'], rows);
    if (rows.some((row) => row[2] !== 'passed')) {
      ctx.ui.renderError('Approved adapter fixture verification failed.'); process.exitCode = 1; return;
    }
    ctx.ui.renderSuccess(`Verified ${approved.length} approved adapter fixture(s).`);
  } catch (error) { ctx.ui.renderError(formatError(error)); process.exitCode = 1; }
}

async function verifyFixture(ctx: CliCommandContext, record: ActiveImplementationAdapterRecord): Promise<string[]> {
  const fixture = record.approvalFixture!;
  const adapter = ctx.options.adapterRegistry.get(record.adapterId);
  if (!adapter) return [record.adapterId, fixture.id, 'missing adapter'];
  const result = await ctx.options.fixtureCaptureService!.verifyApprovedAdapterFixture(fixture.domain, fixture.id, adapter);
  return [record.adapterId, fixture.id, result.passed ? 'passed' : 'failed'];
}
