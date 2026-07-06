import React from 'react';
import { useTaskStore } from '../store';
import { useI18n } from '../text/i18n';

export const StatsCard: React.FC = () => {
  const { stats } = useTaskStore();
  const { text } = useI18n();

  if (!stats) {
    return <div className="text-gray-500">{text.stats.loading}</div>;
  }

  const statItems = [
    { label: text.stats.total, value: stats.total, color: 'bg-gray-500' },
    { label: text.stats.running, value: stats.running, color: 'bg-blue-500' },
    { label: text.stats.pending, value: stats.pending, color: 'bg-yellow-500' },
    { label: text.stats.waitingVerification, value: stats.waitingVerification, color: 'bg-purple-500' },
    { label: text.stats.interrupted, value: stats.interrupted, color: 'bg-orange-500' },
    { label: text.stats.completed, value: stats.completed, color: 'bg-green-500' },
    { label: text.stats.failed, value: stats.failed, color: 'bg-red-500' },
    { label: text.stats.cancelled, value: stats.cancelled, color: 'bg-gray-400' },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-8">
      {statItems.map((item) => (
        <div key={item.label} className="rounded-lg bg-white p-4 shadow">
          <div className="flex items-center">
            <div className={`mr-2 h-3 w-3 rounded-full ${item.color}`}></div>
            <span className="text-sm text-gray-500">{item.label}</span>
          </div>
          <div className="mt-2 text-2xl font-bold">{item.value}</div>
        </div>
      ))}
    </div>
  );
};
