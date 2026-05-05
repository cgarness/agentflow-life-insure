import React, { useState, useEffect } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Video, FileText, ScrollText } from "lucide-react";
import { TrainingResource, ResourceType, TrainingCategory } from "@/types/training";

interface AddResourceModalProps {
  categories: TrainingCategory[];
  onAdd: (resource: Partial<TrainingResource>) => void;
}

const AddResourceModal: React.FC<AddResourceModalProps> = ({ categories, onAdd }) => {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ResourceType>("video");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (categories.length > 0 && !categoryId) {
      setCategoryId(categories[0].id);
    }
  }, [categories, categoryId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title) return;

    const newResource: Partial<TrainingResource> = {
      title,
      description,
      type,
      category_id: categoryId || null,
      content_url: url,
      thumbnail_url: type === 'video' ? "https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&q=80&w=400" : undefined,
    };

    onAdd(newResource);
    setOpen(false);
    
    // Reset form
    setTitle("");
    setDescription("");
    setUrl("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 shadow-lg shadow-primary/20">
          <Plus className="h-4 w-4" />
          Add Resource
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Training Resource</DialogTitle>
            <DialogDescription>
              Upload a new script, guide, or video link for your agency.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Resource Title</Label>
              <Input 
                id="title" 
                placeholder="e.g. Handling Pricing Objections" 
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="type">Resource Type</Label>
                <Select value={type} onValueChange={(v) => setType(v as ResourceType)}>
                  <SelectTrigger id="type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="video">
                      <div className="flex items-center gap-2">
                        <Video className="h-4 w-4" />
                        <span>Video</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="script">
                      <div className="flex items-center gap-2">
                        <ScrollText className="h-4 w-4" />
                        <span>Script</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="document">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        <span>Document</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="grid gap-2">
                <Label htmlFor="category">Category</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
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
              <Label htmlFor="description">Description</Label>
              <Textarea 
                id="description" 
                placeholder="Briefly describe what this resource covers..." 
                className="resize-none"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="url">Content URL or Link</Label>
              <Input 
                id="url" 
                placeholder="https://youtube.com/..." 
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" className="w-full">Save Resource</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddResourceModal;
