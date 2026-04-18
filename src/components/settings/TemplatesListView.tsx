import { Mail, MessageSquare, Plus, Loader2, Pencil, Trash2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Template } from "@/components/settings/messageTemplateTypes";

interface TemplatesListViewProps {
  loading: boolean;
  filtered: Template[];
  onAdd: () => void;
  onEdit: (t: Template) => void;
  onDuplicate: (t: Template) => void;
  onDelete: (t: Template) => void;
}

export function TemplatesListView({
  loading,
  filtered,
  onAdd,
  onEdit,
  onDuplicate,
  onDelete,
}: TemplatesListViewProps) {
  return (
    <div className="max-h-[600px] min-h-[400px] divide-y overflow-hidden overflow-y-auto rounded-xl border bg-card">
      {loading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-[300px] flex-col items-center justify-center p-6 text-center">
          <Mail className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="font-medium text-foreground">No templates found</p>
          <p className="mb-4 text-sm text-muted-foreground">You haven&apos;t added any templates matching your criteria.</p>
          <Button size="sm" onClick={onAdd} className="gap-2">
            <Plus className="h-4 w-4" /> Add Template
          </Button>
        </div>
      ) : (
        filtered.map((t) => (
          <div key={t.id} className="sidebar-transition flex items-center justify-between p-4 hover:bg-accent/50">
            <div className="flex min-w-0 flex-1 items-start gap-3 pr-4">
              <div
                className={`mt-1 shrink-0 rounded-lg p-2 ${t.type === "email" ? "bg-primary/10 text-primary" : "bg-success/10 text-success"}`}
              >
                {t.type === "email" ? <Mail className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex flex-wrap items-center gap-2">
                  <h4 className="truncate font-semibold text-foreground">{t.name}</h4>
                  <Badge variant={t.type === "email" ? "default" : "secondary"} className="text-[10px] font-bold uppercase tracking-wider">
                    {t.type}
                  </Badge>
                  {t.category && (
                    <Badge variant="outline" className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t.category}
                    </Badge>
                  )}
                </div>
                {t.type === "email" && t.subject && (
                  <p className="mb-1 truncate text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/80">Subj:</span> {t.subject}
                  </p>
                )}
                <p className="mt-1 line-clamp-1 rounded bg-accent/30 p-1.5 font-mono text-xs text-muted-foreground">{t.content}</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => onEdit(t)} title="Edit Template">
                <Pencil className="h-4 w-4 text-muted-foreground" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => onDuplicate(t)} title="Duplicate Template">
                <Copy className="h-4 w-4 text-muted-foreground" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onDelete(t)}
                title="Delete Template"
                className="hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
