import React from "react";
import { TrainingResource } from "@/types/training";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, FileText, ScrollText, CheckCircle2, Clock, Download } from "lucide-react";
import { cn } from "@/lib/utils";

interface ResourceCardProps {
  resource: TrainingResource;
  onClick: (resource: TrainingResource) => void;
}

const ResourceCard: React.FC<ResourceCardProps> = ({ resource, onClick }) => {
  const Icon = {
    video: Play,
    script: ScrollText,
    document: FileText,
  }[resource.type];

  return (
    <Card 
      className="group relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 cursor-pointer border-border/50 bg-card/50 backdrop-blur-sm"
      onClick={() => onClick(resource)}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video overflow-hidden bg-muted">
        {resource.thumbnailUrl ? (
          <img 
            src={resource.thumbnailUrl} 
            alt={resource.title} 
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-primary/5">
            <Icon className="h-12 w-12 text-primary/20" />
          </div>
        )}
        
        {/* Overlays */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        
        {resource.type === 'video' && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <div className="h-12 w-12 rounded-full bg-primary flex items-center justify-center text-primary-foreground shadow-lg transform scale-90 group-hover:scale-100 transition-transform duration-300">
              <Play className="h-6 w-6 fill-current" />
            </div>
          </div>
        )}

        <div className="absolute top-2 right-2">
          {resource.isCompleted && (
            <Badge variant="secondary" className="bg-green-500/10 text-green-500 border-green-500/20 backdrop-blur-md">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Completed
            </Badge>
          )}
        </div>

        {resource.duration && (
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-medium text-white backdrop-blur-sm">
            {resource.duration}
          </div>
        )}
      </div>

      <CardHeader className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-semibold py-0">
            {resource.category}
          </Badge>
          <span className="text-muted-foreground text-[10px] flex items-center gap-1">
            {resource.type === 'document' ? <Download className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
            {resource.fileSize || resource.duration || "5 min"}
          </span>
        </div>
        <CardTitle className="text-lg group-hover:text-primary transition-colors line-clamp-1">
          {resource.title}
        </CardTitle>
        <CardDescription className="line-clamp-2 text-xs">
          {resource.description}
        </CardDescription>
      </CardHeader>
      
      <div className="px-4 pb-4 mt-auto flex items-center justify-between">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
          <Icon className="h-3.5 w-3.5" />
          {resource.type.toUpperCase()}
        </div>
        <div className="text-[10px] text-muted-foreground">
          Added {new Date(resource.createdAt).toLocaleDateString()}
        </div>
      </div>
    </Card>
  );
};

export default ResourceCard;
