import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { UnsavedChangesProvider, useUnsavedChanges } from "@/contexts/UnsavedChangesContext";
import { toast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import SettingsRenderer from "@/components/settings/SettingsRenderer";

const MASTER_ADMIN_EMAIL = "cgarness.ffl@gmail.com";
const MASTER_ADMIN_UID = "u1";

const SettingsInner: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSlug = searchParams.get("section") || "my-profile";
  const { user, profile } = useAuth();
  const { isAnyDirty, clearAll } = useUnsavedChanges();
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);

  const isMasterAdmin =
    user?.email === MASTER_ADMIN_EMAIL ||
    profile?.email === MASTER_ADMIN_EMAIL ||
    user?.id === MASTER_ADMIN_UID;

  const confirmNavigation = () => {
    if (pendingSlug) {
      clearAll();
      setSearchParams({ section: pendingSlug }, { replace: true });
      setPendingSlug(null);
    }
  };

  const cancelNavigation = () => setPendingSlug(null);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground capitalize">
          {activeSlug.replace(/-/g, ' ')} Settings
        </h1>
      </div>

      <div className="bg-card rounded-xl border p-6 min-h-[600px]">
        <SettingsRenderer activeSlug={activeSlug} isMasterAdmin={isMasterAdmin} />
      </div>

      <AlertDialog open={!!pendingSlug} onOpenChange={(open) => { if (!open) cancelNavigation(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. If you leave, your changes will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelNavigation}>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={confirmNavigation} className="bg-destructive text-destructive-foreground">
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const SettingsPage: React.FC = () => (
  <UnsavedChangesProvider>
    <SettingsInner />
  </UnsavedChangesProvider>
);

export default SettingsPage;
