import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { groupNameSchema } from "./agencyGroupSchema";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const CreateGroupModal: React.FC<Props> = ({ open, onClose, onCreated }) => {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const submit = async () => {
    setError(null);
    const parsed = groupNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? "Invalid name");
      return;
    }

    setSubmitting(true);
    const { data, error: rpcError } = await supabase.rpc("create_agency_group", {
      p_name: parsed.data,
    });
    setSubmitting(false);

    if (rpcError) {
      // RPC raises with explicit messages; surface them directly when present.
      setError(rpcError.message || "Failed to create Agency Group");
      return;
    }

    const created = Array.isArray(data) ? data[0] : data;
    if (!created?.id) {
      setError("Group creation returned no id");
      return;
    }

    toast({ title: "Agency Group created" });
    setName("");
    onCreated();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl">
        <h3 className="text-lg font-semibold mb-1">Create Agency Group</h3>
        <p className="text-sm text-muted-foreground mb-4">
          You'll be the master agency. Invite other independent agencies to join.
        </p>
        <label className="text-sm font-medium block mb-1.5">Group Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Justin's Team"
          maxLength={80}
          className="w-full h-10 px-3 rounded-lg bg-accent text-sm border-0 mb-2"
          autoFocus
        />
        {error && <p className="text-sm text-destructive mb-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            disabled={submitting}
            className="h-9 px-4 rounded-lg text-sm font-medium bg-accent hover:bg-accent/70"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="h-9 px-4 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateGroupModal;
