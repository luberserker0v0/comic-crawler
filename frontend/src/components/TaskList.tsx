import React from 'react';
import { Link } from 'react-router-dom';
import { useTaskStore, type Task } from '../store';
import { useI18n } from '../text/i18n';
import { ProgressBar } from './ProgressBar';

interface TaskListProps {
  tasks?: Task[];
  showDetailLink?: boolean;
}

export const TaskList: React.FC<TaskListProps> = ({ tasks, showDetailLink = false }) => {
  const { tasks: storeTasks, pauseTask, resumeTask, cancelTask, deleteTask } = useTaskStore();
  const displayTasks = tasks ?? storeTasks;
  const { text } = useI18n();

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'text-blue-600';
      case 'completed':
        return 'text-green-600';
      case 'failed':
        return 'text-red-600';
      case 'waiting_verification':
        return 'text-purple-600';
      case 'interrupted':
        return 'text-orange-600';
      case 'paused':
        return 'text-yellow-600';
      case 'cancelled':
        return 'text-gray-600';
      default:
        return 'text-gray-600';
    }
  };

  const getStatusLabel = (status: string) => text.taskList.statusLabels[status as keyof typeof text.taskList.statusLabels] ?? status;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{text.taskList.id}</th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{text.taskList.url}</th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{text.taskList.status}</th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{text.taskList.priority}</th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{text.taskList.actions}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {displayTasks.map((task) => (
            <tr key={task.id}>
              <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                {task.id.slice(0, 12)}
              </td>
              <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                {task.url.slice(0, 50)}
              </td>
              <td className="px-6 py-4 text-sm">
                <span className={`font-medium ${getStatusColor(task.status)}`}>
                  {getStatusLabel(task.status)}
                </span>
                {task.progress && task.progress.totalItems > 0 && (
                  <div className="mt-2 min-w-[180px]">
                    <ProgressBar
                      current={task.progress.completedItems}
                      total={task.progress.totalItems}
                      className="max-w-xs"
                    />
                    <div className="mt-1 text-xs text-gray-500">
                      {text.taskList.progress}: {task.progress.percentage}%{task.progress.currentItems ? ` · ${task.progress.currentItems}` : ''}
                    </div>
                  </div>
                )}
              </td>
              <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                {task.priority}
              </td>
              <td className="whitespace-nowrap px-6 py-4 text-sm space-x-2">
                {task.status === 'running' && (
                  <button
                    onClick={() => pauseTask(task.id)}
                    className="text-yellow-600 hover:text-yellow-900"
                  >
                    {text.taskList.pause}
                  </button>
                )}
                {(task.status === 'paused' || task.status === 'interrupted' || task.status === 'waiting_verification') && (
                  <button
                    onClick={() => resumeTask(task.id)}
                    className="text-green-600 hover:text-green-900"
                  >
                    {text.taskList.resume}
                  </button>
                )}
                {(task.status === 'running' || task.status === 'pending' || task.status === 'paused') && (
                  <button
                    onClick={() => cancelTask(task.id)}
                    className="text-red-600 hover:text-red-900"
                  >
                    {text.taskList.cancel}
                  </button>
                )}
                {['completed', 'failed', 'cancelled', 'interrupted', 'waiting_verification'].includes(task.status) && (
                  <button
                    onClick={() => deleteTask(task.id)}
                    className="text-slate-600 hover:text-slate-900"
                  >
                    {text.taskList.delete}
                  </button>
                )}
                {showDetailLink && (
                  <Link to={`/tasks/${task.id}`} className="text-blue-600 hover:text-blue-900">
                    {text.taskList.view}
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {displayTasks.length === 0 && (
        <div className="py-8 text-center text-gray-500">
          {text.taskList.empty}
        </div>
      )}
    </div>
  );
};
