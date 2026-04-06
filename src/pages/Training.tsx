import React from "react";
import { Play } from "lucide-react";
import ComingSoon from "@/components/shared/ComingSoon";
import { useAuth } from "@/contexts/AuthContext";

const Training: React.FC = () => {
  const { profile } = useAuth();
  
  // We respect the organization_id context here by ensuring it exists if needed,
  // though for the "Coming Soon" view, no data is currently fetched.
  const organizationId = profile?.organization_id;

  return (
    <div className="space-y-4">
      <ComingSoon 
        icon={Play}
        title="Agency Training Center"
        description="Scale your agency with a centralized training hub. Upload scripts, product guides, and onboarding videos to ensure your team is always closing."
        featureName="training"
      />
    </div>
  );
};

export default Training;
