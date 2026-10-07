import { Link } from 'react-router-dom';
import { useI18n } from '../../../text/i18n';
import type { Task } from '../../../store';
import { ProgressBar } from '../../../components/ProgressBar';

export function TaskListSection(props: {
  tasks: Task[];
  loading: boolean;
  selectedTaskId: string | null;
}) {
  const { text } = useI18n();
  const { tasks, loading, selectedTaskId } = props;

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow">
      <div className="border-b border-slate-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-slate-900">{text.taskManager.listTitle}</h2>
      </div>
      <div className="divide-y divide-slate-100">
        {tasks.map((task) => {
          const isSelected = selectedTaskId === task.id;
          return (
            <Link
              key={task.id}
              to={`/tasks/${task.id}`}
              className={`block px-6 py-4 transition hover:bg-slate-50 ${isSelected ? 'bg-slate-50' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">{task.id}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">{task.url}</div>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">
                  {text.taskList.statusLabels[task.status as keyof typeof text.taskList.statusLabels] ?? task.status}
                </span>
              </div>
              {task.progress && task.progress.totalItems > 0 && (
                <div className="mt-3">
                  <ProgressBar current={task.progress.completedItems} total={task.progress.totalItems} />
                </div>
              )}
            </Link>
          );
        })}
        {!loading && tasks.length === 0 && (
          <div className="px-6 py-10 text-center text-sm text-slate-500">{text.taskList.empty}</div>
        )}
      </div>
    </section>
  );
}
