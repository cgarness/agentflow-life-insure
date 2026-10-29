import React from "react";
import { Info } from "lucide-react";

/**
 * Says whose items a list shows when that differs from what the perspective
 * suggests (a Team Leader in Team perspective sees their own list items; plan §2A).
 */
export const DashboardScopeNote: React.FC<{ text: string | null }> = ({ text }) =>
  text ? (
    <p className="mb-3 flex items-start gap-1.5 text-xs text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </p>
  ) : null;
