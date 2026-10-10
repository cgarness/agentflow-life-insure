import React, { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { logActivity } from "@/lib/activityLogger";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buildDuplicatePayload, DuplicatePayloadSchema, type CampaignRow } from "@/lib/campaigns-table/model";

interface Props {
  campaign: CampaignRow | null;
  orgLocked: boolean;
  /** Focus returns here on close (the dialog has no Radix trigger of its own). */
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
  onDuplicated: () => void;
}

export default function DuplicateCampaignDialog({ campaign, orgLocked, returnFocusTo, onClose, onDuplicated }: Props) {
  const { user, profile } = useAuth();
  const { organizationId } = useOrganization();
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { if (campaign) setSaving(false); }, [campaign]);

  const handleDuplicate = async () => {
    if (!campaign || saving) return;
    if (orgLocked) {
      toast.error("This agency is suspended/archived. Reactivate to create campaigns.");
      return;
    }
    const parsed = DuplicatePayloadSchema.safeParse(buildDuplicatePayload(campaign, user?.id, organizationId));
    if (!parsed.success) {
      toast.error("Failed to duplicate campaign", { duration: 3000, position: "bottom-right" });
      return;
    }
    setSaving(true);
    // SECURITY: Leads are never copied under any circumstance.
    const { error } = await supabase.from("campaigns").insert(parsed.data as TablesInsert<"campaigns">);
    if (mounted.current) setSaving(false);
    if (error) {
      toast.error("Failed to duplicate campaign", { duration: 3000, position: "bottom-right" });
      return;
    }
    toast.success("Campaign duplicated. Find it in your Draft campaigns.", { duration: 3000, position: "bottom-right" });
    if (organizationId) {
      void logActivity({
        action: `Duplicated campaign "${campaign.name}"`,
        category: "campaigns",
        organizationId,
        userId: user?.id,
        userName: profile ? `${profile.first_name} ${profile.last_name}` : undefined,
        metadata: { originalCampaignId: campaign.id },
      });
    }
    onDuplicated();
    onClose();
  };

  return (
    <AlertDialog open={!!campaign} onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <AlertDialogContent className="max-w-md" onEscapeKeyDown={(e) => { if (saving) e.preventDefault(); }}
        onCloseAutoFocus={(e) => { e.preventDefault(); if (returnFocusTo?.isConnected) returnFocusTo.focus(); }}>
        <AlertDialogHeader>
          <AlertDialogTitle>Duplicate campaign</AlertDialogTitle>
          <AlertDialogDescription>
            Creates a Draft copy of <span className="font-medium text-foreground">{campaign?.name}</span>. Leads are not copied.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
          <Button type="button" onClick={() => void handleDuplicate()} disabled={saving || orgLocked} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Duplicate
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
