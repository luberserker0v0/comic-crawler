import { describe, it, expect, beforeEach } from '@jest/globals';
import { TerminalUI } from '../../../src/cli/ui';

let ui: TerminalUI;

describe('TerminalUI', () => {
  TerminalUITestGroup1();
});

function TerminalUITestGroup1(): void {
  beforeEach(TerminalUITestScenario1);
  it('should render progress bar', TerminalUITestShouldRenderProgressBar);
  it('should render status', TerminalUITestShouldRenderStatus);
  it('should render error', TerminalUITestShouldRenderError);
  it('should render success', TerminalUITestShouldRenderSuccess);
  it('should render warning', TerminalUITestShouldRenderWarning);
  it('should render info', TerminalUITestShouldRenderInfo);
  it('should render table', TerminalUITestShouldRenderTable);
  it('should clear line', TerminalUITestShouldClearLine);
}

function TerminalUITestScenario1() {
    ui = new TerminalUI({ width: 20 });
}

function TerminalUITestShouldRenderProgressBar() {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    ui.renderProgress(5, 10, 'Downloading');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
}

function TerminalUITestShouldRenderStatus() {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => { });
    ui.renderStatus('Test', 'Value');
    expect(spy).toHaveBeenCalledWith('Test: Value');
    spy.mockRestore();
}

function TerminalUITestShouldRenderError() {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => { });
    ui.renderError('Test error');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
}

function TerminalUITestShouldRenderSuccess() {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => { });
    ui.renderSuccess('Success message');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
}

function TerminalUITestShouldRenderWarning() {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => { });
    ui.renderWarning('Warning message');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
}

function TerminalUITestShouldRenderInfo() {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => { });
    ui.renderInfo('Info message');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
}

function TerminalUITestShouldRenderTable() {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => { });
    ui.renderTable(['Name', 'Age'], [['Alice', '25'], ['Bob', '30']]);
    expect(spy).toHaveBeenCalledTimes(4);
    spy.mockRestore();
}

function TerminalUITestShouldClearLine() {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    ui.clearLine();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
}
