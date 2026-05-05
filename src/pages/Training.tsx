import React, { useState, useMemo } from "react";
import { Search, Plus, GraduationCap, Play, ScrollText, FileText, LayoutGrid } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { MOCK_RESOURCES, TRAINING_CATEGORIES } from "@/constants/trainingData";
import ResourceCard from "@/components/training/ResourceCard";
import ResourceDetail from "@/components/training/ResourceDetail";
import AddResourceModal from "@/components/training/AddResourceModal";
import { TrainingResource } from "@/types/training";
import { cn } from "@/lib/utils";

const Training: React.FC = () => {
  const { profile } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [selectedResource, setSelectedResource] = useState<TrainingResource | null>(null);
  const [resources, setResources] = useState<TrainingResource[]>(MOCK_RESOURCES);

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
    // Also update selected resource if it's the one being toggled
    if (selectedResource?.id === id) {
      setSelectedResource(prev => prev ? { ...prev, isCompleted: !prev.isCompleted } : null);
    }
  };

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';

  return (
    <div className="container mx-auto py-8 space-y-8 animate-in fade-in duration-500">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <GraduationCap className="h-8 w-8 text-primary" />
            Agency Training Center
          </h1>
          <p className="text-muted-foreground mt-1">
            Empower your team with scripts, guides, and onboarding videos.
          </p>
        </div>
        {isAdmin && <AddResourceModal />}
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col lg:flex-row gap-4 items-center justify-between bg-card/50 backdrop-blur-sm p-4 rounded-xl border border-border/50">
        <div className="relative w-full lg:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search scripts, videos, or guides..." 
            className="pl-10 bg-background/50 border-border/50 focus-visible:ring-primary/20"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <Tabs 
          value={activeCategory} 
          onValueChange={setActiveCategory} 
          className="w-full lg:w-auto"
        >
          <TabsList className="bg-background/50 border border-border/50 h-10 p-1">
            {TRAINING_CATEGORIES.map(category => (
              <TabsTrigger 
                key={category} 
                value={category}
                className="px-4 py-1.5 text-xs font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all"
              >
                {category}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Resources Grid */}
      {filteredResources.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
          {filteredResources.map((resource) => (
            <ResourceCard 
              key={resource.id} 
              resource={resource} 
              onClick={setSelectedResource}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center bg-card/30 rounded-3xl border border-dashed border-border/50">
          <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center mb-4">
            <Search className="h-10 w-10 text-muted-foreground/50" />
          </div>
          <h3 className="text-xl font-semibold">No resources found</h3>
          <p className="text-muted-foreground max-w-xs mt-2">
            Try adjusting your search or category filters to find what you're looking for.
          </p>
          <Button 
            variant="link" 
            onClick={() => { setSearchQuery(""); setActiveCategory("All"); }}
            className="mt-4"
          >
            Clear all filters
          </Button>
        </div>
      )}

      {/* Resource Detail Modal */}
      <ResourceDetail 
        resource={selectedResource}
        open={!!selectedResource}
        onOpenChange={(open) => !open && setSelectedResource(null)}
        onToggleComplete={handleToggleComplete}
      />

      {/* Quick Stats / Legend */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-8">
        {[
          { icon: Play, label: "Video Lessons", count: resources.filter(r => r.type === 'video').length, color: "text-blue-500" },
          { icon: ScrollText, label: "Sales Scripts", count: resources.filter(r => r.type === 'script').length, color: "text-amber-500" },
          { icon: FileText, label: "Resource Guides", count: resources.filter(r => r.type === 'document').length, color: "text-emerald-500" },
        ].map((stat, i) => (
          <div key={i} className="flex items-center gap-3 p-4 rounded-xl bg-card/30 border border-border/50">
            <div className={cn("p-2 rounded-lg bg-background/50 shadow-sm", stat.color)}>
              <stat.icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium">{stat.label}</p>
              <p className="text-2xl font-bold">{stat.count}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Training;
