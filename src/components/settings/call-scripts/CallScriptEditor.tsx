import React from "react";
import { FileText, ChevronDown, Eye, Pencil, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PRODUCT_TYPES, type ProductType } from "./callScriptSchema";
import { productBadgeClass } from "./callScriptConstants";
import { renderMergePreview, wordCount } from "./callScriptUtils";
import { CallScriptToolbar } from "./CallScriptToolbar";
import type { Script } from "./callScriptTypes";

interface CallScriptEditorProps {
  selected: Script | null;
  canManage: boolean;
  editorContent: string;
  editorDirty: boolean;
  previewMode: boolean;
  saving: boolean;
  editorRef: React.RefObject<HTMLTextAreaElement>;
  onSetPreview: (v: boolean) => void;
  onEditorChange: (v: string) => void;
  onChangeName: (v: string) => void;
  onChangeProductType: (id: string, pt: ProductType) => void;
  onSave: () => void;
  onWrap: (before: string, after: string) => void;
  onInsertMergeField: (field: string) => void;
}

export const CallScriptEditor: React.FC<CallScriptEditorProps> = ({
  selected,
  canManage,
  editorContent,
  editorDirty,
  previewMode,
  saving,
  editorRef,
  onSetPreview,
  onEditorChange,
  onChangeName,
  onChangeProductType,
  onSave,
  onWrap,
  onInsertMergeField,
}) => {
  if (!selected) {
    return (
      <div className="w-[65%] flex flex-col">
        <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-card">
          <FileText className="w-12 h-12 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">Select a script from the list to view{canManage ? " and edit" : ""} it.</p>
        </div>
      </div>
    );
  }

  const previewContent = renderMergePreview(editorContent, selected.productType);
  const wc = wordCount(editorContent);
  const readTime = (wc / 160).toFixed(1);

  return (
    <div className="w-[65%] flex flex-col">
      {/* Editor header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card">
        <div className="flex flex-col gap-1 min-w-0 flex-1 pr-2">
          <div className="flex items-center gap-2 text-muted-foreground text-[10px] uppercase font-bold tracking-wider">
            {canManage ? (
              <>
                {editorDirty && <span className="w-2 h-2 rounded-full bg-warning animate-pulse" />}
                {editorDirty ? "Unsaved Changes" : "Saved"}
              </>
            ) : (
              <>
                <Lock className="w-3 h-3" /> Read-only
              </>
            )}
          </div>
          {canManage ? (
            <input
              value={selected.name}
              onChange={(e) => onChangeName(e.target.value)}
              className="text-base font-semibold bg-transparent text-foreground border-0 focus:outline-none focus:ring-0 w-full truncate p-0 h-6"
              maxLength={60}
            />
          ) : (
            <p className="text-base font-semibold text-foreground truncate">{selected.name}</p>
          )}
          <div>
            {canManage ? (
              <Popover>
                <PopoverTrigger asChild>
                  <button className={`text-[11px] px-2 py-0.5 mt-0.5 rounded border font-medium cursor-pointer hover:opacity-80 ${productBadgeClass[selected.productType]}`}>
                    {selected.productType} <ChevronDown className="w-3 h-3 inline ml-0.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-40 p-1">
                  {PRODUCT_TYPES.map((pt) => (
                    <button
                      key={pt}
                      onClick={() => onChangeProductType(selected.id, pt)}
                      className="w-full text-left text-sm px-3 py-1.5 rounded hover:bg-accent text-foreground"
                    >
                      {pt}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            ) : (
              <span className={`text-[11px] px-2 py-0.5 mt-0.5 rounded border font-medium inline-block ${productBadgeClass[selected.productType]}`}>
                {selected.productType}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center bg-accent rounded-lg p-0.5 shrink-0 self-start mt-1">
          <button
            onClick={() => onSetPreview(false)}
            className={`px-3 py-1 rounded text-xs font-medium sidebar-transition ${!previewMode ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"}`}
          >
            <Pencil className="w-3 h-3 inline mr-1" /> {canManage ? "Edit" : "View"}
          </button>
          <button
            onClick={() => onSetPreview(true)}
            className={`px-3 py-1 rounded text-xs font-medium sidebar-transition ${previewMode ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"}`}
          >
            <Eye className="w-3 h-3 inline mr-1" /> Preview
          </button>
        </div>
      </div>

      {/* Toolbar — managers only */}
      {!previewMode && canManage && (
        <CallScriptToolbar onWrap={onWrap} onInsertMergeField={onInsertMergeField} />
      )}

      {/* Preview banner */}
      {previewMode && (
        <div className="px-4 py-2 bg-muted text-muted-foreground text-xs border-b font-medium tracking-wide">
          Preview mode — merge fields shown with example values
        </div>
      )}

      {/* Editor / Preview area */}
      <div className="flex-1 px-4 py-4 overflow-y-auto bg-card">
        {previewMode || !canManage ? (
          <div className="prose prose-sm max-w-none text-foreground whitespace-pre-wrap font-sans leading-relaxed" style={{ minHeight: 400 }}>
            {(previewMode ? previewContent : editorContent) || <span className="text-muted-foreground italic">No content to preview.</span>}
          </div>
        ) : (
          <textarea
            ref={editorRef}
            value={editorContent}
            onChange={(e) => onEditorChange(e.target.value)}
            placeholder="Start writing your script here..."
            className="w-full h-full bg-transparent text-foreground text-sm resize-none focus:outline-none placeholder:text-muted-foreground leading-relaxed p-1"
            style={{ minHeight: 400 }}
          />
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t bg-card mt-auto shrink-0">
        <span className="text-xs font-medium text-muted-foreground">
          {wc} {wc === 1 ? 'word' : 'words'} · ~{readTime} min read
        </span>
        {!previewMode && canManage && (
          <Button
            onClick={onSave}
            disabled={!editorDirty || saving}
            size="sm"
            className="gap-2 px-6 shadow-sm font-medium"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        )}
      </div>
    </div>
  );
};
