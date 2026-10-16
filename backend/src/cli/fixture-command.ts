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
    .action(async () => {
      const storage = ctx.options.storage;
      const fixtureService = ctx.options.fixtureCaptureService;
      if (!storage || !fixtureService) {
        ctx.ui.renderError('Fixture verification is not available.');
        process.exitCode = 1;
        return;
      }

      try {
        const records = (await storage.read<ActiveImplementationAdapterRecord[]>(ACTIVE_IMPLEMENTATION_ADAPTERS_KEY)) ?? [];
        const approved = records.filter((record) => record.approvalFixture);
        if (approved.length === 0) {
          ctx.ui.renderInfo('No approved adapter fixtures were found.');
          return;
        }

        const rows: string[][] = [];
        let failed = false;
        for (const record of approved) {
          const adapter = ctx.options.adapterRegistry.get(record.adapterId);
          if (!adapter) {
            rows.push([record.adapterId, record.approvalFixture!.id, 'missing adapter']);
            failed = true;
            continue;
          }
          const result = await fixtureService.verifyApprovedAdapterFixture(
            record.approvalFixture!.domain,
            record.approvalFixture!.id,
            adapter
          );
          rows.push([record.adapterId, record.approvalFixture!.id, result.passed ? 'passed' : 'failed']);
          failed ||= !result.passed;
        }
        ctx.ui.renderTable(['adapter', 'fixture', 'result'], rows);
        if (failed) {
          ctx.ui.renderError('Approved adapter fixture verification failed.');
          process.exitCode = 1;
          return;
        }
        ctx.ui.renderSuccess(`Verified ${approved.length} approved adapter fixture(s).`);
      } catch (error) {
        ctx.ui.renderError(formatError(error));
        process.exitCode = 1;
      }
    });
}
