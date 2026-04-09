import React, { useState, useEffect } from "react";
import { z } from "zod";
import { X, Loader2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { TagInput } from "@/components/shared/TagInput";

interface AgentProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
}

interface CreateCampaignModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  agents: AgentProfile[];
  agentsLoading: boolean;
}

const campaignSchema = z.object({
  name: z.string().trim().min(1, "Campaign name is required"),
  selectedAgents: z.array(z.string()).min(1, "At least one agent must be assigned"),
});

export const CreateCampaignModal: React.FC<CreateCampaignModalProps> = ({ 
  open, onClose, onCreated, agents, agentsLoading 
}) => {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const [name, setName] = useState("");
  const [type, setType] = useState("Personal");
  const [description, setDescription] = useState("");
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; agents?: string }>({});
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setType("Personal");
      setDescription("");
      setSelectedAgents(user?.id ? [user.id] : []);
      setTags([]);
      setSaving(false);
      setErrors({});
      setAgentDropdownOpen(false);
    }
  }, [open, user?.id]);

  useEffect(() => {
    // When type changes to "Personal", force current user as only agent
    if (type === "Personal" && user?.id) {
      setSelectedAgents([user.id]);
    }
  }, [type, user?.id]);

  const toggleAgent = (id: string) => {
    if (type === "Personal") {
      setSelectedAgents([id]);
    } else {
      setSelectedAgents(prev =>
        prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
      );
    }
    setErrors(prev => ({ ...prev, agents: undefined }));
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    // Validate schema
    const result = campaignSchema.safeParse({ 
      name: name.trim(), 
      selectedAgents 
    });
    
    if (!result.success) {
      const fieldErrors: { name?: string; agents?: string } = {};
      result.error.errors.forEach(err => {
        if (err.path[0] === 'name') fieldErrors.name = err.message;
        if (err.path[0] === 'selectedAgents') fieldErrors.agents = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("campaigns").insert({
      name: name.trim(),
      type,
      description: description.trim(),
      assigned_agent_ids: selectedAgents,
      tags: tags,
      status: "Active",
      created_by: user?.id || null,
      organization_id: organizationId,
    } as any);

    setSaving(false);
    if (error) {
      toast.error("Failed to create campaign: " + error.message, {
        duration: 3000,
        position: "bottom-right",
      });
    } else {
      toast.success("Campaign created successfully", {
        duration: 3000,
        position: "bottom-right",
      });
      onCreated();
      onClose();
    }
  };

  if (!open) return null;

  const typeOptions = [
    { value: "Open Pool", desc: "All assigned agents compete for the same leads in real time" },
    { value: "Personal", desc: "Agent manages their own private lead list" },
    { value: "Team", desc: "Admin assigns specific leads to specific agents" },
  ];

  const getAgentDisplayName = (a: AgentProfile): string => {
    const full = `${a.first_name} ${a.last_name}`.trim();
    return full || a.email || "Unknown";
  };

  const currentUserProfile = user?.id ? agents.find(a => a.id === user.id) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-foreground/50 backdrop-blur-sm" onClick={onClose} />
      <form 
        onSubmit={handleSubmit}
        className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto" 
        style={{ scrollbarWidth: "none" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Create Campaign</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Name */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Campaign Name *</label>
          <input
            value={name} 
            onChange={e => { setName(e.target.value); setErrors(prev => ({ ...prev, name: undefined })); }}
            className={`w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border focus:ring-2 focus:ring-primary/50 focus:outline-none ${errors.name ? "border-destructive" : "border-border"}`}
            placeholder="e.g. Q1 Facebook Leads"
          />
          {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
        </div>

        {/* Type */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Campaign Type</label>
          <div className="grid grid-cols-1 gap-2">
            {typeOptions.map(opt => (
              <label 
                key={opt.value} 
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${type === opt.value ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}
              >
                <input 
                  type="radio" 
                  name="type" 
                  checked={type === opt.value} 
                  onChange={() => setType(opt.value)} 
                  className="mt-0.5 accent-[hsl(var(--primary))]" 
                />
                <div>
                  <span className="text-sm font-medium text-foreground">{opt.value}</span>
                  <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Description</label>
          <textarea
            value={description} 
            onChange={e => setDescription(e.target.value.slice(0, 500))}
            className="w-full h-20 px-3 py-2 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none resize-none"
            placeholder="Brief description..."
          />
          <p className="text-xs text-muted-foreground text-right">{description.length}/500</p>
        </div>

        {/* Tags */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Tags</label>
          <TagInput tags={tags} onChange={setTags} max={10} />
        </div>

        {/* Assigned Agents */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground block">
            {type === "Personal" ? "Assigned Agent" : "Assigned Agents *"}
          </label>
          
          {type === "Personal" ? (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border border-primary/20 animate-in fade-in slide-in-from-top-1">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                <Users className="w-4 h-4" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-foreground">
                  {currentUserProfile ? getAgentDisplayName(currentUserProfile) : "You"}
                </span>
                <span className="text-[10px] text-primary font-bold uppercase tracking-wider">This campaign will be assigned to you</span>
              </div>
            </div>
          ) : (
            <div className="relative">
              <button
                type="button"
                onClick={() => setAgentDropdownOpen(!agentDropdownOpen)}
                className={`w-full h-9 px-3 rounded-lg bg-muted text-sm text-left border focus:ring-2 focus:ring-primary/50 focus:outline-none flex items-center justify-between ${errors.agents ? "border-destructive" : "border-border"}`}
              >
                <span className={selectedAgents.length ? "text-foreground font-medium" : "text-muted-foreground"}>
                  {selectedAgents.length === 0
                    ? "Select agent(s)..."
                    : agents.filter(a => selectedAgents.includes(a.id)).map(a => getAgentDisplayName(a)).join(", ")}
                </span>
                <Users className="w-4 h-4 text-muted-foreground" />
              </button>
              {agentDropdownOpen && (
                <div className="absolute z-[60] mt-1 w-full bg-card border rounded-lg shadow-xl max-h-48 overflow-y-auto animate-in fade-in zoom-in-95">
                  {agentsLoading ? (
                    <div className="flex items-center justify-center gap-2 px-3 py-4">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Loading agents...</span>
                    </div>
                  ) : agents.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-muted-foreground">No agents available — add agents in User Management first</p>
                  ) : (
                    agents.map(a => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => toggleAgent(a.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
                      >
                        <div className={`w-4 h-4 rounded border flex items-center justify-center ${selectedAgents.includes(a.id) ? "bg-primary border-primary" : "border-border"}`}>
                          {selectedAgents.includes(a.id) && <span className="text-primary-foreground text-[10px]">✓</span>}
                        </div>
                        <span className={`text-foreground ${selectedAgents.includes(a.id) ? "font-medium" : ""}`}>{getAgentDisplayName(a)}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
              {errors.agents && <p className="text-xs text-destructive mt-1">{errors.agents}</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 pt-2">
          <button 
            type="button" 
            onClick={onClose} 
            className="flex-1 h-10 rounded-xl bg-muted text-foreground text-sm font-semibold hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button 
            type="submit" 
            disabled={saving} 
            className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-primary/20"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Campaign
          </button>
        </div>
      </form>
    </div>
  );
};
