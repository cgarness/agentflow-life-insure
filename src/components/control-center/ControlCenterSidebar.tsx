import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  ListChecks,
  AlertOctagon,
  Activity,
  ArrowLeft,
  LogOut,
  Terminal,
  ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

const NAV = [
  { label: "Overview", icon: LayoutDashboard, to: "/control-center" },
  { label: "Features", icon: ListChecks, to: "/control-center/features" },
  { label: "Issues", icon: AlertOctagon, to: "/control-center/issues" },
  { label: "Health", icon: Activity, to: "/control-center/health" },
  { label: "Runtime", icon: Terminal, to: "/control-center/runtime" },
  { label: "Tracker", icon: ClipboardList, to: "/control-center/tracker" },
] as const;

const ControlCenterSidebar: React.FC = () => {
  const navigate = useNavigate();
  const { logout, realProfile } = useAuth();

  return (
    <aside className="hidden md:flex fixed left-0 top-0 h-screen w-60 z-40 flex-col bg-slate-950 border-r border-slate-800 text-slate-200">
      <div className="h-16 px-4 flex items-center gap-2 border-b border-slate-800">
        <div className="h-8 w-8 rounded-md bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold shadow-inner">
          CC
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-wide text-slate-100">
            Control Center
          </span>
          <span className="text-[10px] uppercase tracking-widest text-slate-500">
            Platform admin
          </span>
        </div>
      </div>

      <nav className="flex-1 py-3 px-2 space-y-0.5">
        {NAV.map(({ label, icon: Icon, to }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/control-center"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                isActive
                  ? "bg-slate-800/80 text-slate-50"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-100",
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-slate-800 p-3 space-y-2">
        {realProfile && (
          <div className="px-2 text-xs text-slate-500 leading-tight">
            <div className="text-slate-300 truncate">
              {realProfile.first_name} {realProfile.last_name}
            </div>
            <div className="truncate">{realProfile.email}</div>
          </div>
        )}
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-xs text-slate-400 hover:bg-slate-900 hover:text-slate-100 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to CRM
        </button>
        <button
          type="button"
          onClick={() => {
            void logout();
          }}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-xs text-slate-400 hover:bg-slate-900 hover:text-slate-100 transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </button>
      </div>
    </aside>
  );
};

export default ControlCenterSidebar;
