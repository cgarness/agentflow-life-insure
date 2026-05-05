import React, { useState, useMemo } from "react";
import { Search, GraduationCap, Play, ScrollText, FileText, ChevronRight, Hash, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useTraining } from "@/hooks/useTraining";
import ResourceCard from "@/components/training/ResourceCard";
import ResourceDetail from "@/components/training/ResourceDetail";
import AddResourceModal from "@/components/training/AddResourceModal";
import CategoryManager from "@/components/training/CategoryManager";
import { TrainingResource } from "@/types/training";
import { cn } from "@/lib/utils";

const Training: React.FC = () => {
  const { profile } = useAuth();
  const { 
    categories, 
    resources, 
    isLoading, 
    addResource, 
    deleteResource, 
    toggleComplete, 
    addCategory, 
    removeCategory 
  } = useTraining();

  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState<string>("all");
  const [selectedResource, setSelectedResource] = useState<TrainingResource | null>(null);

  // Derived state for filtered resources
  const filteredResources = useMemo(() => {
    return resources.filter((resource) => {
      const matchesSearch = resource.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           resource.description?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = activeCategoryId === "all" || resource.category_id === activeCategoryId;
      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, activeCategoryId, resources]);

  const handleToggleComplete = (id: string) => {
    const resource = resources.find(r => r.id === id);
    if (resource) {
      toggleComplete.mutate({ id, completed: !resource.is_completed });
    }
  };

  const activeCategoryName = activeCategoryId === "all" 
    ? "All Resources" 
    : categories.find(c => c.id === activeCategoryId)?.name || "Category";

  // Case-insensitive role check for Admin and Super Admin
  const isAdmin = profile?.role?.toLowerCase() === 'admin' || 
                  profile?.role?.toLowerCase() === 'super admin' ||
                  profile?.is_super_admin === true;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Loading training center...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-4rem)] bg-background/50 animate-in fade-in duration-500">
      {/* Sidebar Navigation */}
      <aside className="w-full lg:w-64 border-r border-border/50 bg-card/30 backdrop-blur-md p-6 space-y-8 lg:sticky lg:top-0 h-auto lg:h-[calc(100vh-4rem)] overflow-y-auto">
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <GraduationCap className="h-6 w-6 text-primary" />
            Training Center
          </h1>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
            Knowledge Library
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Categories</p>
            {isAdmin && (
              <CategoryManager 
                categories={categories} 
                onAddCategory={(name) => addCategory.mutate(name)} 
                onRemoveCategory={(name) => removeCategory.mutate(name)} 
              />
            )}
          </div>
          <nav className="space-y-1">
            <button
              onClick={() => setActiveCategoryId("all")}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-all group",
                activeCategoryId === "all" 
                  ? "bg-primary text-primary-foreground shadow-md shadow-primary/20" 
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <div className="flex items-center gap-2">
                <Hash className={cn("h-3.5 w-3.5 opacity-50", activeCategoryId === "all" ? "text-primary-foreground" : "text-primary")} />
                All Resources
              </div>
              {activeCategoryId === "all" && <ChevronRight className="h-3 w-3" />}
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                onClick={() => setActiveCategoryId(category.id)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-all group",
                  activeCategoryId === category.id 
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20" 
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <div className="flex items-center gap-2">
                  <Hash className={cn("h-3.5 w-3.5 opacity-50", activeCategoryId === category.id ? "text-primary-foreground" : "text-primary")} />
                  {category.name}
                </div>
                {activeCategoryId === category.id && <ChevronRight className="h-3 w-3" />}
              </button>
            ))}
          </nav>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-6 lg:p-10 space-y-8 overflow-y-auto">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold tracking-tight">{activeCategoryName}</h2>
            <p className="text-muted-foreground text-sm">
              Viewing {filteredResources.length} resources in {activeCategoryName}
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search resources..." 
                className="pl-10 bg-background/50 border-border/50"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {isAdmin && (
              <AddResourceModal 
                categories={categories} 
                onAdd={(data) => addResource.mutate(data)} 
              />
            )}
          </div>
        </header>

        {/* Resources Grid */}
        {filteredResources.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
            {filteredResources.map((resource) => (
              <ResourceCard 
                key={resource.id} 
                resource={resource} 
                onClick={setSelectedResource}
                onDelete={(id) => deleteResource.mutate(id)}
                isAdmin={isAdmin}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-24 text-center bg-card/20 rounded-3xl border border-dashed border-border/50">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Search className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <h3 className="text-lg font-semibold">No results found</h3>
            <p className="text-muted-foreground max-w-xs mt-1 text-sm">
              We couldn't find any resources matching your criteria in this category.
            </p>
          </div>
        )}

        {/* Resource Detail Modal */}
        <ResourceDetail 
          resource={selectedResource}
          open={!!selectedResource}
          onOpenChange={(open) => !open && setSelectedResource(null)}
          onToggleComplete={handleToggleComplete}
        />
      </main>
    </div>
  );
};

export default Training;
