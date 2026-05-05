import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, FileText, Download, Link as LinkIcon, Loader2 } from "lucide-react";
import { AgencyResource } from "@/types/resources";

interface AddAgencyResourceModalProps {
  onAdd: (resource: Partial<AgencyResource>) => void;
  isLoading?: boolean;
}

const CATEGORIES = ["Carrier Doc", "Form", "Cheat Sheet", "Reference Guide"];

const AddAgencyResourceModal: React.FC<AddAgencyResourceModalProps> = ({ onAdd, isLoading }) => {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [url, setUrl] = useState("");
  const [fileSize, setFileSize] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !url) return;

    onAdd({
      title,
      category,
      content_url: url,
      file_size: fileSize || "Link",
    });
    
    setOpen(false);
    setTitle("");
    setUrl("");
    setFileSize("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 shadow-lg shadow-primary/20">
          <Plus className="h-4 w-4" />
          Add Document
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Agency Resource</DialogTitle>
            <DialogDescription>
              Link a new carrier document, form, or cheat sheet for your agents.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Document Title</Label>
              <Input 
                id="title" 
                placeholder="e.g. Mutual of Omaha E-App Guide" 
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="category">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(cat => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="size">Size / Type</Label>
                <Input 
                  id="size" 
                  placeholder="e.g. 2.4 MB or PDF" 
                  value={fileSize}
                  onChange={(e) => setFileSize(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="url">Document URL</Label>
              <Input 
                id="url" 
                type="url"
                placeholder="https://drive.google.com/..." 
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <LinkIcon className="h-3 w-3" /> Provide a direct link to the file.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" className="w-full gap-2" disabled={isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Document
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddAgencyResourceModal;
