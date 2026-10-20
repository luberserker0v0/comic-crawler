import React from 'react';

interface ProgressBarProps {
  current: number;
  total: number;
  label?: string;
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ current, total, label, className = '' }) => {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className={`w-full ${className}`}>
      {label && <ProgressLabel label={label} percentage={percentage} />}
      <div className="w-full bg-gray-200 rounded-full h-2.5">
        <div
          className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        ></div>
      </div>
      {label && <ProgressCount current={current} total={total} />}
    </div>
  );
};

function ProgressLabel({ label, percentage }: { label: string; percentage: number }) {
  return <div className="flex justify-between mb-1">
    <span className="text-sm font-medium text-gray-700">{label}</span>
    <span className="text-sm font-medium text-gray-700">{percentage}%</span>
  </div>;
}

function ProgressCount({ current, total }: Pick<ProgressBarProps, 'current' | 'total'>) {
  return <div className="mt-1 text-xs text-gray-500">{current} / {total}</div>;
}
