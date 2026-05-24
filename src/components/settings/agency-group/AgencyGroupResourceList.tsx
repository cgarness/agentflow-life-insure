import React, { useState } from "react";
import { Upload, Trash2, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { AgencyGroupResource } from "./types";
import { resourceFileSchema, sanitizeFileName } from "./agencyGroupSchema";

interface Props {
  groupId: string;
  resources: AgencyGroupResource[];
  ownOrgId: string;
  canManageResources: boolean;
  onChange: () => void;
}

const BUCKET = "agency-group-resources";

const AgencyGroupResourceList: React.FC<Props> = ({
  groupId,
  resources,
  ownOrgId,
  canManageResources,
  onChange,
}) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);

  const onUpload = async (file: File) => {
    if (!canManageResources) return;
    if (!user?.id) return;

    const parsed = resourceFileSchema.safeParse({
      name: file.name,
      type: file.type,
      size: file.size,
    });
    if (!parsed.success) {
      toast({
        title: "Upload blocked",
        description: parsed.error.errors[0]?.message ?? "File not allowed",
        variant: "destructive",
      });
      return;
    }

    const safeName = sanitizeFileName(file.name);
    const randomId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    const path = `${groupId}/${Date.now()}-${randomId}-${safeName}`;

    setUploading(true);
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadErr) {
      setUploading(false);
      toast({ title: "Upload failed", description: uploadErr.message, variant: "destructive" });
      return;
    }

    const { error: insertErr } = await supabase.from("agency_group_resources").insert({
      agency_group_id: groupId,
      uploaded_by_org_id: ownOrgId,
      uploaded_by_user_id: user.id,
      title: safeName,
      resource_type: "document",
      file_url: path,
      file_name: safeName,
      file_size_bytes: file.size,
    });
    if (insertErr) {
      // Best-effort cleanup of the just-uploaded object so we don't leave an
      // orphaned blob in the bucket if the DB row was rejected (e.g. by RLS).
      await supabase.storage.from(BUCKET).remove([path]);
      setUploading(false);
      toast({
        title: "Failed to record resource",
        description: insertErr.message,
        variant: "destructive",
      });
      return;
    }

    setUploading(false);
    toast({ title: "Resource uploaded" });
    onChange();
  };

  const onDownload = async (r: AgencyGroupResource) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(r.file_url, 60);
    if (error || !data) {
      toast({ title: "Download failed", description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const onDelete = async (r: AgencyGroupResource) => {
    if (!canManageResources) return;
    if (!confirm(`Delete "${r.title}"?`)) return;

    // DB row first, scoped by id; if RLS rejects, the storage object stays
    // intact. Only remove the storage object after the row is gone, so we
    // can never leave a visible row pointing to a missing file.
    const { error: dbErr } = await supabase
      .from("agency_group_resources")
      .delete()
      .eq("id", r.id);
    if (dbErr) {
      toast({ title: "Delete failed", description: dbErr.message, variant: "destructive" });
      return;
    }

    const { error: storageErr } = await supabase.storage.from(BUCKET).remove([r.file_url]);
    if (storageErr) {
      // DB row is gone; don't resurrect it. Warn instead.
      toast({
        title: "Resource removed, file cleanup failed",
        description: storageErr.message,
        variant: "destructive",
      });
    } else {
      toast({ title: "Resource deleted" });
    }
    onChange();
  };

  return (
    <div className="rounded-2xl bg-card border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Shared Resources</h3>
        {canManageResources && (
          <label className="h-9 px-3 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 inline-flex items-center gap-2 cursor-pointer">
            <Upload className="w-4 h-4" />
            {uploading ? "Uploading..." : "Upload"}
            <input
              type="file"
              className="hidden"
              disabled={uploading}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.currentTarget.value = ""; }}
            />
          </label>
        )}
      </div>
      {!canManageResources && (
        <p className="text-xs text-muted-foreground mb-3">
          Resources are uploaded by the master agency. You can view and download what they share.
        </p>
      )}
      {resources.length === 0 ? (
        <p className="text-sm text-muted-foreground">No resources yet.</p>
      ) : (
        <ul className="space-y-2">
          {resources.map((r) => {
            const isOwn = r.uploaded_by_org_id === ownOrgId;
            return (
              <li key={r.id} className="flex items-center gap-3 p-3 rounded-lg bg-accent/40">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <button onClick={() => onDownload(r)} className="text-sm font-medium hover:underline truncate block text-left">
                    {r.title}
                  </button>
                  <p className="text-xs text-muted-foreground">
                    {isOwn ? "Uploaded by your org" : `Uploaded by ${r.organizations?.name ?? "another member"}`}
                  </p>
                </div>
                {canManageResources && isOwn && (
                  <button onClick={() => onDelete(r)} className="text-muted-foreground hover:text-destructive" title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default AgencyGroupResourceList;
