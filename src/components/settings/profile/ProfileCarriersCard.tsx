import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { useUnsavedChanges } from "@/contexts/UnsavedChangesContext";
import ProfileCarriersSection, {
  ProfileCarrierRow,
  normalizeProfileCarriers,
} from "../ProfileCarriersSection";

export const ProfileCarriersCard: React.FC = () => {
  const { profile, updateProfile } = useAuth();
  const { registerDirty } = useUnsavedChanges();

  const [carriers, setCarriers] = useState<ProfileCarrierRow[]>([]);
  const [savedCarriers, setSavedCarriers] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      const normalized = normalizeProfileCarriers(profile.carriers);
      setCarriers(normalized);
      setSavedCarriers(JSON.stringify(normalized));
    }
  }, [profile]);

  const isDirty = useMemo(() => {
    return JSON.stringify(carriers) !== savedCarriers;
  }, [carriers, savedCarriers]);

  useEffect(() => {
    registerDirty("profile-carriers", isDirty);
    return () => registerDirty("profile-carriers", false);
  }, [isDirty, registerDirty]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile({
        carriers: carriers,
      });
      setSavedCarriers(JSON.stringify(carriers));
      toast({
        title: "Carriers updated successfully.",
        className: "bg-success text-success-foreground",
      });
    } catch (err: any) {
      toast({
        title: "Failed to update carriers",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ProfileCarriersSection
      collapsible
      carriers={carriers}
      onChange={setCarriers}
      footer={
        <Button
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="px-6 rounded-lg font-medium"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Saving...
            </>
          ) : (
            "Update Carriers"
          )}
        </Button>
      }
    />
  );
};
