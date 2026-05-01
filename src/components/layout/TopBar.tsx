import React, { useState, useMemo, useEffect } from "react";
import { AvatarSkeleton, NameSkeleton } from "@/components/ui/ProfileSkeleton";
import { useLocation, useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import {
  Plus, Bell, Sun, Moon, Menu,
  User, Keyboard, LogOut, X, Phone, PhoneCall, IdCard,
  Trophy, PhoneMissed, UserPlus, Clock, Cake, Settings,
  Eye,
} from "lucide-react";
import GlobalSearch from "@/components/search/GlobalSearch";
import { useSidebarContext } from "@/contexts/SidebarContext";
import ViewAsModal from "@/components/layout/ViewAsModal";
import HeaderDateCalendar from "@/components/layout/HeaderDateCalendar";
import { useAuth } from "@/contexts/AuthContext";
import { useAgentStatus } from "@/contexts/AgentStatusContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useOrganization } from "@/hooks/useOrganization";
import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
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
  "/agent-profile": "Agent Profile",
};

const statusOptions = [
  { label: "Available", color: "bg-success", dotClass: "bg-success" },
  { label: "On Break", color: "bg-warning", dotClass: "bg-warning" },
  { label: "Do Not Disturb", color: "bg-destructive", dotClass: "bg-destructive" },
  { label: "Offline", color: "bg-muted-foreground/50", dotClass: "bg-muted-foreground/50" },
];

const NOTIF_TABS = ["All", "Calls", "Leads", "System"] as const;
type NotifTab = typeof NOTIF_TABS[number];

const TAB_TYPE_MAP: Record<NotifTab, string[] | null> = {
  All: null,
  Calls: ["missed_call", "win"],
  Leads: ["lead_claimed"],
  System: ["system", "appointment_reminder", "anniversary"],
};

function getNotifIcon(type: string) {
  switch (type) {
    case "win": return <Trophy className="w-4 h-4 text-yellow-500" />;
    case "missed_call": return <PhoneMissed className="w-4 h-4 text-red-400" />;
    case "lead_claimed": return <UserPlus className="w-4 h-4 text-blue-400" />;
    case "appointment_reminder": return <Clock className="w-4 h-4 text-orange-400" />;
    case "anniversary": return <Cake className="w-4 h-4 text-pink-400" />;
    case "system": return <Settings className="w-4 h-4 text-gray-400" />;
    default: return <Bell className="w-4 h-4 text-gray-400" />;
  }
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days > 1 ? "s" : ""} ago`;
  return new Date(dateStr).toLocaleDateString();
}

const TopBar: React.FC = () => {
  const { collapsed, setMobileOpen } = useSidebarContext();
  const { user, profile, logout, isLoading, isImpersonating, impersonatedUser } = useAuth();
  const [viewAsOpen, setViewAsOpen] = useState(false);
  const [dialerOnCall, setDialerOnCall] = useState(false);

  // Listen for live-call state changes from FloatingDialer
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setDialerOnCall(detail?.onCall ?? false);
    };
    window.addEventListener('dialer-call-state-change', handler);
    return () => window.removeEventListener('dialer-call-state-change', handler);
  }, []);

  // Detect if current user is super admin using the hook
  const { isSuperAdmin } = useOrganization();
  const { dialerOverride } = useAgentStatus();
  const { markRead, markAllRead, deleteNotification } = useNotifications();
  const [notifications, setNotifications] = useState<any[]>([]);

  useEffect(() => {
    const fetchNotifications = async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, type, title, body, created_at, read, action_label, action_url')
        .order('created_at', { ascending: false })
        .limit(20);
      if (!error && data) setNotifications(data);
    };
    fetchNotifications();
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const location = useLocation();
  const [statusIdx, setStatusIdx] = useState(0);
  const [statusDropdown, setStatusDropdown] = useState(false);
  const [userDropdown, setUserDropdown] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<NotifTab>("All");

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

  // Filter notifications based on active tab
  const filteredNotifications = useMemo(() => {
    const types = TAB_TYPE_MAP[activeTab];
    if (!types) return notifications;
    return notifications.filter((n) => types.includes(n.type));
  }, [notifications, activeTab]);

  // Tab unread counts
  const tabUnreadCounts = useMemo(() => {
    const counts: Record<NotifTab, number> = { All: 0, Calls: 0, Leads: 0, System: 0 };
    notifications.forEach((n) => {
      if (!n.read) {
        counts.All++;
        if (["missed_call", "win"].includes(n.type)) counts.Calls++;
        if (n.type === "lead_claimed") counts.Leads++;
        if (["system", "appointment_reminder", "anniversary"].includes(n.type)) counts.System++;
      }
    });
    return counts;
  }, [notifications]);

  const handleNotifClick = async (n: any) => {
    if (!n.read) {
      await markRead(n.id);
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
    }
    if (n.action_url) {
      navigate(n.action_url);
      setNotifOpen(false);
    }
  };

  return (
    <>
      <header
        className={`fixed top-0 right-0 h-16 bg-background/95 backdrop-blur-sm border-b z-50 sidebar-transition flex items-center px-4 gap-4 ${collapsed ? "md:left-16" : "md:left-60"
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
        <GlobalSearch />

        {/* Right Actions */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Dialer Trigger */}
          <div className="relative">
            <button
              onClick={() => window.dispatchEvent(new Event("toggle-floating-dialer"))}
              className={`h-8 px-3 rounded-full text-white flex items-center gap-1.5 text-sm font-medium sidebar-transition ${
                dialerOnCall ? "bg-red-500 hover:bg-red-600" : "bg-green-500 hover:bg-green-600"
              }`}
            >
              {dialerOnCall ? (
                <PhoneCall className="w-3.5 h-3.5 animate-pulse" />
              ) : (
                <Phone className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">{dialerOnCall ? "On Call" : "Dialer"}</span>
            </button>
            {dialerOnCall && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-400 animate-ping" />
            )}
          </div>

          {/* Quick Add */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 sidebar-transition">
                <Plus className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Add New Contact</TooltipContent>
          </Tooltip>

          <HeaderDateCalendar />

          {/* Notifications */}
          <div className="relative">
            <button onClick={() => setNotifOpen(!notifOpen)} className="w-8 h-8 rounded-lg text-foreground hover:bg-accent flex items-center justify-center relative sidebar-transition">
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 bg-destructive text-destructive-foreground text-[10px] rounded-full flex items-center justify-center font-bold">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
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
            {isLoading || !profile ? (
              <AvatarSkeleton size="sm" />
            ) : (
            <button
              type="button"
              onClick={() => setUserDropdown(!userDropdown)}
              className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-primary/20 text-primary ring-offset-background hover:ring-2 hover:ring-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sidebar-transition"
              aria-expanded={userDropdown}
              aria-haspopup="menu"
            >
              {profile.avatar_url?.trim() ? (
                <img
                  src={profile.avatar_url}
                  alt={`${profile.first_name || ""} ${profile.last_name || ""}`.trim() || "Profile"}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-xs font-bold">
                  {`${(profile.first_name || "?")[0]}${(profile.last_name || "?")[0]}`}
                </span>
              )}
            </button>
            )}
            {userDropdown && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-card border rounded-lg shadow-lg py-1 z-50">
                <div className="flex items-center gap-3 border-b px-3 py-2.5">
                  {isLoading || !profile ? (
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
                      <NameSkeleton />
                      <NameSkeleton className="w-28 h-3" />
                    </div>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {profile.first_name} {profile.last_name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                      </div>
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-border/60 bg-muted ring-2 ring-primary/15">
                        {profile.avatar_url?.trim() ? (
                          <img
                            src={profile.avatar_url}
                            alt={`${profile.first_name || ""} ${profile.last_name || ""}`.trim() || "Profile"}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-[11px] font-bold text-primary">
                            {`${(profile.first_name || "?")[0]}${(profile.last_name || "?")[0]}`}
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
                <button onClick={() => { navigate("/settings?section=my-profile"); setUserDropdown(false); }} className="w-full px-3 py-2 flex items-center gap-3 hover:bg-accent text-sm text-left text-foreground"><User className="w-4 h-4" />Profile Settings</button>
                <button onClick={() => { navigate("/agent-profile"); setUserDropdown(false); }} className="w-full px-3 py-2 flex items-center gap-3 hover:bg-accent text-sm text-left text-foreground"><IdCard className="w-4 h-4" />Agent Profile</button>
                <button className="w-full px-3 py-2 flex items-center gap-3 hover:bg-accent text-sm text-left text-foreground"><Keyboard className="w-4 h-4" />Keyboard Shortcuts</button>
                {isSuperAdmin && (
                  <>
                    <div className="h-px bg-border mx-2 my-1" />
                    <button
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors text-left"
                      style={{ color: "#D97706" }}
                      onMouseOver={e => (e.currentTarget.style.backgroundColor = "rgba(217,119,6,0.1)")}
                      onMouseOut={e => (e.currentTarget.style.backgroundColor = "transparent")}
                      onClick={() => { setUserDropdown(false); setViewAsOpen(true); }}
                    >
                      <Eye className="w-4 h-4" />
                      {isImpersonating ? `Viewing as ${impersonatedUser?.first_name}…` : "View As"}
                    </button>
                  </>
                )}
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
              <div className="flex items-center gap-3">
                {unreadCount > 0 && (
                  <button
                    onClick={async () => { await markAllRead(); setNotifications(prev => prev.map(x => ({ ...x, read: true }))); }}
                    className="text-xs text-primary hover:underline"
                  >
                    Mark All Read
                  </button>
                )}
                <button onClick={() => setNotifOpen(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex border-b">
              {NOTIF_TABS.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-2.5 text-sm font-medium sidebar-transition relative ${activeTab === tab
                    ? "text-foreground border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    }`}
                >
                  {tab}
                  {tabUnreadCounts[tab] > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-destructive text-destructive-foreground">
                      {tabUnreadCounts[tab]}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredNotifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                  <Bell className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-sm">No notifications</p>
                </div>
              ) : (
                filteredNotifications.map((n) => (
                  <div
                    key={n.id}
                    className={`w-full flex items-start gap-3 px-4 py-3 border-b hover:bg-accent/50 sidebar-transition text-left ${!n.read ? "bg-primary/5" : ""
                      }`}
                  >
                    <button onClick={() => handleNotifClick(n)} className="flex items-start gap-3 flex-1 min-w-0 text-left">
                      <div className="mt-0.5 shrink-0">
                        {getNotifIcon(n.type)}
                      </div>
                      {!n.read && <div className="w-2 h-2 rounded-full bg-primary mt-2 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{n.title}</p>
                        <p className="text-sm text-muted-foreground line-clamp-2">{n.body}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">{timeAgo(n.created_at)}</span>
                          {n.action_label && n.action_url && (
                            <span className="text-xs text-primary font-medium">{n.action_label}</span>
                          )}
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={async () => { await deleteNotification(n.id); setNotifications(prev => prev.filter(x => x.id !== n.id)); }}
                      className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                      aria-label="Delete notification"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
      {isSuperAdmin && (
        <ViewAsModal
          open={viewAsOpen}
          onClose={() => setViewAsOpen(false)}
          currentUserId={user?.id || ""}
        />
      )}
    </>
  );
};

export default TopBar;
