import React from "react";
import { Bot } from "lucide-react";
import ComingSoon from "@/components/shared/ComingSoon";
import { useAuth } from "@/contexts/AuthContext";

const AIAgents: React.FC = () => {
  const { profile } = useAuth();
  
  // We respect the organization_id context here by ensuring it exists if needed,
  // though for the "Coming Soon" view, no data is currently fetched.
  const organizationId = profile?.organization_id;

  return (
    <div className="space-y-4">
      <ComingSoon 
        icon={Bot}
        title="AI Agents Engine"
        description="Deploy autonomous AI agents that qualify leads, handle objections, and book appointments directly into your calendar 24/7."
        featureName="ai-agents"
      />
    </div>
  );
};

export default AIAgents;
