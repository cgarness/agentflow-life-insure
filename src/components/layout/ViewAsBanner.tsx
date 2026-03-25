import React from "react";
import { useViewAs } from "@/contexts/ViewAsContext";
import { Eye, X } from "lucide-react";

const ViewAsBanner: React.FC = () => {
  const { viewingAs, exitViewAs, isViewingAs } = useViewAs();

  if (!isViewingAs || !viewingAs) return null;

  const initials = `${viewingAs.firstName[0]}${viewingAs.lastName[0]}`;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between px-4 py-2 text-sm font-medium"
      style={{ backgroundColor: "#D97706", color: "#FFFFFF" }}
    >
      <div className="flex items-center gap-2">
        <Eye className="w-4 h-4" />
        <span>
          Viewing as <strong>{viewingAs.firstName} {viewingAs.lastName}</strong> · {viewingAs.role}
        </span>
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ml-1"
          style={{ backgroundColor: "rgba(255,255,255,0.25)", color: "#FFFFFF" }}
        >
          {viewingAs.avatar ? (
            <img src={viewingAs.avatar} alt="" className="w-full h-full rounded-full object-cover" />
          ) : initials}
        </div>
      </div>
      <button
        onClick={exitViewAs}
        className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors"
        style={{ backgroundColor: "rgba(255,255,255,0.2)", color: "#FFFFFF" }}
        onMouseOver={e => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.35)")}
        onMouseOut={e => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.2)")}
      >
        <X className="w-3.5 h-3.5" />
        Exit View As
      </button>
    </div>
  );
};

export default ViewAsBanner;
