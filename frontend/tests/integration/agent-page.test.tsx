import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { AgentPage } from '../../src/pages/AgentPage';
import { api } from '../../src/api/client';
import { useAgentStore } from '../../src/store';
import { uiText } from '../../src/text/zhTW';

let realtimeCallback: ((message: { event?: string; data?: Record<string, unknown> }) => void) | undefined;

jest.mock('../../src/hooks', () => {
  const actual = jest.requireActual('../../src/hooks') as object;

  return {
    ...actual,
    useWebSocket: (_url: string, onMessage?: (message: { event?: string; data?: Record<string, unknown> }) => void) => {
      realtimeCallback = onMessage;
      return {
        connected: true,
        subscribe: jest.fn(),
        unsubscribe: jest.fn(),
      };
    },
  };
});

const baseSummary = [
  {
    adapterId: 'kuronavi',
    sessionStatus: 'awaiting_review',
    activeVersion: 'v1',
    latestCandidate: 'v2',
    versionCount: 2,
  },
  {
    adapterId: 'mocksite',
    sessionStatus: null,
    activeVersion: null,
    latestCandidate: null,
    versionCount: 0,
  },
];

const baseDetail = {
  adapterId: 'kuronavi',
  session: {
    sessionId: 'session-1',
    status: 'awaiting_review',
    pageType: 'metadata',
    repairMode: 'selector-only',
    triggerKey: 'kuronavi:metadata:metadata.title',
    currentAttempt: 1,
    maxAttempts: 5,
    candidateVersion: 'v2',
    sourceVersion: 'v1',
    lastFailure: {
      reason: 'Missing metadata title output',
      timestamp: new Date().toISOString(),
    },
  },
  activeVersion: {
    version: 'v1',
    status: 'active',
    basedOnVersion: null,
    repairMode: 'selector-only',
    testResults: { passed: 2, failed: 0 },
  },
  latestCandidate: {
    version: 'v2',
    status: 'candidate',
    basedOnVersion: 'v1',
    repairMode: 'selector-only',
    testResults: { passed: 1, failed: 1 },
    validation: {
      syntaxValid: true,
      fixtureResults: [
        { fixtureName: 'metadata', valid: false, errors: ['Title did not match expected output'] },
        { fixtureName: 'images', valid: true, errors: [] },
      ],
    },
  },
  versions: {
    adapterId: 'kuronavi',
    activeVersion: 'v1',
    versions: [
      {
        version: 'v2',
        status: 'candidate',
        basedOnVersion: 'v1',
        repairMode: 'selector-only',
        testResults: { passed: 1, failed: 1 },
        validation: {
          syntaxValid: true,
          fixtureResults: [
            { fixtureName: 'metadata', valid: false, errors: ['Title did not match expected output'] },
            { fixtureName: 'images', valid: true, errors: [] },
          ],
        },
      },
      {
        version: 'v1',
        status: 'active',
        basedOnVersion: null,
        repairMode: 'selector-only',
        testResults: { passed: 2, failed: 0 },
        validation: {
          syntaxValid: true,
          fixtureResults: [
            { fixtureName: 'metadata', valid: true, errors: [] },
            { fixtureName: 'images', valid: true, errors: [] },
          ],
        },
      },
    ],
  },
};

describe('AgentPage interactions', () => {
  let getAgentAdaptersSpy: ReturnType<typeof jest.spyOn>;
  let getAgentAdapterSpy: ReturnType<typeof jest.spyOn>;
  let promoteSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    jest.restoreAllMocks();
    realtimeCallback = undefined;
    window.localStorage.clear();
    useAgentStore.setState({
      adapters: [],
      selectedAdapterId: null,
      selectedAdapter: null,
      loading: false,
      actionLoading: false,
      error: null,
    } as Partial<ReturnType<typeof useAgentStore.getState>>);

    getAgentAdaptersSpy = jest.spyOn(api, 'getAgentAdapters').mockResolvedValue({ data: baseSummary });
    getAgentAdapterSpy = jest.spyOn(api, 'getAgentAdapter').mockResolvedValue({ data: baseDetail });
    promoteSpy = jest.spyOn(api, 'promoteAgentCandidate').mockResolvedValue({ data: { success: true, version: 'v2' } });
    jest.spyOn(api, 'rejectAgentCandidate').mockResolvedValue({ data: { success: true, version: 'v2' } });
    jest.spyOn(api, 'rollbackAgentAdapter').mockResolvedValue({ data: { success: true, currentVersion: 'v1' } });
  });

  it('should show confirmation before promoting a candidate', async () => {
    render(<AgentPage />);

    await screen.findByText('kuronavi');
    fireEvent.click(screen.getByText(uiText.agent.promoteCandidate));

    expect(screen.getByText(uiText.agent.pendingActions.promoteTitle)).toBeInTheDocument();
    expect(screen.getByText(/這會把 v2 升級成 kuronavi 的正式 runtime 版本/)).toBeInTheDocument();

    fireEvent.click(screen.getByText(uiText.agent.pendingActions.confirm));

    await waitFor(() => {
      expect(promoteSpy).toHaveBeenCalledWith('kuronavi', 'v2');
    });
  });

  it('should render selected version details and fixture errors', async () => {
    render(<AgentPage />);

    await screen.findByText('kuronavi');
    expect(screen.getByText(uiText.agent.fixtureResults)).toBeInTheDocument();
    expect(screen.getByText('Title did not match expected output')).toBeInTheDocument();
    expect(screen.getByText(uiText.agent.syntaxPassed)).toBeInTheDocument();
  });

  it('should patch adapter summary from realtime events without refetching the full list', async () => {
    render(<AgentPage />);

    await screen.findByText('mocksite');
    const getAgentAdaptersCallsBefore = getAgentAdaptersSpy.mock.calls.length;
    const getAgentAdapterCallsBefore = getAgentAdapterSpy.mock.calls.length;

    await act(async () => {
      realtimeCallback?.({
        event: 'adapter:repair:candidate-created',
        data: {
          adapterId: 'mocksite',
          version: 'v3',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('v3')).toBeInTheDocument();
    });

    expect(getAgentAdaptersSpy.mock.calls.length).toBe(getAgentAdaptersCallsBefore);
    expect(getAgentAdapterSpy.mock.calls.length).toBe(getAgentAdapterCallsBefore);
  });
});
