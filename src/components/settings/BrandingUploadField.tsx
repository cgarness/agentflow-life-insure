import React, { useRef, useState } from "react";
import { Upload, Image as ImageIcon, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/useOrganization";
import { supabase } from "@/integrations/supabase/client";
import {
  faviconFileSchema,
  logoFileSchema,
} from "./brandingSchema";
import { COMPANY_BRANDING_BUCKET } from "./brandingConfig";

type UploadKind = "logo" | "favicon";

interface BrandingUploadFieldProps {
  kind: UploadKind;
  label: string;
  subtitle?: string;
  url: string | null;
  name: string | null;
  disabled?: boolean;
  organizationId: string | null;
  onChange: (url: string | null, name: string | null) => void;
}

const sanitizeFilename = (raw: string) => {
  const dot = raw.lastIndexOf(".");
  const base = (dot > 0 ? raw.slice(0, dot) : raw).replace(/[^a-zA-Z0-9-_]+/g, "-").slice(0, 60) || "asset";
  const ext = dot > 0 ? raw.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, "") : "";
  return `${base}${ext}`;
};

const extractStoragePath = (publicUrl: string | null): string | null => {
  if (!publicUrl) return null;
  const marker = `/object/public/${COMPANY_BRANDING_BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return publicUrl.slice(idx + marker.length);
};

const BrandingUploadField: React.FC<BrandingUploadFieldProps> = ({
  kind,
  label,
  subtitle,
  url,
  name,
  disabled = false,
  organizationId,
  onChange,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { role } = useOrganization();
  const [uploading, setUploading] = useState(false);

  const isLogo = kind === "logo";
  const accept = isLogo ? ".jpg,.jpeg,.png,.svg" : ".ico,.png";
  const previewSize = isLogo ? "w-20 h-20 rounded-full" : "w-10 h-10 rounded";
  const dropPadding = isLogo ? "p-6" : "p-4";
  const Icon = isLogo ? Upload : ImageIcon;
  const iconSize = isLogo ? "w-8 h-8 mb-2" : "w-6 h-6 mb-1.5";
  const dropText = isLogo
    ? "Drag and drop your logo here, or click to browse"
    : "Drag and drop your favicon here, or click to browse";
  const hint = isLogo
    ? "JPG, PNG, SVG — max 5MB"
    : "ICO, PNG — max 1MB — recommended 64×64px";

  const handleUpload = async (file: File) => {
    const schema = isLogo ? logoFileSchema : faviconFileSchema;
    const parsed = schema.safeParse(file);
    if (!parsed.success) {
      toast({ title: parsed.error.issues[0]?.message ?? "Invalid file", variant: "destructive" });
      return;
    }
    if (!organizationId) {
      toast({ title: "No organization found on your profile", variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const safeName = sanitizeFilename(file.name);
      const path = `${organizationId}/${kind}/${Date.now()}-${safeName}`;

      const { error: uploadErr } = await supabase
        .storage
        .from(COMPANY_BRANDING_BUCKET)
        .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });

      if (uploadErr) throw uploadErr;

      const { data: publicData } = supabase
        .storage
        .from(COMPANY_BRANDING_BUCKET)
        .getPublicUrl(path);

      const oldPath = extractStoragePath(url);
      if (oldPath) {
        await supabase.storage.from(COMPANY_BRANDING_BUCKET).remove([oldPath]).catch(() => undefined);
      }

      onChange(publicData.publicUrl, file.name);
      toast({ title: `${isLogo ? "Logo" : "Favicon"} uploaded` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      toast({ title: "Upload failed", description: message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    if (disabled) {
      handleDisabledClick();
      return;
    }
    const oldPath = extractStoragePath(url);
    if (oldPath) {
      await supabase.storage.from(COMPANY_BRANDING_BUCKET).remove([oldPath]).catch(() => undefined);
    }
    onChange(null, null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleUpload(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (disabled || uploading) return;
    const file = e.dataTransfer.files[0];
    if (file) void handleUpload(file);
  };

  const handleDisabledClick = () => {
    if (disabled) {
      toast({
        title: "Permissions restricted",
        description: `Your current role (${role}) does not have permission to edit branding. Admin or Super Admin access is required.`,
        variant: "destructive",
      });
    }
  };

  const interactive = !disabled && !uploading;
  const commonClasses = `transition-colors ${interactive ? "cursor-pointer hover:opacity-80" : "cursor-not-allowed opacity-60"}`;

  return (
    <div>
      <label className="block text-sm font-medium mb-0.5 text-muted-foreground">{label}</label>
      {subtitle && <p className="text-xs mb-2 text-muted-foreground">{subtitle}</p>}

      <div className="relative">
        {url ? (
          <div className="flex items-center gap-4">
            <div
              onClick={handleDisabledClick}
              className={`relative ${previewSize} overflow-hidden flex items-center justify-center bg-accent border border-border ${commonClasses}`}
              title={disabled ? "Editing restricted" : "Click to change"}
            >
              <img src={url} alt={label} className="w-full h-full object-cover" />
              {uploading && (
                <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              )}
              {interactive && (
                <input
                  ref={inputRef}
                  type="file"
                  accept={accept}
                  className="absolute inset-0 opacity-0 cursor-pointer z-10"
                  onChange={handleFileChange}
                />
              )}
            </div>
            <div>
              <p className="text-sm text-foreground">{name}</p>
              <button
                type="button"
                onClick={handleRemove}
                disabled={disabled || uploading}
                className="text-xs mt-1 font-medium text-destructive disabled:cursor-not-allowed disabled:opacity-50 relative z-20"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div
            onClick={handleDisabledClick}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
            className={`relative block rounded-md ${dropPadding} text-center border-2 border-dashed border-border bg-transparent ${commonClasses}`}
          >
            {uploading ? (
              <Loader2 className={`${iconSize} mx-auto text-muted-foreground animate-spin`} />
            ) : (
              <Icon className={`${iconSize} mx-auto text-muted-foreground`} />
            )}
            <p className="text-sm text-muted-foreground">{uploading ? "Uploading…" : dropText}</p>
            <p className="text-xs mt-1 text-muted-foreground">{hint}</p>
            {interactive && (
              <input
                type="file"
                accept={accept}
                className="absolute inset-0 opacity-0 cursor-pointer z-10"
                onChange={handleFileChange}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default BrandingUploadField;
