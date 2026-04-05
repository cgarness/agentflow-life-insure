import React from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { 
  ChevronLeft, ChevronRight, Sun, Moon, ArrowLeft, ShieldAlert,
  LayoutDashboard, Phone, Users, MessageSquare, Calendar,
  Megaphone, Trophy, BarChart3, Bot, GraduationCap, Settings, X
} from "lucide-react";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";
import { useSidebarContext } from "@/contexts/SidebarContext";
import { useAuth } from "@/contexts/AuthContext";
import { useBranding } from "@/contexts/BrandingContext";
import { useOrganization } from "@/hooks/useOrganization";
import { SETTINGS_CONFIG } from "@/config/settingsConfig";
import { MainNavItem, SettingsNavItem } from "./NavItems";
import { TooltipProvider } from "@/components/ui/tooltip";

const MAIN_MENU = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
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

const Sidebar: React.FC = () => {
  const { collapsed, toggle, mobileOpen, setMobileOpen } = useSidebarContext();
  const { theme, setTheme } = useTheme();
  const { profile } = useAuth();
  const { branding } = useBranding();
  const { isSuperAdmin } = useOrganization();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isSettings = location.pathname.startsWith("/settings");

  const sidebarContent = (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100 border-r border-slate-800 transition-colors duration-200">
      <div className="flex items-center h-16 px-4 border-b border-slate-800 shrink-0">
        <div className={`flex items-center gap-3 ${collapsed ? "mx-auto" : ""}`}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: branding.primaryColor || '#3B82F6' }}>
            {branding.logoUrl ? <img src={branding.logoUrl} className="w-full h-full object-cover rounded-lg" alt="L" /> : <span className="text-white font-bold text-sm">AF</span>}
          </div>
          {!collapsed && <span className="font-bold text-base text-sidebar-accent-foreground">{branding.companyName || "AgentFlow"}</span>}
        </div>
      </div>

      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto no-scrollbar">
        {isSettings ? (
          <>
            <MainNavItem icon={ArrowLeft} label="Back to App" path="/dashboard" collapsed={collapsed} isActive={false} onClick={() => setMobileOpen(false)} />
            <div className="my-4 border-t border-sidebar-border opacity-50" />
            {SETTINGS_CONFIG.map(cat => (
              <div key={cat.label} className="mb-4">
                {!collapsed && <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-sidebar-muted">{cat.label}</p>}
                {cat.sections.map(s => (
              <SettingsNavItem key={s.slug} icon={s.icon} label={s.label} collapsed={collapsed} isActive={searchParams.get("section") === s.slug || (!searchParams.get("section") && s.slug === "my-profile")} 
                onClick={() => { setSearchParams({ section: s.slug }); setMobileOpen(false); }} />
            ))}
          </div>
        ))}
      </>
    ) : (
      <>
        {MAIN_MENU.map(item => <MainNavItem key={item.path} icon={item.icon} label={item.label} path={item.path} collapsed={collapsed} 
          isActive={location.pathname === item.path || (item.path !== "/" && location.pathname.startsWith(item.path))} onClick={() => setMobileOpen(false)} />)}
        {isSuperAdmin && <MainNavItem icon={ShieldAlert} label="Super Admin" path="/super-admin" collapsed={collapsed} isActive={location.pathname === "/super-admin"} variant="warning" onClick={() => setMobileOpen(false)} />}
      </>
    )}
  </nav>

  <div className="border-t border-slate-800 p-3 space-y-3 shrink-0">
    <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm hover:bg-slate-800 sidebar-transition ${collapsed ? "justify-center" : ""}`}>
      {theme === "dark" ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-slate-400" />}
      {!collapsed && <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>}
    </button>
    {!collapsed && (
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold">
          {profile ? `${(profile.first_name || "?")[0]}${(profile.last_name || "?")[0]}` : "??"}
        </div>
        <div className="min-w-0 font-medium truncate text-slate-100">
          {profile ? `${profile.first_name} ${profile.last_name}` : "Guest"}
        </div>
      </div>
    )}
    <button onClick={toggle} className="flex items-center justify-center w-full py-2 text-slate-500 hover:text-slate-100 transition-colors">
      {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
    </button>
  </div>
</div>
  );

  return (
    <TooltipProvider>
      <aside className={`hidden md:flex fixed left-0 top-0 h-screen z-50 sidebar-transition ${collapsed ? "w-16" : "w-64"}`}>{sidebarContent}</aside>
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-foreground/50 z-50 md:hidden" onClick={() => setMobileOpen(false)} />
            <motion.aside initial={{ x: -256 }} animate={{ x: 0 }} exit={{ x: -256 }} transition={{ type: "spring", damping: 25, stiffness: 200 }} className="fixed left-0 top-0 h-screen w-64 z-50 md:hidden">
              <button onClick={() => setMobileOpen(false)} className="absolute top-4 right-4 text-sidebar-foreground z-10"><X className="w-5 h-5" /></button>
              {sidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </TooltipProvider>
  );
};

export default Sidebar;
