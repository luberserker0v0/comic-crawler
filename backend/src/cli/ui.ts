export interface ProgressBarOptions {
  width?: number;
  completeChar?: string;
  incompleteChar?: string;
}

export class TerminalUI {
  private options: Required<ProgressBarOptions>;

  constructor(options?: ProgressBarOptions) {
    this.options = {
      width: options?.width ?? 30,
      completeChar: options?.completeChar ?? '#',
      incompleteChar: options?.incompleteChar ?? '-',
    };
  }

  renderProgress(current: number, total: number, label?: string): void {
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
    const safeTotal = total > 0 ? total : 1;
    const filled = Math.round((this.options.width * current) / safeTotal);
    const empty = this.options.width - filled;

    const bar = this.options.completeChar.repeat(filled) + this.options.incompleteChar.repeat(empty);
    const text = label ? `${label} ` : '';

    process.stdout.write(`\r${text}[${bar}] ${current}/${total} (${percentage}%)`);

    if (current >= total) {
      process.stdout.write('\n');
    }
  }

  renderStatus(status: string, value: string): void {
    console.log(`${status}: ${value}`);
  }

  renderError(message: string): void {
    console.error(`\x1b[31m錯誤: ${message}\x1b[0m`);
  }

  renderSuccess(message: string): void {
    console.log(`\x1b[32m${message}\x1b[0m`);
  }

  renderWarning(message: string): void {
    console.log(`\x1b[33m警告: ${message}\x1b[0m`);
  }

  renderInfo(message: string): void {
    console.log(`\x1b[36m${message}\x1b[0m`);
  }

  renderTable(headers: string[], rows: string[][]): void {
    const colWidths = headers.map((header, index) =>
      Math.max(header.length, ...rows.map((row) => (row[index] ?? '').length))
    );

    const formatRow = (cells: string[]) =>
      cells.map((cell, index) => cell.padEnd(colWidths[index])).join(' | ');

    console.log(formatRow(headers));
    console.log(colWidths.map((width) => '-'.repeat(width)).join('-+-'));
    rows.forEach((row) => console.log(formatRow(row)));
  }

  clearLine(): void {
    process.stdout.write('\r\x1b[K');
  }
}
