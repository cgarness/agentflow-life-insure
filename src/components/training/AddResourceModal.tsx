import React from "react";
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
import { TRAINING_CATEGORIES } from "@/constants/trainingData";

const AddResourceModal: React.FC = () => {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="gap-2 shadow-lg shadow-primary/20">
          <Plus className="h-4 w-4" />
          Add Resource
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Training Resource</DialogTitle>
          <DialogDescription>
            Upload a new script, guide, or video link for your agency.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="title">Resource Title</Label>
            <Input id="title" placeholder="e.g. Handling Pricing Objections" />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="type">Resource Type</Label>
              <Select defaultValue="video">
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
              <Select defaultValue={TRAINING_CATEGORIES[1]}>
                <SelectTrigger id="category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {TRAINING_CATEGORIES.filter(c => c !== "All").map(category => (
                    <SelectItem key={category} value={category}>
                      {category}
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
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="url">Content URL or Link</Label>
            <Input id="url" placeholder="https://youtube.com/..." />
          </div>
        </div>
        <DialogFooter>
          <Button type="submit" className="w-full">Save Resource</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddResourceModal;
