import { useI18n } from '../../../text/i18n';
import type { TaskDetail } from '../../../store';
import { formatBytes, formatDate } from '../widgets';

export function PreviewSection(props: {
  detail: TaskDetail;
}) {
  const { text } = useI18n();
  const { detail } = props;

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900">{text.taskManager.previewTitle}</h3>
        {detail.preview && (
          <div className="text-sm text-slate-500">
            {text.taskManager.files}: {detail.preview.totalFiles}
          </div>
        )}
      </div>
      {detail.preview ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.25em] text-slate-400">
            {detail.preview.rootDir}
          </div>
          <div className="divide-y divide-slate-100">
            {detail.preview.files.map((file) => (
              <div key={file.relativePath} className="grid gap-3 px-4 py-3 md:grid-cols-[72px_1.6fr_0.5fr_0.7fr]">
                <div className="h-16 w-16 overflow-hidden rounded border border-slate-200 bg-slate-50">
                  {file.isImage && file.url ? (
                    <img src={file.url} alt={file.name} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">File</div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">{file.relativePath}</div>
                  <div className="mt-1 text-xs text-slate-500">{file.name}</div>
                </div>
                <div className="text-sm text-slate-600">{formatBytes(file.size)}</div>
                <div className="text-sm text-slate-600">{formatDate(file.modifiedAt)}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          {text.taskManager.noPreview}
        </div>
      )}
    </div>
  );
}
