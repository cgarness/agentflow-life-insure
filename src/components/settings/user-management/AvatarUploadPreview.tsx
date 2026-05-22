import React, { useRef, useState } from "react";
import { Camera, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";

interface Props {
  currentAvatar?: string;
  initials: string;
  onAvatarChange: (dataUrl: string) => void;
  disabled?: boolean;
}

const AvatarUploadPreview: React.FC<Props> = ({ currentAvatar, initials, onAvatarChange, disabled }) => {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [zoom, setZoom] = useState([1]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/gif"].includes(file.type)) {
      toast({ title: "Invalid file type", description: "Please upload JPG, PNG, or GIF only.", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 5MB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPreviewUrl(reader.result as string);
      setCropOpen(true);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleConfirm = () => {
    if (previewUrl) {
      onAvatarChange(previewUrl);
      toast({ title: "Avatar updated", description: "Profile photo has been updated." });
    }
    setCropOpen(false);
    setPreviewUrl(null);
    setZoom([1]);
  };

  return (
    <>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif" className="hidden" onChange={handleFileSelect} />
      <button
        type="button"
        className="relative w-16 h-16 rounded-full bg-primary/10 text-primary text-xl font-bold flex items-center justify-center overflow-hidden group cursor-pointer"
        onClick={() => !disabled && fileRef.current?.click()}
        disabled={disabled}
      >
        {currentAvatar ? (
          <img src={currentAvatar} alt="Avatar" className="w-full h-full object-cover" style={{ transform: `scale(${zoom[0]})` }} />
        ) : (
          initials
        )}
        {!disabled && (
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <Camera className="w-5 h-5 text-white" />
          </div>
        )}
      </button>

      <Dialog open={cropOpen} onOpenChange={v => { if (!v) { setCropOpen(false); setPreviewUrl(null); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Crop Avatar</DialogTitle>
            <DialogDescription>Adjust zoom and confirm your profile photo.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4">
            <div className="w-40 h-40 rounded-full overflow-hidden border-2 border-border bg-muted flex items-center justify-center">
              {previewUrl && (
                <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" style={{ transform: `scale(${zoom[0]})` }} />
              )}
            </div>
            <div className="flex items-center gap-3 w-full">
              <ZoomIn className="w-4 h-4 text-muted-foreground" />
              <Slider value={zoom} onValueChange={setZoom} min={1} max={3} step={0.1} className="flex-1" />
              <span className="text-xs text-muted-foreground w-8">{zoom[0].toFixed(1)}x</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCropOpen(false); setPreviewUrl(null); }}>Cancel</Button>
            <Button onClick={handleConfirm}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AvatarUploadPreview;
