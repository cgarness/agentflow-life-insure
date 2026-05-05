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
import { AgencyResource, AgencyResourceCategory } from "@/types/resources";

interface AddAgencyResourceModalProps {
  categories: AgencyResourceCategory[];
  onAdd: (resource: Partial<AgencyResource>) => void;
  isLoading?: boolean;
}

const AddAgencyResourceModal: React.FC<AddAgencyResourceModalProps> = ({ categories, onAdd, isLoading }) => {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [url, setUrl] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !url || !categoryId) return;

    onAdd({
      title,
      category_id: categoryId,
      content_url: url,
    });
    
    setOpen(false);
    setTitle("");
    setUrl("");
    setCategoryId("");
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
            
            <div className="grid grid-cols-1 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="category">Category</Label>
                <Select value={categoryId} onValueChange={setCategoryId} required>
                  <SelectTrigger id="category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(cat => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
