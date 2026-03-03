import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import {
  Search, Plus, Bell, Sun, Moon, ChevronDown, Menu,
  User, Keyboard, LogOut, X, Megaphone,
} from "lucide-react";
import { useSidebarContext } from "@/contexts/SidebarContext";
import { useAuth } from "@/contexts/AuthContext";
import { useAgentStatus } from "@/contexts/AgentStatusContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/dialer": "Dialer",
  "/contacts": "Contacts",
  "/conversations": "Conversations",
  "/calendar": "Calendar",
  "/campaigns": "Campaigns",
  "/leaderboard": "Leaderboard",
  "/reports": "Reports",
  "/ai-agents": "AI Agents",
  "/training": "Training",
  "/settings": "Settings",
};

const statusOptions = [
  { label: "Available", color: "bg-success", dotClass: "bg-success" },
  { label: "On Break", color: "bg-warning", dotClass: "bg-warning" },
  { label: "Do Not Disturb", color: "bg-destructive", dotClass: "bg-destructive" },
  { label: "Offline", color: "bg-muted-foreground/50", dotClass: "bg-muted-foreground/50" },
];

const TopBar: React.FC = () => {
  const { collapsed, setMobileOpen } = useSidebarContext();
  const { user, profile, logout } = useAuth();
  const { dialerOverride } = useAgentStatus();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const location = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusIdx, setStatusIdx] = useState(0);
  const [statusDropdown, setStatusDropdown] = useState(false);
  const [userDropdown, setUserDropdown] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const currentPage = pageTitles[location.pathname] || "Page";

  // Determine dot appearance based on dialer override
  let dotClass = statusOptions[statusIdx].dotClass;
  let dotTooltip = statusOptions[statusIdx].label;
  let dotPulse = false;

  if (dialerOverride === "on-call") {
    dotClass = "bg-teal-400";
    dotTooltip = "On a Call";
    dotPulse = true;
  } else if (dialerOverride === "in-session") {
    dotClass = "bg-teal-500";
    dotTooltip = "In a Dialing Session";
    dotPulse = false;
  }

  return (
    <>
      <header
        className={`fixed top-0 right-0 h-16 bg-background/95 backdrop-blur-sm border-b z-40 sidebar-transition flex items-center px-4 gap-4 ${
          collapsed ? "md:left-16" : "md:left-60"
        } left-0`}
      >
        {/* Mobile Menu Button */}
        <button onClick={() => setMobileOpen(true)} className="md:hidden text-foreground">
          <Menu className="w-5 h-5" />
        </button>

        {/* Breadcrumb */}
        <div className="hidden sm:flex items-center gap-2 text-sm shrink-0">
          <span className="text-muted-foreground">AgentFlow</span>
          <span className="text-muted-foreground">/</span>
          <span className="font-semibold text-foreground">{currentPage}</span>
        </div>

        {/* Search */}
        <div className="flex-1 max-w-lg mx-auto relative">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search contacts, campaigns, conversations..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(e.target.value.length > 0); }}
              onFocus={() => searchQuery.length > 0 && setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
              className="w-full h-9 pl-9 pr-8 rounded-lg bg-muted text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 sidebar-transition"
            />
            {searchQuery && (
              <button onClick={() => { setSearchQuery(""); setSearchOpen(false); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {searchOpen && (
            <div className="absolute top-full mt-2 w-full bg-card border rounded-lg shadow-lg py-2 z-50">
              <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase">Contacts</div>
              {["John Martinez", "Sarah Williams", "Mike Johnson"].map((n) => (
                <button key={n} className="w-full px-3 py-2 flex items-center gap-3 hover:bg-accent text-sm text-left">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">{n.split(" ").map(w => w[0]).join("")}</div>
                  <div><p className="font-medium text-foreground">{n}</p><p className="text-xs text-muted-foreground">Lead · Florida</p></div>
                </button>
              ))}
              <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase border-t mt-1 pt-2">Campaigns</div>
              <button className="w-full px-3 py-2 flex items-center gap-3 hover:bg-accent text-sm text-left">
                <Megaphone className="w-4 h-4 text-primary" />
                <span className="text-foreground">Q1 Facebook Leads</span>
              </button>
            </div>
          )}
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Quick Add */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 sidebar-transition">
                <Plus className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Add New Contact</TooltipContent>
          </Tooltip>

          {/* Notifications */}
          <div className="relative">
            <button onClick={() => setNotifOpen(!notifOpen)} className="w-8 h-8 rounded-lg text-foreground hover:bg-accent flex items-center justify-center relative sidebar-transition">
              <Bell className="w-4 h-4" />
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-destructive text-destructive-foreground text-[10px] rounded-full flex items-center justify-center font-bold">3</span>
            </button>
          </div>

          {/* Status */}
          <div className="relative hidden sm:block">
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={() => setStatusDropdown(!statusDropdown)} className="w-8 h-8 rounded-lg text-foreground hover:bg-accent flex items-center justify-center sidebar-transition">
                  <div className={`w-2.5 h-2.5 rounded-full ${dotClass} ${dotPulse ? "animate-pulse" : ""}`} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{dotTooltip}</TooltipContent>
            </Tooltip>
            {statusDropdown && (
              <div className="absolute right-0 top-full mt-2 w-44 bg-card border rounded-lg shadow-lg py-1 z-50">
                {statusOptions.map((s, i) => (
                  <button key={s.label} onClick={() => { setStatusIdx(i); setStatusDropdown(false); }} className="w-full px-3 py-2 flex items-center gap-3 hover:bg-accent text-sm text-left">
                    <div className={`w-2.5 h-2.5 rounded-full ${s.dotClass}`} />
                    <span className={`text-foreground ${i === statusIdx ? "font-semibold" : ""}`}>{s.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Theme Toggle */}
          <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="w-8 h-8 rounded-lg text-foreground hover:bg-accent flex items-center justify-center sidebar-transition hidden sm:flex">
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* User Avatar */}
          <div className="relative">
            <button onClick={() => setUserDropdown(!userDropdown)} className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold hover:ring-2 hover:ring-primary/30 sidebar-transition">
              {profile ? `${(profile.first_name || "?")[0]}${(profile.last_name || "?")[0]}` : "??"}
            </button>
            {userDropdown && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-card border rounded-lg shadow-lg py-1 z-50">
                <div className="px-3 py-2 border-b">
                  <p className="text-sm font-medium text-foreground">{profile?.first_name} {profile?.last_name}</p>
                  <p className="text-xs text-muted-foreground">{user?.email}</p>
                </div>
                <button onClick={() => { navigate("/settings?section=my-profile"); setUserDropdown(false); }} className="w-full px-3 py-2 flex items-center gap-3 hover:bg-accent text-sm text-left text-foreground"><User className="w-4 h-4" />Profile Settings</button>
                <button className="w-full px-3 py-2 flex items-center gap-3 hover:bg-accent text-sm text-left text-foreground"><Keyboard className="w-4 h-4" />Keyboard Shortcuts</button>
                <div className="border-t my-1" />
                <button onClick={() => { logout(); navigate("/login"); setUserDropdown(false); }} className="w-full px-3 py-2 flex items-center gap-3 hover:bg-accent text-sm text-left text-destructive"><LogOut className="w-4 h-4" />Logout</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Notification Panel */}
      {notifOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
          <div className={`fixed top-0 right-0 w-[380px] max-w-full h-screen bg-card border-l shadow-2xl z-50 flex flex-col`}>
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="font-semibold text-foreground">Notifications</h2>
              <button className="text-xs text-primary hover:underline">Mark All Read</button>
            </div>
            <div className="flex border-b">
              {["All", "Calls", "Leads", "System"].map((tab) => (
                <button key={tab} className="flex-1 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent sidebar-transition first:text-foreground first:border-b-2 first:border-primary">{tab}</button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto">
              {[
                { text: "🎉 Chris G. sold a Term Life policy to John M.!", time: "2 min ago", unread: true },
                { text: "Missed call from Sarah Williams (FL)", time: "15 min ago", unread: true, action: "Call Back" },
                { text: "New lead assigned: Mike Johnson from Facebook Ads", time: "1 hr ago", unread: true },
                { text: "Campaign 'Q1 Facebook Leads' reached 50% completion", time: "3 hrs ago", unread: false },
                { text: "Policy anniversary: Robert Chen's Term Life renews in 7 days", time: "5 hrs ago", unread: false },
              ].map((n, i) => (
                <div key={i} className={`flex items-start gap-3 px-4 py-3 border-b hover:bg-accent/50 sidebar-transition ${n.unread ? "bg-primary/5" : ""}`}>
                  {n.unread && <div className="w-2 h-2 rounded-full bg-primary mt-2 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">{n.text}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">{n.time}</span>
                      {n.action && <button className="text-xs text-primary font-medium hover:underline">{n.action}</button>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default TopBar;
