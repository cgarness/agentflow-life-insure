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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Video, FileText, ScrollText, UploadCloud, Link as LinkIcon, Loader2 } from "lucide-react";
import { TrainingResource, ResourceType, TrainingCategory } from "@/types/training";

interface AddResourceModalProps {
  categories: TrainingCategory[];
  onAdd: (resource: Partial<TrainingResource>, file?: File) => void;
  isLoading?: boolean;
}

const AddResourceModal: React.FC<AddResourceModalProps> = ({ categories, onAdd, isLoading }) => {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ResourceType>("video");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  
  const [uploadType, setUploadType] = useState<"link" | "upload">("upload");
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  useEffect(() => {
    if (categories.length > 0 && !categoryId) {
      setCategoryId(categories[0].id);
    }
  }, [categories, categoryId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title) return;

    let finalUrl = url;
    if (uploadType === "link" && url && !url.startsWith('http://') && !url.startsWith('https://')) {
      finalUrl = 'https://' + url;
    }

    const newResource: Partial<TrainingResource> = {
      title,
      description,
      type,
      category_id: categoryId || null,
      content_url: uploadType === "link" ? finalUrl : undefined,
      content: type === "script" ? content : undefined,
      thumbnail_url: type === 'video' ? "https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&q=80&w=400" : undefined,
    };

    onAdd(newResource, uploadType === "upload" && selectedFile ? selectedFile : undefined);
    
    // Don't close or reset immediately if isLoading, let the parent handle it
    if (!isLoading) {
      setOpen(false);
      resetForm();
    }
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setUrl("");
    setContent("");
    setSelectedFile(null);
  };

  // Close when loading finishes if it was open
  useEffect(() => {
    if (!isLoading && open && title) {
      setOpen(false);
      resetForm();
    }
  }, [isLoading]);

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
          <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto px-1">
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
                <Select value={type} onValueChange={(v) => { setType(v as ResourceType); setSelectedFile(null); setUrl(""); }}>
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

            {type === "script" ? (
              <div className="grid gap-2 mt-2">
                <Label htmlFor="content">Script Content</Label>
                <Textarea 
                  id="content" 
                  placeholder="Paste the script here..." 
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="min-h-[150px]"
                />
              </div>
            ) : (
              <Tabs value={uploadType} onValueChange={(v) => setUploadType(v as "link" | "upload")} className="w-full mt-2">
                <TabsList className="grid w-full grid-cols-2 mb-4">
                  <TabsTrigger value="upload" className="gap-2"><UploadCloud className="h-4 w-4" /> Upload File</TabsTrigger>
                  <TabsTrigger value="link" className="gap-2"><LinkIcon className="h-4 w-4" /> Link URL</TabsTrigger>
                </TabsList>
                <TabsContent value="upload" className="space-y-4">
                  <div className="grid gap-2">
                    <Label htmlFor="file">File Attachment</Label>
                    <Input 
                      id="file" 
                      type="file"
                      accept={type === 'video' ? 'video/mp4,video/webm,video/quicktime' : 'application/pdf,image/png,image/jpeg'}
                      onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                      className="cursor-pointer file:text-primary file:font-semibold file:bg-primary/10 file:border-0 file:mr-4 file:py-1 file:px-3 file:rounded-full hover:file:bg-primary/20"
                      required={uploadType === 'upload'}
                    />
                    <p className="text-xs text-muted-foreground">
                      {type === 'video' ? 'MP4, WebM, or MOV up to 100MB.' : 'PDF or images up to 50MB.'}
                    </p>
                  </div>
                </TabsContent>
                <TabsContent value="link" className="space-y-4">
                  <div className="grid gap-2">
                    <Label htmlFor="url">{type === "video" ? "Video URL" : "Document URL"}</Label>
                    <Input 
                      id="url" 
                      placeholder={type === "video" ? "https://youtube.com/..." : "https://drive.google.com/..."}
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      required={uploadType === 'link'}
                    />
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" className="w-full gap-2" disabled={isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Resource
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddResourceModal;
