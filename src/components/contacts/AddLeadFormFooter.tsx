import React from "react";
import { Loader2 } from "lucide-react";

interface AddLeadFormFooterProps {
  onCancel: () => void;
  saving: boolean;
  isEdit: boolean;
}

export const AddLeadFormFooter: React.FC<AddLeadFormFooterProps> = ({
  onCancel,
  saving,
  isEdit,
}) => (
  <div className="flex gap-3 pt-2">
    <button
      type="button"
      onClick={onCancel}
      className="flex-1 h-9 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-accent transition-colors"
    >
      Cancel
    </button>
    <button
      type="submit"
      disabled={saving}
      className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
    >
      {saving && <Loader2 className="w-4 h-4 animate-spin" />}
      {isEdit ? "Save Changes" : "Add Lead"}
    </button>
  </div>
);
