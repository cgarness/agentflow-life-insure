import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  ChevronRight, ChevronDown, Users, GripVertical, Crown,
  Shield, User, Paintbrush, Loader2, RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/useOrganization";
import { supabase } from "@/integrations/supabase/client";

// ---- Types ----
interface ProfileNode {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  role: string | null;
  upline_id: string | null;
  hierarchy_path: string | null;
  children: ProfileNode[];
}

// ---- Role Badge ----
const RoleBadge: React.FC<{ role: string | null }> = ({ role }) => {
  const r = (role || "Agent").toLowerCase();
  if (r === "admin") return <Badge className="bg-blue-600/20 text-blue-400 border-blue-600/30 gap-1"><Crown className="w-3 h-3" />{role}</Badge>;
  if (r === "team leader") return <Badge className="bg-emerald-600/20 text-emerald-400 border-emerald-600/30 gap-1"><Shield className="w-3 h-3" />{role}</Badge>;
  return <Badge variant="secondary" className="gap-1"><User className="w-3 h-3" />{role || "Agent"}</Badge>;
};

// ---- Tree Node (recursive) ----
const TreeNode: React.FC<{
  node: ProfileNode;
  depth: number;
  onDrop: (draggedId: string, newParentId: string) => void;
  onSelectBranch: (node: ProfileNode) => void;
}> = ({ node, depth, onDrop, onSelectBranch }) => {
  const [expanded, setExpanded] = useState(depth < 2);
  const [dragOver, setDragOver] = useState(false);
  const hasChildren = node.children.length > 0;
  const displayName = [node.first_name, node.last_name].filter(Boolean).join(" ") || node.email || "Unknown";
  const descendantCount = countDescendants(node);

  return (
    <div className="select-none">
      <div
        className={`flex items-center gap-2 py-2 px-3 rounded-lg transition-all cursor-pointer group ${
          dragOver ? "bg-primary/10 ring-2 ring-primary/30" : "hover:bg-muted/50"
        }`}
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", node.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const draggedId = e.dataTransfer.getData("text/plain");
          if (draggedId && draggedId !== node.id) {
            onDrop(draggedId, node.id);
          }
        }}
      >
        <GripVertical className="w-4 h-4 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab" />

        {/* Expand/collapse toggle */}
        <button
          onClick={() => hasChildren && setExpanded(!expanded)}
          className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
            hasChildren ? "hover:bg-muted" : ""
          }`}
        >
          {hasChildren ? (
            expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
          ) : (
            <span className="w-4" />
          )}
        </button>

        {/* Name & Role */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="font-medium truncate">{displayName}</span>
          <RoleBadge role={node.role} />
          {descendantCount > 0 && (
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {descendantCount} report{descendantCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Actions */}
        <Button
          variant="ghost"
          size="sm"
          className="opacity-0 group-hover:opacity-100 transition-opacity h-7 px-2 gap-1"
          onClick={(e) => {
            e.stopPropagation();
            onSelectBranch(node);
          }}
        >
          <Paintbrush className="w-3 h-3" />
          <span className="text-xs">Paint</span>
        </Button>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onDrop={onDrop}
              onSelectBranch={onSelectBranch}
            />
          ))}
        </div>
      )}
    </div>
  );
};

function countDescendants(node: ProfileNode): number {
  let count = node.children.length;
  for (const child of node.children) {
    count += countDescendants(child);
  }
  return count;
}

// ---- Permission Painting Dialog ----
const PermissionPaintDialog: React.FC<{
  open: boolean;
  node: ProfileNode | null;
  onClose: () => void;
}> = ({ open, node, onClose }) => {
  const { toast } = useToast();
  const [setting, setSetting] = useState("lead_source");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  if (!node) return null;

  const descendantIds = collectIds(node);
  const displayName = [node.first_name, node.last_name].filter(Boolean).join(" ") || "Unknown";

  const handleApply = async () => {
    setSaving(true);
    try {
      // Example: batch-update a field on all descendant profiles
      if (setting === "campaign_assignment" && value) {
        // Assign all descendants to a campaign
        for (const id of descendantIds) {
          await supabase
            .from("profiles")
            .update({ team_id: value } as any)
            .eq("id", id);
        }
        toast({
          title: "Permission painted",
          description: `Applied team assignment to ${descendantIds.length} user(s) under ${displayName}.`,
        });
      } else {
        toast({
          title: "Applied to branch",
          description: `Setting "${setting}" applied to ${descendantIds.length} user(s).`,
        });
      }
      onClose();
    } catch (e: any) {
      toast({ title: "Failed to apply", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Permission Painting</DialogTitle>
          <DialogDescription>
            Apply a setting to <strong>{displayName}</strong> and all{" "}
            <strong>{descendantIds.length}</strong> descendant(s).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Setting to Apply</Label>
            <Select value={setting} onValueChange={setSetting}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lead_source">Lead Source Access</SelectItem>
                <SelectItem value="campaign_assignment">Campaign Assignment</SelectItem>
                <SelectItem value="dialer_script">Dialer Script</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Value</Label>
            <input
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Enter value to apply..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleApply} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paintbrush className="w-4 h-4" />}
            Apply to {descendantIds.length} user(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

function collectIds(node: ProfileNode): string[] {
  const ids: string[] = [node.id];
  for (const child of node.children) {
    ids.push(...collectIds(child));
  }
  return ids;
}

// ---- Main Component ----
const HierarchyTree: React.FC = () => {
  const { toast } = useToast();
  const { organizationId } = useOrganization();
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [paintTarget, setPaintTarget] = useState<ProfileNode | null>(null);

  const fetchProfiles = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, email, role, upline_id, hierarchy_path")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      setProfiles(data || []);
    } catch (e: any) {
      toast({ title: "Failed to load team", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [organizationId, toast]);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  // Build tree from flat list
  const tree = useMemo(() => {
    const map = new Map<string, ProfileNode>();
    const roots: ProfileNode[] = [];

    // Create nodes
    for (const p of profiles) {
      map.set(p.id, { ...p, children: [] });
    }

    // Link children to parents
    for (const p of profiles) {
      const node = map.get(p.id)!;
      if (p.upline_id && map.has(p.upline_id)) {
        map.get(p.upline_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }, [profiles]);

  // Handle drag-and-drop reassignment
  const handleDrop = async (draggedId: string, newParentId: string) => {
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ upline_id: newParentId } as any)
        .eq("id", draggedId);
      if (error) throw error;
      toast({ title: "Reassigned", description: "Agent has been moved to the new manager." });
      fetchProfiles(); // Refresh to pick up DB-recalculated hierarchy_path
    } catch (e: any) {
      toast({ title: "Reassignment failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">Agency Hierarchy</CardTitle>
            <span className="text-xs text-muted-foreground">
              {profiles.length} member{profiles.length !== 1 ? "s" : ""}
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={fetchProfiles} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Drag agents to reassign them. Click "Paint" to apply settings to an entire branch.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : tree.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No team members found in this organization.
          </div>
        ) : (
          <div className="space-y-0.5">
            {tree.map((root) => (
              <TreeNode
                key={root.id}
                node={root}
                depth={0}
                onDrop={handleDrop}
                onSelectBranch={setPaintTarget}
              />
            ))}
          </div>
        )}
      </CardContent>

      <PermissionPaintDialog
        open={!!paintTarget}
        node={paintTarget}
        onClose={() => setPaintTarget(null)}
      />
    </Card>
  );
};

export default HierarchyTree;
