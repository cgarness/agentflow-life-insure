import React from "react";
import { Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";

const AccessDenied: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center space-y-4">
        <Lock className="w-16 h-16 mx-auto text-muted-foreground" />
        <h1 className="text-2xl font-bold text-foreground">Access Denied</h1>
        <p className="text-sm max-w-sm mx-auto text-muted-foreground">
          You don't have permission to view this page. Contact your admin if you think this is a mistake.
        </p>
        <button
          onClick={() => navigate("/dashboard")}
          className="px-6 py-2.5 rounded-lg text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 transition-colors"
        >
          Back to Dashboard
        </button>
      </div>
    </div>
  );
};

export default AccessDenied;
