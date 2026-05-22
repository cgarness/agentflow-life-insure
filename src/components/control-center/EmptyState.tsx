import React from "react";

interface Props {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}

const EmptyState: React.FC<Props> = ({ title, description, action, icon }) => (
  <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center">
    {icon && <div className="mx-auto mb-3 text-slate-500">{icon}</div>}
    <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
    {description && (
      <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">{description}</p>
    )}
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </div>
);

export default EmptyState;
