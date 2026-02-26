import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, Phone, Users, MessageSquare, Calendar,
  Megaphone, Trophy, BarChart3, Bot, GraduationCap, Settings,
  ChevronLeft, ChevronRight, Sun, Moon, ExternalLink, Menu, X,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSidebarContext } from "@/contexts/SidebarContext";
import { useAuth } from "@/contexts/AuthContext";

const menuItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: Phone, label: "Dialer", path: "/dialer" },
  { icon: Users, label: "Contacts", path: "/contacts" },
  { icon: MessageSquare, label: "Conversations", path: "/conversations" },
  { icon: Calendar, label: "Calendar", path: "/calendar" },
  { icon: Megaphone, label: "Campaigns", path: "/campaigns" },
  { icon: Trophy, label: "Leaderboard", path: "/leaderboard" },
  { icon: BarChart3, label: "Reports", path: "/reports" },
  { icon: Bot, label: "AI Agents", path: "/ai-agents" },
  { icon: GraduationCap, label: "Training", path: "/training" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

const customLinks = [
  { label: "Carrier Portal", path: "https://example.com", icon: ExternalLink },
  { label: "CRM Wiki", path: "https://example.com", icon: ExternalLink },
];

const Sidebar: React.FC = () => {
  const { collapsed, toggle, mobileOpen, setMobileOpen } = useSidebarContext();
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const location = useLocation();

  const sidebarContent = (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      {/* Logo */}
      <div className="flex items-center h-16 px-4 border-b border-sidebar-border shrink-0">
        {collapsed ? (
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center mx-auto">
            <span className="text-primary-foreground font-bold text-sm">AF</span>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <span className="text-primary-foreground font-bold text-sm">AF</span>
            </div>
            <span className="font-bold text-base text-sidebar-accent-foreground whitespace-nowrap">AgentFlow</span>
          </div>
        )}
      </div>

      {/* Nav Items */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {menuItems.map((item) => {
          const isActive = location.pathname === item.path || (item.path !== "/" && location.pathname.startsWith(item.path));
          const linkContent = (
            <NavLink
              to={item.path}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium sidebar-transition group
                ${isActive
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }
                ${collapsed ? "justify-center" : ""}
              `}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
            </NavLink>
          );

          if (collapsed) {
            return (
              <Tooltip key={item.path} delayDuration={0}>
                <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                <TooltipContent side="right" className="font-medium">
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          }
          return <React.Fragment key={item.path}>{linkContent}</React.Fragment>;
        })}

        {/* Custom Links Divider */}
        {!collapsed && (
          <div className="pt-4 pb-2 px-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">Custom Links</span>
          </div>
        )}
        {collapsed && <div className="border-t border-sidebar-border my-3" />}
        {customLinks.map((link) => {
          const linkEl = (
            <a
              href={link.path}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground sidebar-transition ${collapsed ? "justify-center" : ""}`}
            >
              <link.icon className="w-4 h-4 shrink-0" />
              {!collapsed && <span className="whitespace-nowrap">{link.label}</span>}
            </a>
          );
          if (collapsed) {
            return (
              <Tooltip key={link.label} delayDuration={0}>
                <TooltipTrigger asChild>{linkEl}</TooltipTrigger>
                <TooltipContent side="right">{link.label}</TooltipContent>
              </Tooltip>
            );
          }
          return <React.Fragment key={link.label}>{linkEl}</React.Fragment>;
        })}
      </nav>

      {/* Bottom Section */}
      <div className="border-t border-sidebar-border p-3 space-y-3 shrink-0">
        {/* Theme Toggle */}
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent sidebar-transition ${collapsed ? "justify-center" : ""}`}
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {!collapsed && <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>}
        </button>

        {/* User Info */}
        {!collapsed && (
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold">{user ? `${user.firstName[0]}${user.lastName[0]}` : "??"}</div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-sidebar-accent-foreground truncate">{user ? `${user.firstName} ${user.lastName}` : "Guest"}</p>
              <p className="text-xs text-sidebar-muted truncate">{user?.role || ""}</p>
            </div>
          </div>
        )}

        {/* Collapse Toggle */}
        <button
          onClick={toggle}
          className="flex items-center justify-center w-full py-2 rounded-lg text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground sidebar-transition"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={`hidden md:flex fixed left-0 top-0 h-screen z-50 sidebar-transition ${collapsed ? "w-16" : "w-60"}`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-foreground/50 z-50 md:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ x: -240 }}
              animate={{ x: 0 }}
              exit={{ x: -240 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed left-0 top-0 h-screen w-60 z-50 md:hidden"
            >
              <button
                onClick={() => setMobileOpen(false)}
                className="absolute top-4 right-4 text-sidebar-foreground z-10"
              >
                <X className="w-5 h-5" />
              </button>
              {sidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default Sidebar;
