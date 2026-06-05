import React from "react";
import SummaryCard from "@/components/control-center/SummaryCard";

interface Props {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "warning" | "danger" | "success";
  icon?: React.ReactNode;
}

/**
 * Thin tracker-specific wrapper over the shared Control Center SummaryCard so
 * the dashboard stat tiles stay visually consistent with the rest of CC.
 */
const TrackerStatCard: React.FC<Props> = ({ label, value, hint, tone, icon }) => (
  <SummaryCard label={label} value={value} hint={hint} tone={tone} icon={icon} />
);

export default TrackerStatCard;
