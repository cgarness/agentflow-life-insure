import React from "react";

export interface AssignableAgent {
  id: string;
  firstName: string;
  lastName: string;
}

interface AppointmentAssigneeFieldProps {
  /** Agents never pick an assignee; they see a read-only name. */
  isAgent: boolean;
  agents: AssignableAgent[];
  /** The assignee that WILL be saved. */
  value: string;
  onChange: (id: string) => void;
  viewerId: string | undefined;
  viewerName: string;
}

/**
 * "Assigned Agent" field of AppointmentModal. It always shows the value that will be saved: an
 * assignee missing from the viewer's roster (inactive, outside a Team Leader's direct reports, or
 * someone else's row an Agent created) is shown as "Current assignee" instead of silently displaying
 * the first option or the viewer's own name while another id is saved.
 */
const AppointmentAssigneeField: React.FC<AppointmentAssigneeFieldProps> = ({
  isAgent,
  agents,
  value,
  onChange,
  viewerId,
  viewerName,
}) => {
  if (isAgent) {
    const showsViewer = !value || value === viewerId;
    return (
      <p className="h-8 px-2 flex items-center text-xs text-foreground font-medium">
        {showsViewer ? viewerName : "Current assignee"}
      </p>
    );
  }

  const inRoster = agents.some((a) => a.id === value);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-8 px-2 rounded-lg bg-muted/20 text-xs text-foreground border border-border focus:ring-1 focus:ring-primary shadow-sm transition-all"
    >
      {value && !inRoster && <option value={value}>Current assignee</option>}
      {agents.map((a) => (
        <option key={a.id} value={a.id}>{a.firstName} {a.lastName}</option>
      ))}
    </select>
  );
};

export default AppointmentAssigneeField;
