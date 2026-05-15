import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSave?: () => void;
  saving?: boolean;
  saveLabel?: string;
  children: React.ReactNode;
}

const PanelShell: React.FC<Props> = ({
  open, title, subtitle, onClose, onSave, saving, saveLabel = "Save", children,
}) => (
  <AnimatePresence>
    {open && (
      <>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/30"
        />
        <motion.aside
          initial={{ x: 380, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 380, opacity: 0 }}
          transition={{ type: "tween", duration: 0.2 }}
          className="fixed right-0 top-0 z-50 flex h-full w-[380px] flex-col border-l border-border/50 bg-card shadow-xl"
        >
          <div className="flex items-start justify-between gap-3 border-b border-border/50 p-4">
            <div className="min-w-0">
              <h4 className="truncate text-base font-semibold text-foreground">{title}</h4>
              {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
          {onSave && (
            <div className="flex justify-end gap-2 border-t border-border/50 p-3">
              <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button onClick={onSave} disabled={saving}>{saving ? "Saving…" : saveLabel}</Button>
            </div>
          )}
        </motion.aside>
      </>
    )}
  </AnimatePresence>
);

export default PanelShell;
