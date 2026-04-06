import React from "react";
import { MessageSquare } from "lucide-react";
import ComingSoon from "@/components/shared/ComingSoon";
import { useAuth } from "@/contexts/AuthContext";

const Conversations: React.FC = () => {
  const { profile } = useAuth();
  
  // We respect the organization_id context here by ensuring it exists if needed,
  // though for the "Coming Soon" view, no data is currently fetched.
  const organizationId = profile?.organization_id;

  return (
    <div className="space-y-4">
      <ComingSoon 
        icon={MessageSquare}
        title="Conversations Unified"
        description="Connect with your leads through SMS, Email, and WhatsApp in a single, unified inbox designed for high-velocity agency operations."
        featureName="conversations"
      />
    </div>
  );
};

export default Conversations;
