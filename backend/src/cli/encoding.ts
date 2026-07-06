import { cliMessages } from './messages';

let initialized = false;

export function enableCliUtf8(): void {
  if (initialized) {
    return;
  }

  process.stdout.setDefaultEncoding('utf8');
  process.stderr.setDefaultEncoding('utf8');
  process.env.PYTHONIOENCODING = 'utf-8';
  initialized = true;

  if (process.platform === 'win32') {
    process.stderr.write(`${cliMessages.ui.utf8Ready}\n`);
  }
}
