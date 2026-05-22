import React, { useState, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Upload, User, Loader2 } from "lucide-react";

interface ProfileAvatarUploaderProps {
  avatarUrl: string;
  onSave: (base64Data: string) => Promise<void>;
  initials: string;
}

export const ProfileAvatarUploader: React.FC<ProfileAvatarUploaderProps> = ({
  avatarUrl,
  onSave,
  initials,
}) => {
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropPreview, setCropPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Please upload a JPG, PNG, or WebP image.",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setCropPreview(reader.result as string);
      setCropModalOpen(true);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleSaveAvatar = async () => {
    setSaving(true);
    try {
      // TODO: Migrate base64 avatar storage to Supabase Storage when an avatars/profile-images bucket is available.
      await onSave(cropPreview);
      setCropModalOpen(false);
      toast({
        title: "Profile photo updated.",
        className: "bg-success text-success-foreground",
      });
    } catch (err: any) {
      toast({
        title: "Failed to update profile photo",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-5">
      <div className="w-20 h-20 rounded-full overflow-hidden bg-primary flex items-center justify-center text-primary-foreground text-2xl font-bold shrink-0">
        {avatarUrl ? (
          <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
        ) : (
          initials
        )}
      </div>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-md"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-4 h-4 mr-1.5" /> Upload Photo
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {cropModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm shadow-lg">
            <h3 className="text-sm font-semibold text-foreground mb-4">Crop Photo</h3>
            <div className="w-48 h-48 rounded-full overflow-hidden mx-auto border-2 border-border mb-4">
              <img src={cropPreview} alt="Crop preview" className="w-full h-full object-cover" />
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={handleSaveAvatar} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Saving...
                  </>
                ) : (
                  "Save Photo"
                )}
              </Button>
              <Button variant="outline" onClick={() => setCropModalOpen(false)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
