import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

const BUCKET = "company-branding";

/**
 * Derive the Supabase Storage public URL prefix from the runtime Supabase URL.
 * Example: https://jncvvsvckxhqgqvkppmj.supabase.co/storage/v1/object/public/company-branding/
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const STORAGE_PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;

/**
 * Hook for uploading / removing agency branding logos in Supabase Storage.
 *
 * - Uploads to: company-branding/{organization_id}/logo/{timestamp}_{safe-filename}
 * - Returns the public URL for storage in company_settings.logo_url.
 * - deletePreviousLogo safely removes a prior Storage object only if it belongs
 *   to the same org folder. Skips data: URLs (legacy base64) and external URLs.
 */
export function useBrandingUpload() {
  const { profile } = useAuth();
  const [uploading, setUploading] = useState(false);

  const orgId = profile?.organization_id ?? null;

  const uploadLogo = useCallback(
    async (file: File): Promise<{ url: string; name: string } | null> => {
      if (!orgId) {
        toast({ title: "Organization not found.", variant: "destructive" });
        return null;
      }

      setUploading(true);
      try {
        const safeName = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `${orgId}/logo/${Date.now()}_${safeName}`;

        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { upsert: false });

        if (error) throw error;

        const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);

        return { url: data.publicUrl, name: file.name };
      } catch (err) {
        console.error("Branding logo upload failed:", err);
        toast({ title: "Failed to upload logo. Please try again.", variant: "destructive" });
        return null;
      } finally {
        setUploading(false);
      }
    },
    [orgId],
  );

  const deletePreviousLogo = useCallback(
    async (previousUrl: string | null): Promise<void> => {
      if (!previousUrl || !orgId) return;

      // Skip legacy base64 data URLs — not Storage objects
      if (previousUrl.startsWith("data:")) return;

      // Skip external URLs that are not from our Storage bucket
      if (!previousUrl.startsWith(STORAGE_PUBLIC_PREFIX)) return;

      // Extract the storage path from the public URL
      const storagePath = previousUrl.slice(STORAGE_PUBLIC_PREFIX.length);

      // Verify org ownership — path must start with this org's ID
      if (!storagePath.startsWith(`${orgId}/`)) return;

      try {
        const { error } = await supabase.storage
          .from(BUCKET)
          .remove([storagePath]);

        if (error) {
          console.error("Failed to delete previous branding logo:", error);
          // Non-fatal — the DB save already succeeded
        }
      } catch (err) {
        console.error("Error deleting previous branding logo:", err);
      }
    },
    [orgId],
  );

  return { uploadLogo, deletePreviousLogo, uploading };
}
