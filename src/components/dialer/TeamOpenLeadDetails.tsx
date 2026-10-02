import React from "react";
import { AlertCircle, RotateCw } from "lucide-react";
import TeamOpenLeadField from "./TeamOpenLeadField";
import { editModeLeadFields, visibleLeadFields, type ResolvedLeadField } from "@/lib/dialerLeadFields";
import type { TeamOpenMasterStatus } from "@/hooks/useTeamOpenMasterLead";

export interface TeamOpenLeadDetailsProps {
  fields: readonly ResolvedLeadField[];
  masterStatus: TeamOpenMasterStatus;
  /** Custom-field definitions could not be loaded (values still shown read-only). */
  definitionsUnavailable: boolean;
  isEditing: boolean;
  draft: Record<string, string>;
  errors: Record<string, string>;
  saving: boolean;
  onChange: (id: string, value: string) => void;
  onRetry: () => void;
  unavailableMessage?: string;
}

function Notice({ status, onRetry, unavailableMessage }: { status: TeamOpenMasterStatus; onRetry: () => void; unavailableMessage?: string }) {
  if (status === "loaded") return null;
  const text =
    status === "loading"
      ? "Loading the full contact record…"
      : status === "error"
        ? "The full contact record could not be loaded. Showing this campaign's copy only."
        : unavailableMessage ?? "The full contact record isn't available to you yet — showing this campaign's copy. More details appear once this lead is claimed.";
  return (
    <div
      role="status"
      className="flex items-start gap-2 mb-3 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground"
    >
      <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" />
      <span className="flex-1">{text}</span>
      {status === "error" && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 text-primary hover:underline shrink-0"
        >
          <RotateCw className="w-3 h-3" /> Retry
        </button>
      )}
    </div>
  );
}

/**
 * TeamOpenLeadDetails — the authorized field grid for Team / Open Pool campaigns only.
 * Team displays it after queue-lock confirmation, independent of call state. Open Pool keeps
 * the connected-state presentation. Database reads and edit permissions are separate gates.
 */
export default function TeamOpenLeadDetails({
  fields,
  masterStatus,
  definitionsUnavailable,
  isEditing,
  draft,
  errors,
  saving,
  onChange,
  onRetry,
  unavailableMessage,
}: TeamOpenLeadDetailsProps) {
  const shown = isEditing ? editModeLeadFields(fields) : visibleLeadFields(fields);

  return (
    <div data-testid="team-open-lead-details">
      <Notice status={masterStatus} onRetry={onRetry} unavailableMessage={unavailableMessage} />
      {definitionsUnavailable && masterStatus === "loaded" && (
        <p className="mb-3 text-[11px] text-muted-foreground">
          Custom field settings could not be loaded; saved custom values are shown read-only.
        </p>
      )}
      {shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">No details on file.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {shown.map((f) => (
            <TeamOpenLeadField
              key={f.id}
              field={f}
              isEditing={isEditing}
              value={draft[f.id] ?? f.editValue}
              error={errors[f.id]}
              disabled={saving}
              onChange={onChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
