import React from "react";
import { AgencyResource } from "@/types/resources";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Download, MoreVertical, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

interface AgencyResourceCardProps {
  resource: AgencyResource;
  categoryName: string;
  onClick: (resource: AgencyResource) => void;
  onDelete?: (id: string) => void;
  isAdmin?: boolean;
}

const AgencyResourceCard: React.FC<AgencyResourceCardProps> = ({ 
  resource, 
  categoryName,
  onClick, 
  onDelete, 
  isAdmin 
}) => {
  return (
    <Card 
      className="group relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 cursor-pointer border-border/50 bg-card/50 backdrop-blur-sm flex flex-col h-full"
      onClick={() => onClick(resource)}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-muted/50 shrink-0 border-b border-border/50">
        <div className="flex h-full w-full items-center justify-center bg-primary/5">
          <FileText className="h-16 w-16 text-primary/30 group-hover:scale-110 group-hover:text-primary/50 transition-all duration-500" />
        </div>
        
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        
        <div className="absolute top-2 right-2 flex gap-1 z-10">
          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="secondary" size="icon" className="h-6 w-6 bg-black/50 hover:bg-black/70 border-none text-white backdrop-blur-md">
                  <MoreVertical className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem 
                  className="text-destructive focus:text-destructive gap-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete?.(resource.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Document
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <CardHeader className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-semibold py-0 h-4 border-primary/20 bg-primary/5 text-primary">
            {categoryName}
          </Badge>
        </div>
        <CardTitle className="text-base group-hover:text-primary transition-colors line-clamp-2 leading-snug">
          {resource.title}
        </CardTitle>
      </CardHeader>
      
      <div className="px-4 pb-4 mt-auto flex items-center justify-between">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
          <FileText className="h-3.5 w-3.5" />
          DOCUMENT
        </div>
        <div className="text-[10px] text-muted-foreground">
          {new Date(resource.created_at).toLocaleDateString()}
        </div>
      </div>
    </Card>
  );
};

export default AgencyResourceCard;
