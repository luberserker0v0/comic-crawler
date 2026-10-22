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
  const actions = { pauseTask, resumeTask, cancelTask, deleteTask };
  return <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200">
    <TaskTableHeader text={text} />
    <tbody className="divide-y divide-gray-200 bg-white">{displayTasks.map((task) =>
      <TaskRow key={task.id} task={task} actions={actions} showDetailLink={showDetailLink} text={text} />)}</tbody>
  </table>{displayTasks.length === 0 && <div className="py-8 text-center text-gray-500">{text.taskList.empty}</div>}</div>;
};

type TaskText = ReturnType<typeof useI18n>['text'];
type TaskActions = Pick<ReturnType<typeof useTaskStore.getState>, 'pauseTask' | 'resumeTask' | 'cancelTask' | 'deleteTask'>;

function getStatusColor(status: string) {
  const colors: Record<string, string> = { running: 'text-blue-600', completed: 'text-green-600',
    failed: 'text-red-600', waiting_verification: 'text-purple-600', interrupted: 'text-orange-600',
    paused: 'text-yellow-600', cancelled: 'text-gray-600' };
  return colors[status] ?? 'text-gray-600';
}

function canResumeTask(task: Task) {
  return task.status === 'paused' || task.status === 'interrupted' || task.status === 'waiting_verification'
    || ((task.status === 'failed' || task.status === 'completed') && task.checkpoint?.resumable === true);
}

function TaskTableHeader({ text }: { text: TaskText }) {
  const labels = [text.taskList.id, text.taskList.url, text.taskList.status, text.taskList.priority, text.taskList.actions];
  return <thead className="bg-gray-50"><tr>{labels.map((label) => <th key={label}
    className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{label}</th>)}</tr></thead>;
}

function TaskRow(props: { task: Task; actions: TaskActions; showDetailLink: boolean; text: TaskText }) {
  const { task, text } = props;
  return <tr><td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">{task.id.slice(0, 12)}</td>
    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">{task.url.slice(0, 50)}</td>
    <td className="px-6 py-4 text-sm"><span className={`font-medium ${getStatusColor(task.status)}`}>
      {text.taskList.statusLabels[task.status as keyof typeof text.taskList.statusLabels] ?? task.status}</span>
      <TaskProgress task={task} text={text} /></td>
    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">{task.priority}</td>
    <TaskActionCell {...props} />
  </tr>;
}

function TaskProgress({ task, text }: { task: Task; text: TaskText }) {
  if (!task.progress || task.progress.totalItems <= 0) return null;
  return <div className="mt-2 min-w-[180px]"><ProgressBar current={task.progress.completedItems}
    total={task.progress.totalItems} className="max-w-xs" />
    <div className="mt-1 text-xs text-gray-500">{text.taskList.progress}: {task.progress.percentage}%
      {task.progress.currentItems ? ` · ${task.progress.currentItems}` : ''}</div></div>;
}

function TaskActionCell({ task, actions, showDetailLink, text }: Parameters<typeof TaskRow>[0]) {
  const cancellable = ['running', 'pending', 'paused'].includes(task.status);
  const deletable = ['completed', 'failed', 'cancelled', 'interrupted', 'waiting_verification'].includes(task.status);
  return <td className="whitespace-nowrap px-6 py-4 text-sm space-x-2">
    {task.status === 'running' && <ActionButton onClick={() => actions.pauseTask(task.id)} color="yellow">{text.taskList.pause}</ActionButton>}
    {canResumeTask(task) && <ActionButton onClick={() => actions.resumeTask(task.id)} color="green">{text.taskList.resume}</ActionButton>}
    {cancellable && <ActionButton onClick={() => actions.cancelTask(task.id)} color="red">{text.taskList.cancel}</ActionButton>}
    {deletable && <ActionButton onClick={() => actions.deleteTask(task.id)} color="slate">{text.taskList.delete}</ActionButton>}
    {showDetailLink && <Link to={`/tasks/${task.id}`} className="text-blue-600 hover:text-blue-900">{text.taskList.view}</Link>}
  </td>;
}

function ActionButton({ onClick, color, children }: { onClick(): void; color: string; children: React.ReactNode }) {
  const classes: Record<string, string> = { yellow: 'text-yellow-600 hover:text-yellow-900',
    green: 'text-green-600 hover:text-green-900', red: 'text-red-600 hover:text-red-900',
    slate: 'text-slate-600 hover:text-slate-900' };
  return <button onClick={() => void onClick()} className={classes[color]}>{children}</button>;
}
