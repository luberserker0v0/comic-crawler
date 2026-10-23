import React from 'react';
import { api, getApiErrorMessage } from '../../api/client';
import type { AdapterResolutionPreview, TaskMode } from './widgets';

export function useAdapterPreview(mode: TaskMode | null, mangaUrl: string, firstChapterUrl: string) {
  const state = useAdapterPreviewState();
  usePreviewRequest(mode, mangaUrl, firstChapterUrl, state);
  const { setAdapterPreview, setAdapterPreviewError } = state;
  const resetAdapterPreview = React.useCallback(() => {
    setAdapterPreview(null);
    setAdapterPreviewError(null);
  }, [setAdapterPreview, setAdapterPreviewError]);
  return { adapterPreview: state.adapterPreview, adapterPreviewError: state.adapterPreviewError,
    adapterPreviewLoading: state.adapterPreviewLoading, resetAdapterPreview };
}

function useAdapterPreviewState() {
  const [adapterPreview, setAdapterPreview] = React.useState<AdapterResolutionPreview | null>(null);
  const [adapterPreviewError, setAdapterPreviewError] = React.useState<string | null>(null);
  const [adapterPreviewLoading, setAdapterPreviewLoading] = React.useState(false);
  return { adapterPreview, setAdapterPreview, adapterPreviewError, setAdapterPreviewError,
    adapterPreviewLoading, setAdapterPreviewLoading };
}

function usePreviewRequest(mode: TaskMode | null, mangaUrl: string, firstChapterUrl: string,
  state: ReturnType<typeof useAdapterPreviewState>) {
  const { setAdapterPreview, setAdapterPreviewError, setAdapterPreviewLoading } = state;
  React.useEffect(() => {
    const previewUrl = mode === 'all' ? mangaUrl.trim() : firstChapterUrl;
    if (!mode || !previewUrl) {
      setAdapterPreview(null);
      setAdapterPreviewError(null);
      return;
    }
    return schedulePreviewRequest(previewUrl, mode,
      { setAdapterPreview, setAdapterPreviewError, setAdapterPreviewLoading });
  }, [mode, mangaUrl, firstChapterUrl, setAdapterPreview, setAdapterPreviewError, setAdapterPreviewLoading]);
}

type PreviewSetters = Pick<ReturnType<typeof useAdapterPreviewState>,
  'setAdapterPreview' | 'setAdapterPreviewError' | 'setAdapterPreviewLoading'>;

function schedulePreviewRequest(url: string, mode: TaskMode, state: PreviewSetters) {
  let cancelled = false;
  state.setAdapterPreviewLoading(true);
  const timer = window.setTimeout(() => void resolvePreview(url, mode, state, () => cancelled), 350);
  return () => { cancelled = true; window.clearTimeout(timer); };
}

async function resolvePreview(url: string, mode: TaskMode, state: PreviewSetters, cancelled: () => boolean) {
  try {
    const response = await api.resolveAdapter({ url, mode });
    if (cancelled()) return;
    state.setAdapterPreview({ ...response.data, mode });
    state.setAdapterPreviewError(null);
  } catch (error) {
    if (cancelled()) return;
    state.setAdapterPreview(null);
    state.setAdapterPreviewError(getApiErrorMessage(error));
  } finally {
    if (!cancelled()) state.setAdapterPreviewLoading(false);
  }
}
