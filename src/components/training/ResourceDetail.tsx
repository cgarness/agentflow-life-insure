import React from "react";
import { TrainingResource } from "@/types/training";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Download, ExternalLink, Play, ScrollText, FileText } from "lucide-react";

interface ResourceDetailProps {
  resource: TrainingResource | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleComplete: (id: string) => void;
}

const ResourceDetail: React.FC<ResourceDetailProps> = ({ 
  resource, 
  open, 
  onOpenChange,
  onToggleComplete
}) => {
  if (!resource) return null;

  const Icon = {
    video: Play,
    script: ScrollText,
    document: FileText,
  }[resource.type];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-background/95 backdrop-blur-xl border-border/50">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline" className="uppercase tracking-widest text-[10px]">
              {resource.category}
            </Badge>
            <span className="text-muted-foreground text-xs">|</span>
            <div className="flex items-center gap-1 text-xs text-muted-foreground uppercase font-medium">
              <Icon className="h-3.5 w-3.5" />
              {resource.type}
            </div>
          </div>
          <DialogTitle className="text-2xl font-bold tracking-tight">
            {resource.title}
          </DialogTitle>
          <DialogDescription className="text-base text-muted-foreground">
            {resource.description}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-6 space-y-6">
          {/* Content Area */}
          <div className="rounded-xl overflow-hidden bg-muted/30 border border-border/50 aspect-video relative flex items-center justify-center">
            {resource.type === 'video' ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
                <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center text-primary animate-pulse">
                  <Play className="h-10 w-10 fill-current" />
                </div>
                <div>
                  <h4 className="font-semibold text-lg">Ready to watch?</h4>
                  <p className="text-sm text-muted-foreground mb-4">This video will open in a new tab for the best experience.</p>
                  <Button asChild>
                    <a href={resource.contentUrl} target="_blank" rel="noopener noreferrer" className="gap-2">
                      Open Video Player <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </div>
            ) : resource.type === 'script' ? (
              <div className="w-full h-full p-8 overflow-y-auto bg-card text-card-foreground">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  {resource.content?.split('\n').map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
                <div className="h-20 w-20 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
                  <FileText className="h-10 w-10" />
                </div>
                <div>
                  <h4 className="font-semibold text-lg">{resource.fileSize} PDF Document</h4>
                  <p className="text-sm text-muted-foreground mb-4">View or download this resource for your reference.</p>
                  <div className="flex gap-2 justify-center">
                    <Button variant="outline" asChild>
                      <a href={resource.contentUrl} target="_blank" rel="noopener noreferrer" className="gap-2">
                        View Document <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                    <Button className="gap-2">
                      Download <Download className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Action Footer */}
          <div className="flex items-center justify-between pt-4 border-t border-border/50">
            <div className="text-sm text-muted-foreground">
              Added on {new Date(resource.createdAt).toLocaleDateString()}
            </div>
            <Button 
              variant={resource.isCompleted ? "outline" : "default"}
              onClick={() => onToggleComplete(resource.id)}
              className={cn(
                "gap-2 transition-all",
                resource.isCompleted && "bg-green-500/10 text-green-500 hover:bg-green-500/20 hover:text-green-600 border-green-500/20"
              )}
            >
              {resource.isCompleted ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Completed
                </>
              ) : (
                "Mark as Complete"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ResourceDetail;
