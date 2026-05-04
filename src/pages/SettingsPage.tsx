import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { UnsavedChangesProvider, useUnsavedChanges } from "@/contexts/UnsavedChangesContext";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import SettingsRenderer from "@/components/settings/SettingsRenderer";
import { isPhoneSystemSettingsSection } from "@/config/settingsConfig";
import { useOrganization } from "@/hooks/useOrganization";

const SettingsInner: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSlug = searchParams.get("section") || "my-profile";
  const { isLoading } = useAuth();
  const { isSuperAdmin } = useOrganization();

  useEffect(() => {
    if (searchParams.get("section") === "spam") {
      setSearchParams({ section: "number-reputation" }, { replace: true });
    }
    if (searchParams.get("section") === "email") {
      setSearchParams({ section: "email-settings" }, { replace: true });
    }
    if (searchParams.get("section") === "goals") {
      setSearchParams({ section: "my-profile" }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (isLoading) return;
    if (activeSlug === "master-admin" && !isSuperAdmin) {
      setSearchParams({ section: "my-profile" }, { replace: true });
    }
  }, [activeSlug, isSuperAdmin, isLoading, setSearchParams]);
  const { isAnyDirty, clearAll } = useUnsavedChanges();
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);

  const confirmNavigation = () => {
    if (pendingSlug) {
      clearAll();
      setSearchParams({ section: pendingSlug }, { replace: true });
      setPendingSlug(null);
    }
  };

  const cancelNavigation = () => setPendingSlug(null);

  const phoneStackPage = isPhoneSystemSettingsSection(activeSlug);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold capitalize text-foreground">
          {activeSlug.replace(/-/g, " ")} Settings
        </h1>
      </div>

      <div
        className={`rounded-xl border bg-card p-6 min-h-[600px] ${phoneStackPage ? "shadow-sm" : ""}`}
      >
        <SettingsRenderer activeSlug={activeSlug} isSuperAdmin={isSuperAdmin} />
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
