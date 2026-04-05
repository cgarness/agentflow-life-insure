import React from "react";
import { NavLink } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LucideIcon } from "lucide-react";

interface NavItemProps {
  icon: LucideIcon;
  label: string;
  path: string;
  collapsed: boolean;
  isActive: boolean;
  onClick?: () => void;
  badgeCount?: number;
  variant?: "default" | "warning";
}

export const MainNavItem: React.FC<NavItemProps> = ({ 
  icon: Icon, label, path, collapsed, isActive, onClick, badgeCount, variant = "default" 
}) => {
  const linkContent = (
    <NavLink
      to={path}
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium sidebar-transition group relative
        ${isActive
          ? variant === "warning" ? "bg-amber-600 text-white shadow-md" : "bg-primary text-primary-foreground shadow-md"
          : variant === "warning" ? "text-amber-500 hover:bg-amber-600/10 hover:text-amber-400" : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-100"
        }
        ${collapsed ? "justify-center" : ""}
      `}
    >
      <div className="relative shrink-0">
        <Icon className="w-5 h-5" />
        {badgeCount !== undefined && badgeCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white bg-blue-500">
            {badgeCount}
          </span>
        )}
      </div>
      {!collapsed && <span className="whitespace-nowrap">{label}</span>}
    </NavLink>
  );

  if (collapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
        <TooltipContent side="right" className="font-medium">{label}</TooltipContent>
      </Tooltip>
    );
  }
  return linkContent;
};

export const SettingsNavItem: React.FC<{
  icon: LucideIcon;
  label: string;
  isActive: boolean;
  collapsed: boolean;
  onClick: () => void;
}> = ({ icon: Icon, label, isActive, collapsed, onClick }) => {
  const buttonContent = (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm sidebar-transition text-left
        ${isActive ? "bg-primary text-primary-foreground font-medium" : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-100"}
        ${collapsed ? "justify-center" : ""}
      `}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );

  if (collapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{buttonContent}</TooltipTrigger>
        <TooltipContent side="right" className="font-medium">{label}</TooltipContent>
      </Tooltip>
    );
  }
  return buttonContent;
};
