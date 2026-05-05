import React, { useState, useMemo } from "react";
import { 
  FileText, Search, ScrollText, Download, ExternalLink, 
  ChevronRight, Loader2, FolderOpen, MoreVertical, Trash2
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useResources } from "@/hooks/useResources";
import { cn } from "@/lib/utils";
import AddAgencyResourceModal from "@/components/resources/AddAgencyResourceModal";
import ResourceCategoryManager from "@/components/resources/ResourceCategoryManager";
import AgencyResourceCard from "@/components/resources/AgencyResourceCard";
import { Script, AgencyResource } from "@/types/resources";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type TabView = "scripts" | "documents";

const Resources: React.FC = () => {
  const { profile } = useAuth();
  const { scripts, documents, categories, isLoading, addDocument, deleteDocument, addCategory, removeCategory } = useResources();
  
  const [activeTab, setActiveTab] = useState<TabView>("documents");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedScript, setSelectedScript] = useState<Script | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<AgencyResource | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("all");

  const isAdmin = profile?.role?.toLowerCase() === 'admin' || 
                  profile?.role?.toLowerCase() === 'super admin' ||
                  profile?.is_super_admin === true;

  // Set initial selected script if none is selected
  React.useEffect(() => {
    if (activeTab === "scripts" && scripts.length > 0 && !selectedScript) {
      setSelectedScript(scripts[0]);
    }
  }, [scripts, activeTab, selectedScript]);

  const filteredScripts = useMemo(() => {
    return scripts.filter(s => 
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      s.content.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [scripts, searchQuery]);

  const filteredDocuments = useMemo(() => {
    let filtered = documents;
    
    if (selectedCategoryId !== "all") {
      filtered = filtered.filter(d => d.category_id === selectedCategoryId);
    }
    
    return filtered.filter(d => {
      const categoryName = categories.find(c => c.id === d.category_id)?.name || "Unknown";
      return d.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
             categoryName.toLowerCase().includes(searchQuery.toLowerCase());
    });
  }, [documents, categories, searchQuery, selectedCategoryId]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Loading resources...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-4rem)] bg-background/50 animate-in fade-in duration-500">
      {/* Sidebar Navigation */}
      <aside className="w-full lg:w-72 border-r border-border/50 bg-card/30 backdrop-blur-md flex flex-col h-auto lg:h-[calc(100vh-4rem)] shrink-0">
        <div className="p-6 pb-4 space-y-4 shrink-0">
          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <FolderOpen className="h-6 w-6 text-primary" />
              Resources
            </h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
              Fast Access Library
            </p>
          </div>

          <div className="flex bg-muted/50 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab("scripts")}
              className={cn(
                "flex-1 py-1.5 text-xs font-medium rounded-md transition-all",
                activeTab === "scripts" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Scripts
            </button>
            <button
              onClick={() => setActiveTab("documents")}
              className={cn(
                "flex-1 py-1.5 text-xs font-medium rounded-md transition-all",
                activeTab === "documents" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Documents
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input 
              placeholder={`Search ${activeTab}...`} 
              className="pl-9 h-9 text-sm bg-background/50 border-border/50"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Sidebar Content */}
        <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-1 custom-scrollbar">
          {activeTab === "scripts" ? (
            filteredScripts.length > 0 ? (
              filteredScripts.map(script => (
                <button
                  key={script.id}
                  onClick={() => setSelectedScript(script)}
                  className={cn(
                    "w-full flex items-start flex-col gap-1 px-3 py-3 text-left rounded-lg transition-all border",
                    selectedScript?.id === script.id 
                      ? "bg-primary/10 border-primary/20 shadow-sm" 
                      : "bg-transparent border-transparent hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                  )}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className={cn("text-sm font-semibold truncate", selectedScript?.id === script.id && "text-primary")}>
                      {script.name}
                    </span>
                    <ChevronRight className={cn("h-3.5 w-3.5 opacity-50 shrink-0", selectedScript?.id === script.id && "text-primary opacity-100")} />
                  </div>
                  <Badge variant="outline" className="text-[9px] py-0 h-4 border-muted-foreground/20">
                    {script.productType}
                  </Badge>
                </button>
              ))
            ) : (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No scripts found.
              </div>
            )
          ) : (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground mb-3 px-2">Folders</p>
              <button
                onClick={() => setSelectedCategoryId("all")}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 text-left rounded-md transition-all text-sm font-medium",
                  selectedCategoryId === "all"
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                )}
              >
                All Documents
                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                  {documents.length}
                </span>
              </button>
              
              {categories.map(cat => {
                const count = documents.filter(d => d.category_id === cat.id).length;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategoryId(cat.id)}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2 text-left rounded-md transition-all text-sm font-medium",
                      selectedCategoryId === cat.id
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {cat.name}
                    <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                      {count}
                    </span>
                  </button>
                );
              })}

              {isAdmin && (
                <div className="pt-4 mt-4 border-t border-border/50 px-2">
                  <ResourceCategoryManager 
                    categories={categories} 
                    onAddCategory={(name) => addCategory.mutate(name)} 
                    onRemoveCategory={(name) => removeCategory.mutate(name)} 
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area (Script Viewer or Doc Empty State) */}
      <main className="flex-1 flex flex-col h-auto lg:h-[calc(100vh-4rem)] overflow-hidden">
        {activeTab === "scripts" ? (
          selectedScript ? (
            <div className="flex flex-col h-full bg-card/30">
              <header className="px-8 py-6 border-b border-border/50 bg-background/50 backdrop-blur shrink-0 flex justify-between items-center">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="secondary" className="text-[10px] uppercase tracking-wider bg-primary/10 text-primary hover:bg-primary/20 border-none">
                      {selectedScript.productType}
                    </Badge>
                  </div>
                  <h2 className="text-2xl font-bold tracking-tight text-foreground">
                    {selectedScript.name}
                  </h2>
                </div>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => {
                  navigator.clipboard.writeText(selectedScript.content);
                  // Optional: add a toast here for feedback
                }}>
                  <ScrollText className="h-4 w-4" />
                  Copy Script
                </Button>
              </header>
              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                <div className="max-w-3xl mx-auto prose prose-sm dark:prose-invert text-foreground/90 whitespace-pre-wrap leading-relaxed">
                  {selectedScript.content || <span className="text-muted-foreground italic">This script is empty.</span>}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <ScrollText className="h-8 w-8 text-muted-foreground/50" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">No script selected</h3>
              <p className="text-muted-foreground text-sm max-w-sm mt-1">
                Select a script from the sidebar to view its contents.
              </p>
            </div>
          )
        ) : (
          selectedDocument ? (
            <div className="flex flex-col h-full bg-card/30">
              <header className="px-8 py-6 border-b border-border/50 bg-background/50 backdrop-blur shrink-0 flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" onClick={() => setSelectedDocument(null)}>
                    <ChevronRight className="h-4 w-4 rotate-180" />
                    Back to Grid
                  </Button>
                  <div className="h-6 w-px bg-border mx-2" />
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="secondary" className="text-[10px] uppercase tracking-wider bg-blue-500/10 text-blue-500 border-none">
                        {categories.find(c => c.id === selectedDocument.category_id)?.name || "Document"}
                      </Badge>
                    </div>
                    <h2 className="text-xl font-bold tracking-tight text-foreground line-clamp-1">
                      {selectedDocument.title}
                    </h2>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <Button variant="outline" size="sm" className="gap-2" asChild>
                    <a href={selectedDocument.content_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                      Open Full Screen
                    </a>
                  </Button>
                </div>
              </header>
              <div className="flex-1 bg-muted/30 p-8">
                <div className="h-full w-full max-w-5xl mx-auto rounded-xl overflow-hidden border border-border/50 shadow-sm bg-white">
                  {selectedDocument.content_url ? (
                    <iframe 
                      src={selectedDocument.content_url} 
                      className="w-full h-full border-none"
                      title={selectedDocument.title}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-card">
                      <p className="text-muted-foreground">No document file available.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full bg-card/10">
              <header className="px-8 py-6 border-b border-border/50 bg-background/50 backdrop-blur shrink-0 flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-foreground mb-1">
                    {selectedCategoryId === "all" ? "All Documents" : categories.find(c => c.id === selectedCategoryId)?.name || "Documents"}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {filteredDocuments.length} resources available
                  </p>
                </div>
                {isAdmin && (
                  <AddAgencyResourceModal categories={categories} onAdd={(doc, file) => addDocument.mutate({ doc, file })} isLoading={addDocument.isPending} />
                )}
              </header>
              
              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                {filteredDocuments.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 max-w-7xl mx-auto">
                    {filteredDocuments.map(doc => (
                      <AgencyResourceCard 
                        key={doc.id}
                        resource={doc}
                        categoryName={categories.find(c => c.id === doc.category_id)?.name || "Unknown"}
                        onClick={setSelectedDocument}
                        onDelete={deleteDocument.mutate}
                        isAdmin={isAdmin}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-center h-full max-w-md mx-auto">
                    <div className="h-20 w-20 rounded-full bg-primary/5 flex items-center justify-center mb-6">
                      <FileText className="h-10 w-10 text-primary/40" />
                    </div>
                    <h3 className="text-xl font-bold tracking-tight text-foreground mb-2">No documents found</h3>
                    <p className="text-muted-foreground text-sm mb-8">
                      {selectedCategoryId === "all" 
                        ? "There are no agency documents uploaded yet."
                        : "There are no documents in this category."}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )
        )}
      </main>
    </div>
  );
};

export default Resources;
