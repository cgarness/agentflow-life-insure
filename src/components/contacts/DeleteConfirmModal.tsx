import React, { useState, useEffect } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Shared destructive-confirmation dialog for Contacts — Contacts Build 6
 * (extracted from Contacts.tsx). Behavior is identical to the prior inline
 * component; the only addition is an optional `description` slot so long
 * explanations (e.g. import-undo) render as readable body copy instead of being
 * crammed into the title. When no `description` is given it falls back to the
 * standard "This action cannot be undone." warning.
 */
const DeleteConfirmModal: React.FC<{
  open: boolean;
  count: number;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  title?: string;
  /** Optional body copy. Defaults to the standard irreversible-action warning. */
  description?: string;
  confirmLabel?: string;
}> = ({ open, count, onConfirm, onClose, title, description, confirmLabel }) => {
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (!open) setSubmitting(false);
  }, [open]);
  if (!open) return null;
  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm();
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-foreground/50 backdrop-blur-sm" onClick={() => { if (!submitting) onClose(); }} />
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 animate-in fade-in zoom-in-95">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0"><AlertTriangle className="w-5 h-5 text-destructive" /></div>
          <div>
            <h3 className="font-semibold text-foreground">{title || `Delete ${count} contact${count > 1 ? "s" : ""}?`}</h3>
            <p className="text-sm text-muted-foreground">{description || "This action cannot be undone."}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button type="button" disabled={submitting} onClick={onClose} className="flex-1 h-9 rounded-lg border border-border bg-background text-foreground text-sm font-medium hover:bg-accent sidebar-transition disabled:opacity-50">Cancel</button>
          <button type="button" disabled={submitting} onClick={() => void handleConfirm()} className="flex-1 h-9 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 sidebar-transition disabled:opacity-50 inline-flex items-center justify-center gap-2">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {confirmLabel || "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteConfirmModal;
