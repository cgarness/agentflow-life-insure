import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X, Settings2 } from "lucide-react";
import { AgencyResourceCategory } from "@/types/resources";

interface ResourceCategoryManagerProps {
  categories: AgencyResourceCategory[];
  onAddCategory: (category: string) => void;
  onRemoveCategory: (category: string) => void;
}

const ResourceCategoryManager: React.FC<ResourceCategoryManagerProps> = ({
  categories,
  onAddCategory,
  onRemoveCategory,
}) => {
  const [newCategory, setNewCategory] = useState("");

  const handleAdd = () => {
    if (newCategory.trim()) {
      onAddCategory(newCategory.trim());
      setNewCategory("");
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 text-xs">
          <Settings2 className="h-3.5 w-3.5" />
          Edit Categories
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Manage Document Categories</DialogTitle>
          <DialogDescription>
            Add or remove categories to organize your agency documents.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="flex gap-2">
            <Input 
              placeholder="New category name..." 
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <Button size="icon" onClick={handleAdd}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
            {categories.map(category => (
              <div 
                key={category.id} 
                className="flex items-center justify-between p-2 rounded-lg bg-muted/50 border border-border/50 group"
              >
                <span className="text-sm font-medium">{category.name}</span>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-7 w-7 text-muted-foreground hover:text-destructive transition-colors"
                  onClick={() => onRemoveCategory(category.name)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ResourceCategoryManager;
