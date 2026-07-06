import { describe, it, expect, beforeEach } from '@jest/globals';
import { TerminalUI } from '../../../src/cli/ui';

describe('TerminalUI', () => {
  let ui: TerminalUI;

  beforeEach(() => {
    ui = new TerminalUI({ width: 20 });
  });

  it('should render progress bar', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    ui.renderProgress(5, 10, 'Downloading');

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should render status', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});

    ui.renderStatus('Test', 'Value');

    expect(spy).toHaveBeenCalledWith('Test: Value');
    spy.mockRestore();
  });

  it('should render error', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    ui.renderError('Test error');

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should render success', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});

    ui.renderSuccess('Success message');

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should render warning', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});

    ui.renderWarning('Warning message');

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should render info', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});

    ui.renderInfo('Info message');

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should render table', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});

    ui.renderTable(['Name', 'Age'], [['Alice', '25'], ['Bob', '30']]);

    expect(spy).toHaveBeenCalledTimes(4);
    spy.mockRestore();
  });

  it('should clear line', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    ui.clearLine();

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
