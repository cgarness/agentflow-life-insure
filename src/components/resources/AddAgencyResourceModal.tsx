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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Link as LinkIcon, UploadCloud, Loader2 } from "lucide-react";
import { AgencyResource, AgencyResourceCategory } from "@/types/resources";

interface AddAgencyResourceModalProps {
  categories: AgencyResourceCategory[];
  onAdd: (resource: Partial<AgencyResource>, file?: File) => void;
  isLoading?: boolean;
}

const AddAgencyResourceModal: React.FC<AddAgencyResourceModalProps> = ({ categories, onAdd, isLoading }) => {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  
  const [uploadType, setUploadType] = useState<"link" | "upload">("upload");
  const [url, setUrl] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !categoryId) return;

    let finalUrl = url;
    if (uploadType === "link" && url && !url.startsWith('http://') && !url.startsWith('https://')) {
      finalUrl = 'https://' + url;
    }

    onAdd({
      title,
      category_id: categoryId,
      content_url: uploadType === "link" ? finalUrl : undefined,
    }, uploadType === "upload" && selectedFile ? selectedFile : undefined);
    
    if (!isLoading) {
      setOpen(false);
      resetForm();
    }
  };

  const resetForm = () => {
    setTitle("");
    setUrl("");
    setCategoryId("");
    setSelectedFile(null);
  };

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

            <Tabs value={uploadType} onValueChange={(v) => setUploadType(v as "link" | "upload")} className="w-full mt-2">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="upload" className="gap-2"><UploadCloud className="h-4 w-4" /> Upload File</TabsTrigger>
                <TabsTrigger value="link" className="gap-2"><LinkIcon className="h-4 w-4" /> Link URL</TabsTrigger>
              </TabsList>
              <TabsContent value="upload" className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="file">Document File</Label>
                  <Input 
                    id="file" 
                    type="file"
                    accept="application/pdf,image/png,image/jpeg"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    className="cursor-pointer file:text-primary file:font-semibold file:bg-primary/10 file:border-0 file:mr-4 file:py-1 file:px-3 file:rounded-full hover:file:bg-primary/20"
                    required={uploadType === 'upload'}
                  />
                  <p className="text-xs text-muted-foreground">
                    PDF or images up to 50MB.
                  </p>
                </div>
              </TabsContent>
              <TabsContent value="link" className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="url">Document URL</Label>
                  <Input 
                    id="url" 
                    type="url"
                    placeholder="https://drive.google.com/..." 
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    required={uploadType === 'link'}
                  />
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    Provide a direct link to the file.
                  </p>
                </div>
              </TabsContent>
            </Tabs>

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
