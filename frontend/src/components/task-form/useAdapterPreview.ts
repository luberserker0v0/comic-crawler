import React from 'react';
import { api, getApiErrorMessage } from '../../api/client';
import type { AdapterResolutionPreview, TaskMode } from './widgets';

export function useAdapterPreview(mode: TaskMode | null, mangaUrl: string, firstChapterUrl: string) {
  const [adapterPreview, setAdapterPreview] = React.useState<AdapterResolutionPreview | null>(null);
  const [adapterPreviewError, setAdapterPreviewError] = React.useState<string | null>(null);
  const [adapterPreviewLoading, setAdapterPreviewLoading] = React.useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- TODO(frontend-effect-cleanup): debounced live-preview fetch with sync reset; remodel to render-time derivation */
  React.useEffect(() => {
    const previewUrl = mode === 'all' ? mangaUrl.trim() : firstChapterUrl;
    if (!mode || !previewUrl) {
      setAdapterPreview(null);
      setAdapterPreviewError(null);
      return;
    }

    let cancelled = false;
    setAdapterPreviewLoading(true);
    const timer = window.setTimeout(() => {
      api.resolveAdapter({ url: previewUrl, mode })
        .then((response) => {
          if (cancelled) return;
          setAdapterPreview(response.data);
          setAdapterPreviewError(null);
        })
        .catch((err: any) => {
          if (cancelled) return;
          setAdapterPreview(null);
          setAdapterPreviewError(getApiErrorMessage(err));
        })
        .finally(() => {
          if (!cancelled) setAdapterPreviewLoading(false);
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mode, mangaUrl, firstChapterUrl]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const resetAdapterPreview = React.useCallback(() => {
    setAdapterPreview(null);
    setAdapterPreviewError(null);
  }, []);

  return {
    adapterPreview,
    adapterPreviewError,
    adapterPreviewLoading,
    resetAdapterPreview,
  };
}
