import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BrowserResourceSummary, BrowserTarget, BrowserWorkerSummary } from '@comiccrawler/shared';
import { api, getApiErrorMessage } from '../../api/client';

export interface BrowserTargetOption {
  key: string;
  kind: BrowserTarget['mode'];
  workerName: string;
  title?: string;
  url?: string;
  target: BrowserTarget;
}

export function useBrowserTargets(url: string) {
  const [workers, setWorkers] = useState<BrowserWorkerSummary[]>([]);
  const [resources, setResources] = useState<BrowserResourceSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => loadBrowserTargets(setWorkers, setResources, setLoading, setError), []);
  const options = useMemo(() => buildBrowserTargetOptions(workers, resources, url), [workers, resources, url]);
  useBrowserTargetPolling(refresh);
  useDefaultBrowserTarget(options, selectedKey, setSelectedKey);
  return { options, selectedKey, setSelectedKey, loading, error, refresh,
    selectedTarget: options.find((option) => option.key === selectedKey)?.target };
}

function useBrowserTargetPolling(refresh: () => Promise<void>): void {
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
}

function useDefaultBrowserTarget(options: BrowserTargetOption[], selectedKey: string,
  setSelectedKey: (value: string) => void): void {
  useEffect(() => {
    if (options.some((option) => option.key === selectedKey)) return;
    setSelectedKey(options[0]?.key ?? '');
  }, [options, selectedKey, setSelectedKey]);
}

async function loadBrowserTargets(
  setWorkers: (value: BrowserWorkerSummary[]) => void,
  setResources: (value: BrowserResourceSummary[]) => void,
  setLoading: (value: boolean) => void,
  setError: (value: string | null) => void
): Promise<void> {
  setLoading(true); setError(null);
  try {
    const [workers, resources] = await Promise.all([api.getBrowserWorkers(), api.getBrowserResources()]);
    setWorkers(workers.data.workers); setResources(resources.data.resources);
  } catch (error) { setError(getApiErrorMessage(error)); }
  finally { setLoading(false); }
}

export function buildBrowserTargetOptions(
  workers: BrowserWorkerSummary[], resources: BrowserResourceSummary[], url: string
): BrowserTargetOption[] {
  const available = workers.filter((worker) => worker.online && worker.status === 'idle');
  return [...existingTabOptions(available, resources, url), ...managedProfileOptions(available)];
}

export function browserTargetMissingForRun(
  required: boolean, challengeId: string | undefined, selectedTarget: BrowserTarget | undefined
): boolean {
  return required && !challengeId && !selectedTarget;
}

function existingTabOptions(
  workers: BrowserWorkerSummary[], resources: BrowserResourceSummary[], url: string
): BrowserTargetOption[] {
  const byId = new Map(workers.filter((worker) => executionMode(worker) === 'existing-tab')
    .map((worker) => [worker.workerId, worker]));
  return resources.filter((resource) => byId.has(resource.workerId) && samePage(resource.url, url))
    .map((resource) => resourceOption(resource, byId.get(resource.workerId)!));
}

function managedProfileOptions(workers: BrowserWorkerSummary[]): BrowserTargetOption[] {
  return workers.filter((worker) => executionMode(worker) === 'managed-profile').map((worker) => ({
    key: `managed:${worker.workerId}`, kind: 'managed-profile', workerName: worker.name,
    target: { mode: 'managed-profile', workerId: worker.workerId },
  }));
}

function resourceOption(resource: BrowserResourceSummary, worker: BrowserWorkerSummary): BrowserTargetOption {
  return { key: `existing:${worker.workerId}:${resource.resourceId}`, kind: 'existing-tab',
    workerName: worker.name, title: resource.title, url: resource.url,
    target: { mode: 'existing-tab', workerId: worker.workerId, resourceId: resource.resourceId } };
}

function executionMode(worker: BrowserWorkerSummary): unknown {
  return worker.capabilities?.executionMode;
}

function samePage(left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left); const rightUrl = new URL(right);
    leftUrl.hash = ''; rightUrl.hash = '';
    return leftUrl.href === rightUrl.href;
  } catch { return false; }
}
