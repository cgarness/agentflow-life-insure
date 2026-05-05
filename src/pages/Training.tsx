import React, { useState, useMemo } from "react";
import { Search, GraduationCap, Play, ScrollText, FileText, ChevronRight, Hash } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { MOCK_RESOURCES, TRAINING_CATEGORIES } from "@/constants/trainingData";
import ResourceCard from "@/components/training/ResourceCard";
import ResourceDetail from "@/components/training/ResourceDetail";
import AddResourceModal from "@/components/training/AddResourceModal";
import CategoryManager from "@/components/training/CategoryManager";
import { TrainingResource } from "@/types/training";
import { cn } from "@/lib/utils";

const Training: React.FC = () => {
  const { profile } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [selectedResource, setSelectedResource] = useState<TrainingResource | null>(null);
  const [resources, setResources] = useState<TrainingResource[]>(MOCK_RESOURCES);
  const [categories, setCategories] = useState<string[]>(TRAINING_CATEGORIES);

  // Derived state for filtered resources
  const filteredResources = useMemo(() => {
    return resources.filter((resource) => {
      const matchesSearch = resource.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           resource.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = activeCategory === "All" || resource.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, activeCategory, resources]);

  const handleToggleComplete = (id: string) => {
    setResources(prev => prev.map(r => 
      r.id === id ? { ...r, isCompleted: !r.isCompleted } : r
    ));
    if (selectedResource?.id === id) {
      setSelectedResource(prev => prev ? { ...prev, isCompleted: !prev.isCompleted } : null);
    }
  };

  const handleAddResource = (newResource: TrainingResource) => {
    setResources(prev => [newResource, ...prev]);
  };

  const handleDeleteResource = (id: string) => {
    setResources(prev => prev.filter(r => r.id !== id));
  };

  const handleAddCategory = (newCategory: string) => {
    if (!categories.includes(newCategory)) {
      setCategories(prev => [...prev, newCategory]);
    }
  };

  const handleRemoveCategory = (categoryToRemove: string) => {
    setCategories(prev => prev.filter(c => c !== categoryToRemove));
    if (activeCategory === categoryToRemove) {
      setActiveCategory("All");
    }
  };

  // Case-insensitive role check for Admin and Super Admin
  const isAdmin = profile?.role?.toLowerCase() === 'admin' || 
                  profile?.role?.toLowerCase() === 'super admin' ||
                  profile?.is_super_admin === true;

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
                onAddCategory={handleAddCategory} 
                onRemoveCategory={handleRemoveCategory} 
              />
            )}
          </div>
          <nav className="space-y-1">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setActiveCategory(category)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-all group",
                  activeCategory === category 
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20" 
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <div className="flex items-center gap-2">
                  <Hash className={cn("h-3.5 w-3.5 opacity-50", activeCategory === category ? "text-primary-foreground" : "text-primary")} />
                  {category}
                </div>
                {activeCategory === category && <ChevronRight className="h-3 w-3" />}
              </button>
            ))}
          </nav>
        </div>

        <div className="pt-8 space-y-4 border-t border-border/50">
          <p className="text-xs font-medium text-muted-foreground">Overview</p>
          <div className="space-y-3">
            {[
              { icon: Play, label: "Videos", count: resources.filter(r => r.type === 'video').length, color: "text-blue-500" },
              { icon: ScrollText, label: "Scripts", count: resources.filter(r => r.type === 'script').length, color: "text-amber-500" },
              { icon: FileText, label: "Docs", count: resources.filter(r => r.type === 'document').length, color: "text-emerald-500" },
            ].map((stat, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <stat.icon className={cn("h-3.5 w-3.5", stat.color)} />
                  {stat.label}
                </div>
                <span className="font-bold">{stat.count}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-6 lg:p-10 space-y-8 overflow-y-auto">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold tracking-tight">{activeCategory}</h2>
            <p className="text-muted-foreground text-sm">
              Viewing {filteredResources.length} resources in {activeCategory}
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
                onAdd={handleAddResource} 
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
                onDelete={handleDeleteResource}
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
