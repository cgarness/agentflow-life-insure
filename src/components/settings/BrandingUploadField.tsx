import React, { useRef } from "react";
import { Upload, Image as ImageIcon } from "lucide-react";
import { toast, useToast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/useOrganization";

type UploadKind = "logo" | "favicon";

interface BrandingUploadFieldProps {
  kind: UploadKind;
  label: string;
  subtitle?: string;
  url: string | null;
  name: string | null;
  disabled?: boolean;
  onChange: (url: string | null, name: string | null) => void;
}

const LOGO_TYPES = ["image/jpeg", "image/png", "image/svg+xml"];
const FAVICON_TYPES = ["image/x-icon", "image/vnd.microsoft.icon", "image/png"];
const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const FAVICON_MAX_BYTES = 1 * 1024 * 1024;

const BrandingUploadField: React.FC<BrandingUploadFieldProps> = ({
  kind,
  label,
  subtitle,
  url,
  name,
  disabled = false,
  onChange,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const validate = (file: File): boolean => {
    const isLogo = kind === "logo";
    const validTypes = isLogo ? LOGO_TYPES : FAVICON_TYPES;
    const maxBytes = isLogo ? LOGO_MAX_BYTES : FAVICON_MAX_BYTES;
    if (!validTypes.includes(file.type)) {
      toast({
        title: isLogo
          ? "Invalid file type. Please upload a JPG, PNG, or SVG."
          : "Invalid file type. Please upload an ICO or PNG.",
        variant: "destructive",
      });
      return false;
    }
    if (file.size > maxBytes) {
      toast({
        title: `File too large. Maximum size is ${isLogo ? "5MB" : "1MB"}.`,
        variant: "destructive",
      });
      return false;
    }
    return true;
  };

  const readFile = (file: File) => {
    if (!validate(file)) return;
    const reader = new FileReader();
    reader.onload = () => onChange(reader.result as string, file.name);
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
  };

  const accept = kind === "logo" ? ".jpg,.jpeg,.png,.svg" : ".ico,.png";
  const previewSize = kind === "logo" ? "w-20 h-20 rounded-full" : "w-10 h-10 rounded";
  const dropPadding = kind === "logo" ? "p-6" : "p-4";
  const Icon = kind === "logo" ? Upload : ImageIcon;
  const iconSize = kind === "logo" ? "w-8 h-8 mb-2" : "w-6 h-6 mb-1.5";
  const dropText = kind === "logo"
    ? "Drag and drop your logo here, or click to browse"
    : "Drag and drop your favicon here, or click to browse";
  const hint = kind === "logo"
    ? "JPG, PNG, SVG — max 5MB"
    : "ICO, PNG — max 1MB — recommended 64×64px";

  const { toast } = useToast();
  const { role } = useOrganization();

  const handleDisabledClick = () => {
    if (disabled) {
      toast({
        title: "Permissions restricted",
        description: `Your current role (${role}) does not have permission to edit branding. Admin or Super Admin access is required.`,
        variant: "destructive",
      });
    }
  };

  const commonClasses = `transition-colors ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:opacity-80"}`;

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
              {!disabled && (
                <input
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
                onClick={(e) => {
                  if (disabled) {
                    handleDisabledClick();
                    return;
                  }
                  e.stopPropagation();
                  onChange(null, null);
                }}
                disabled={disabled}
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
            <Icon className={`${iconSize} mx-auto text-muted-foreground`} />
            <p className="text-sm text-muted-foreground">{dropText}</p>
            <p className="text-xs mt-1 text-muted-foreground">{hint}</p>
            {!disabled && (
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
