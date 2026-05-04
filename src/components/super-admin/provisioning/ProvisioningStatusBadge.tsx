import React from "react";

export type ProvisioningStatus =
  | "pending"
  | "active"
  | "pending_manual"
  | "suspended"
  | "closed"
  | string;

const STYLES: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  pending: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  pending_manual: "bg-red-500/10 text-red-600 border-red-500/30",
  suspended: "bg-zinc-500/10 text-zinc-600 border-zinc-500/30",
  closed: "bg-zinc-500/10 text-zinc-600 border-zinc-500/30",
};

const LABELS: Record<string, string> = {
  active: "Active",
  pending: "Pending",
  pending_manual: "Failed (Manual)",
  suspended: "Suspended",
  closed: "Closed",
};

const ProvisioningStatusBadge: React.FC<{ status: ProvisioningStatus | null | undefined }> = ({
  status,
}) => {
  const key = String(status ?? "pending");
  const cls = STYLES[key] ?? "bg-zinc-500/10 text-zinc-600 border-zinc-500/30";
  const label = LABELS[key] ?? key;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}
    >
      {label}
    </span>
  );
};

export default ProvisioningStatusBadge;
