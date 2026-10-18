import { Command } from 'commander';
import { TerminalUI } from './ui';
import { cliMessages } from './messages';
import { enableCliUtf8 } from './encoding';
import type { CliCommandContext, CliOptions } from './command-context';
import { setupAgentCommand } from './agent-command';
import { setupConfigCommand, setupDownloadCommand, setupSearchCommand, setupStatusCommand } from './core-commands';
import { setupDiscoverCommand } from './discovery-command';
import { setupMaintenanceCommand } from './maintenance-command';
import { setupFixtureCommand } from './fixture-command';
import { COMICCRAWLER_VERSION } from '../version';

export { TerminalUI } from './ui';
export type { CliOptions } from './command-context';

export class ComicCrawlerCli {
  private program: Command;
  private readonly ctx: CliCommandContext;

  constructor(options: CliOptions) {
    this.program = new Command();
    this.ctx = { program: this.program, options, ui: new TerminalUI() };
    enableCliUtf8();
    this.setupCommands();
  }

  private setupCommands(): void {
    this.program
      .name('comiccrawler')
      .description(cliMessages.appDescription)
      .version(COMICCRAWLER_VERSION);

    setupDownloadCommand(this.ctx);
    setupConfigCommand(this.ctx);
    setupStatusCommand(this.ctx);
    setupSearchCommand(this.ctx);
    setupDiscoverCommand(this.ctx);
    setupAgentCommand(this.ctx);
    setupMaintenanceCommand(this.ctx);
    setupFixtureCommand(this.ctx);
  }

  parse(args: string[]): Command {
    return this.program.parse(args);
  }

  getProgram(): Command {
    return this.program;
  }
}
