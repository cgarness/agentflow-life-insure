import React from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Eye, X, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

const ImpersonationBanner: React.FC = () => {
  const { impersonatedUser, isImpersonating, stopImpersonation } = useAuth();

  if (!isImpersonating || !impersonatedUser) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between px-6 py-2.5 shadow-lg animate-in fade-in slide-in-from-top duration-300"
      style={{ 
        backgroundColor: "#F59E0B", // Amber 500
        color: "#FFFFFF",
        borderBottom: "1px solid rgba(0,0,0,0.1)"
      }}
    >
      <div className="flex items-center gap-3">
        <div className="bg-white/20 p-1.5 rounded-full">
          <Eye className="w-4 h-4 text-white" />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
          <span className="text-sm font-bold tracking-tight">
            Impersonation Mode Active
          </span>
          <span className="hidden sm:inline opacity-40">|</span>
          <span className="text-sm font-medium opacity-95">
            Viewing as <span className="font-bold underline decoration-white/30 underline-offset-2">{impersonatedUser.first_name} {impersonatedUser.last_name}</span>
            <span className="ml-2 px-2 py-0.5 bg-black/10 rounded-full text-[10px] uppercase tracking-wider font-black">
              {impersonatedUser.role}
            </span>
          </span>
        </div>
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={stopImpersonation}
        className="h-8 gap-2 bg-white/10 hover:bg-white/20 text-white border-white/20 hover:border-white/40 font-bold text-xs uppercase tracking-widest transition-all"
      >
        <X className="w-3.5 h-3.5" />
        Exit View As
      </Button>
    </div>
  );
};

export default ImpersonationBanner;
