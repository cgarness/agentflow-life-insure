import React, { useRef } from "react";
import { Upload, Image as ImageIcon } from "lucide-react";
import { toast } from "@/hooks/use-toast";

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

  return (
    <div>
      <label className="block text-sm font-medium mb-0.5 text-muted-foreground">{label}</label>
      {subtitle && <p className="text-xs mb-2 text-muted-foreground">{subtitle}</p>}
      {url ? (
        <div className="flex items-center gap-4">
          <div className={`${previewSize} overflow-hidden flex items-center justify-center bg-accent`}>
            <img src={url} alt={label} className="w-full h-full object-cover" />
          </div>
          <div>
            <p className="text-sm text-foreground">{name}</p>
            <button
              type="button"
              onClick={() => onChange(null, null)}
              disabled={disabled}
              className="text-xs mt-1 font-medium text-destructive disabled:cursor-not-allowed disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div
          onClick={() => !disabled && inputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={handleDrop}
          className={`rounded-md ${dropPadding} text-center transition-colors border-2 border-dashed border-border bg-transparent ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:opacity-80"}`}
        >
          <Icon className={`${iconSize} mx-auto text-muted-foreground`} />
          <p className="text-sm text-muted-foreground">{dropText}</p>
          <p className="text-xs mt-1 text-muted-foreground">{hint}</p>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled}
        onChange={handleFileChange}
      />
    </div>
  );
};

export default BrandingUploadField;
