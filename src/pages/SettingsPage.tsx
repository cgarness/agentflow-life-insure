import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import UserManagement from "@/components/settings/UserManagement";
import DispositionsManager from "@/components/settings/DispositionsManager";
import ContactManagement from "@/components/settings/ContactManagement";
import Permissions from "@/components/settings/Permissions";
import CompanyBranding from "@/components/settings/CompanyBranding";
import CallScripts from "@/components/settings/CallScripts";
import CalendarSettings from "@/components/settings/CalendarSettings";
import MyProfile from "@/components/settings/MyProfile";
import PhoneSettings from "@/components/settings/PhoneSettings";
import DNCSettings from "@/components/settings/DNCSettings";
import EmailSMSTemplates from "@/components/settings/EmailSMSTemplates";
import Carriers from "@/components/settings/Carriers";
import GoalSetting from "@/components/settings/GoalSetting";
import CustomMenuLinks from "@/components/settings/CustomMenuLinks";
import ActivityLog from "@/components/settings/ActivityLog";
import SpamMonitoring from "@/components/settings/SpamMonitoring";
import MasterAdmin from "@/components/settings/MasterAdmin";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import {
  Building2, Users, Phone, FileText, List, Zap, Mail, Shield, Voicemail,
  Mic, Headphones, Target, PhoneIncoming, Settings, Bot, Ban, Webhook,
  Link, Clock, Upload, Plus, Search, GripVertical, Play, Pause, SlidersHorizontal,
  Lock, CalendarDays, UserCircle, Radar, Database
} from "lucide-react";

const sections = [
  { icon: UserCircle, label: "My Profile" },
  { icon: Building2, label: "Company Branding" },
  { icon: Users, label: "User Management" },
  { icon: Phone, label: "Telnyx & Phone Numbers" },
  { icon: FileText, label: "Call Scripts" },
  { icon: List, label: "Dispositions Manager" },
  { icon: SlidersHorizontal, label: "Contact Management" },
  { icon: CalendarDays, label: "Calendar Settings" },
  { icon: Lock, label: "Permissions" },
  { icon: Zap, label: "Automation Builder" },
  { icon: Mail, label: "Email & SMS Templates" },
  { icon: Shield, label: "Carriers" },
  { icon: Voicemail, label: "Voicemail Drop Manager" },
  { icon: Mic, label: "Call Recording Library" },
  { icon: Headphones, label: "Call Monitoring" },
  { icon: Target, label: "Goal Setting" },
  { icon: PhoneIncoming, label: "Inbound Call Routing" },
  { icon: Settings, label: "Predictive Dialer" },
  { icon: Bot, label: "AI Settings" },
  { icon: Ban, label: "DNC List Manager" },
  { icon: Webhook, label: "Zapier & Webhooks" },
  { icon: Link, label: "Custom Menu Links" },
  { icon: Clock, label: "Activity Log" },
  { icon: Radar, label: "Spam Monitoring" },
  { icon: Database, label: "Master Admin" },
];

const MASTER_ADMIN_EMAIL = "cgarness.ffl@gmail.com";
const MASTER_ADMIN_UID = "u1";
const MASTER_ADMIN_IDX = sections.length - 1;

const SettingsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [active, setActive] = useState(0);
  const { user, profile } = useAuth();
  
  const isMasterAdmin = 
    user?.email === MASTER_ADMIN_EMAIL || 
    profile?.email === MASTER_ADMIN_EMAIL || 
    user?.id === MASTER_ADMIN_UID;

  useEffect(() => {
    const section = searchParams.get("section");

    if (section === "my-profile") {
      setActive(0);
      setSearchParams({}, { replace: true });
      return;
    }

    if (section === "calendar-settings") {
      setActive(7);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const renderContent = () => {
    switch (active) {
      case 0: // My Profile
        return <MyProfile />;
      case 1: // Company Branding
        return <CompanyBranding />;

      case 2: // User Management
        return <UserManagement />;
      case 4: // Call Scripts
        return <CallScripts />;
      case 3: // Telnyx
        return <PhoneSettings />;

      case 5: // Dispositions
        return <DispositionsManager />;
      case 6: // Contact Management
        return <ContactManagement />;
      case 7: // Calendar Settings
        return <CalendarSettings />;
      case 8: // Permissions
        return <Permissions />;

      case 10: // Email & SMS Templates
        return <EmailSMSTemplates />;

      case 11: // Carriers
        return <Carriers />;

      case 15: // Goal Setting
        return <GoalSetting />;

      case 14: // Call Monitoring
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">Call Monitoring <span className="w-2.5 h-2.5 rounded-full bg-success animate-pulse" /></h3>
            <div className="space-y-3">
              {[
                { agent: "Sarah J.", contact: "John Martinez", duration: "3:24" },
                { agent: "Mike T.", contact: "Lisa Park", duration: "1:12" },
              ].map((c) => (
                <div key={c.agent} className="bg-card rounded-xl border p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{c.agent.split(" ").map(w => w[0]).join("")}</div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{c.agent} → {c.contact}</p>
                      <p className="text-xs text-muted-foreground font-mono">{c.duration}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {["Listen", "Whisper", "Barge"].map((a) => (
                      <button key={a} className="px-3 py-1.5 rounded-lg bg-accent text-foreground text-xs font-medium hover:bg-accent/80 sidebar-transition">{a}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case 18: // AI Settings
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">AI Settings</h3>
            <div className="space-y-4">
              {[["AI Provider", "Anthropic"], ["Model", "claude-sonnet-4-20250514"]].map(([k, v]) => (
                <div key={k}><label className="text-sm font-medium text-foreground block mb-1.5">{k}</label><input type="text" defaultValue={v} className="w-full h-9 px-3 rounded-lg bg-accent text-sm text-foreground border-0 focus:ring-2 focus:ring-primary/50" /></div>
              ))}
              <div className="grid grid-cols-2 gap-4">
                {[{ label: "API Calls This Month", value: "1,247" }, { label: "Estimated Cost", value: "$34.20" }].map((s) => (
                  <div key={s.label} className="bg-accent/50 rounded-lg p-4 text-center"><p className="text-xs text-muted-foreground">{s.label}</p><p className="text-xl font-bold text-foreground mt-1">{s.value}</p></div>
                ))}
              </div>
            </div>
          </div>
        );

      case 19: // DNC List
        return <DNCSettings />;

      case 21: // Custom Menu Links
        return <CustomMenuLinks />;

      case 22: // Activity Log
        return <ActivityLog />;

      case 23: // Spam Monitoring
        return <SpamMonitoring />;
      
      case 24: // Master Admin
        if (!isMasterAdmin) {
          toast({ title: "Access Denied", description: "This section is restricted to master administrators.", variant: "destructive" });
          setActive(0);
          return <MyProfile />;
        }
        return <MasterAdmin />;

      default: {
        const Icon = sections[active].icon;
        return (
          <div className="bg-accent/50 rounded-xl p-8 text-center">
            <Icon className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-semibold text-foreground mb-1">{sections[active].label}</h3>
            <p className="text-sm text-muted-foreground">This settings section is ready for configuration.</p>
          </div>
        );
      }
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-foreground">Settings</h1>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sub-nav */}
        <div className="lg:col-span-1">
          <nav className="bg-card rounded-xl border p-2 space-y-0.5 sticky top-20 max-h-[calc(100vh-100px)] overflow-y-auto no-scrollbar">
            {/* ACCOUNT section */}
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium px-3 py-2">Account</p>
            <button
              onClick={() => setActive(0)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm sidebar-transition text-left ${active === 0 ? "bg-primary text-primary-foreground font-medium" : "text-foreground hover:bg-accent"
                }`}
            >
              <UserCircle className="w-4 h-4 shrink-0" />
              <span className="truncate">My Profile</span>
            </button>
            <div className="border-t border-border my-1" />
            {sections.slice(1).map((s, idx) => {
              const i = idx + 1;
              
              // Hide Master Admin from sidebar if not the authorized user
              if (i === MASTER_ADMIN_IDX && !isMasterAdmin) return null;

              return (
                <button
                  key={s.label}
                  onClick={() => setActive(i)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm sidebar-transition text-left ${active === i ? "bg-primary text-primary-foreground font-medium" : "text-foreground hover:bg-accent"
                    }`}
                >
                  <s.icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{s.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Content */}
        <div className="lg:col-span-3">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
