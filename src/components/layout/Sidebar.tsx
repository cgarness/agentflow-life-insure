import React from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, ArrowLeft, ShieldAlert,
  LayoutDashboard, Phone, Users, MessageSquare, Calendar,
  Megaphone, Trophy, BarChart3, Bot, GraduationCap, Settings, X
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useSidebarContext } from "@/contexts/SidebarContext";
import { useBranding } from "@/contexts/BrandingContext";
import { useOrganization } from "@/hooks/useOrganization";
import { SETTINGS_CONFIG, isPhoneSystemSettingsSection } from "@/config/settingsConfig";
import { MainNavItem, SettingsNavItem, CustomMenuSidebarItem } from "./NavItems";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useCustomMenuLinks } from "@/hooks/useCustomMenuLinks";

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
] as const;

const CORE_MAIN_MENU = MAIN_MENU.slice(0, -1);
const SETTINGS_MENU_ITEM = MAIN_MENU[MAIN_MENU.length - 1];

const Sidebar: React.FC = () => {
  const { collapsed, toggle, mobileOpen, setMobileOpen } = useSidebarContext();
  const { branding } = useBranding();
  const { isSuperAdmin } = useOrganization();
  const { data: customMenuLinks = [] } = useCustomMenuLinks();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isSettings = location.pathname.startsWith("/settings");
  const settingsSection = searchParams.get("section");

  const sidebarContent = (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100 border-r border-slate-800 transition-colors duration-200">
      <div className="flex items-center h-16 px-4 border-b border-slate-800 shrink-0">
        <div className={`flex items-center gap-3 ${collapsed ? "mx-auto" : ""}`}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-primary">
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
                {cat.sections
                  .filter((s) => s.slug !== "master-admin" || isSuperAdmin)
                  .map((s) => (
                  <SettingsNavItem
                    key={s.slug}
                    icon={s.icon}
                    label={s.label}
                    collapsed={collapsed}
                    isActive={
                      settingsSection === s.slug ||
                      (!settingsSection && s.slug === "my-profile") ||
                      (s.slug === "phone-system" && isPhoneSystemSettingsSection(settingsSection))
                    }
                    onClick={() => {
                      setSearchParams({ section: s.slug });
                      setMobileOpen(false);
                    }}
                  />
                ))}
          </div>
        ))}
      </>
    ) : (
      <>
        {CORE_MAIN_MENU.map((item) => (
          <MainNavItem
            key={item.path}
            icon={item.icon}
            label={item.label}
            path={item.path}
            collapsed={collapsed}
            isActive={location.pathname === item.path || (item.path !== "/" && location.pathname.startsWith(item.path))}
            onClick={() => setMobileOpen(false)}
          />
        ))}
        {customMenuLinks.map((link) => (
          <CustomMenuSidebarItem
            key={link.id}
            label={link.label}
            collapsed={collapsed}
            isActive={location.pathname === `/app-link/${link.id}`}
            openMode={link.open_mode}
            url={link.url}
            linkId={link.id}
            onClick={() => setMobileOpen(false)}
          />
        ))}
        <MainNavItem
          icon={SETTINGS_MENU_ITEM.icon}
          label={SETTINGS_MENU_ITEM.label}
          path={SETTINGS_MENU_ITEM.path}
          collapsed={collapsed}
          isActive={location.pathname === SETTINGS_MENU_ITEM.path || location.pathname.startsWith(`${SETTINGS_MENU_ITEM.path}/`)}
          onClick={() => setMobileOpen(false)}
        />
        {isSuperAdmin && <MainNavItem icon={ShieldAlert} label="Super Admin" path="/super-admin" collapsed={collapsed} isActive={location.pathname === "/super-admin"} variant="warning" onClick={() => setMobileOpen(false)} />}
      </>
    )}
  </nav>

  <div className="border-t border-slate-800 p-3 shrink-0">
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
