import React from "react";
import MyProfile from "@/components/settings/MyProfile";
import CompanyBranding from "@/components/settings/CompanyBranding";
import UserManagement from "@/components/settings/UserManagement";
import CallScripts from "@/components/settings/CallScripts";
import PhoneSystem from "@/components/settings/PhoneSystem";
import DispositionsManager from "@/components/settings/DispositionsManager";
import ContactManagement from "@/components/settings/ContactManagement";
import CalendarSettings from "@/components/settings/CalendarSettings";
import Permissions from "@/components/settings/Permissions";
import EmailSMSTemplates from "@/components/settings/EmailSMSTemplates";
import Carriers from "@/components/settings/Carriers";
import CallRecordingSettings from "@/components/settings/CallRecordingSettings";
import CallRecordingLibrary from "@/components/settings/CallRecordingLibrary";
import InboundCallRouting from "@/components/settings/InboundCallRouting";
import GoalSetting from "@/components/settings/GoalSetting";
import CallMonitoring from "@/components/settings/CallMonitoring";
import DNCSettings from "@/components/settings/DNCSettings";
import CustomMenuLinks from "@/components/settings/CustomMenuLinks";
import ActivityLog from "@/components/settings/ActivityLog";
import SpamMonitoring from "@/components/settings/SpamMonitoring";
import MasterAdmin from "@/components/settings/MasterAdmin";
import { Settings } from "lucide-react";
import { ALL_SETTINGS_SECTIONS } from "@/config/settingsConfig";

interface SettingsRendererProps {
  activeSlug: string;
  isMasterAdmin: boolean;
}

const SettingsRenderer: React.FC<SettingsRendererProps> = ({ activeSlug, isMasterAdmin }) => {
  switch (activeSlug) {
    case "my-profile": return <MyProfile />;
    case "company-branding": return <CompanyBranding />;
    case "user-management": return <UserManagement />;
    case "call-scripts": return <CallScripts />;
    case "phone-system": return <PhoneSystem />;
    case "dispositions": return <DispositionsManager />;
    case "contact-management": return <ContactManagement />;
    case "calendar-settings": return <CalendarSettings />;
    case "permissions": return <Permissions />;
    case "templates": return <EmailSMSTemplates />;
    case "carriers": return <Carriers />;
    case "call-recording": return <CallRecordingSettings />;
    case "recordings": return <CallRecordingLibrary />;
    case "inbound-routing": return <InboundCallRouting />;
    case "goals": return <GoalSetting />;
    case "monitoring": return <CallMonitoring />;
    case "dnc": return <DNCSettings />;
    case "menu-links": return <CustomMenuLinks />;
    case "activity-log": return <ActivityLog />;
    case "spam": return <SpamMonitoring />;
    case "master-admin": return isMasterAdmin ? <MasterAdmin /> : <MyProfile />;
    case "ai": return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">AI Settings</h3>
        <div className="space-y-4">
          {[["AI Provider", "Anthropic"], ["Model", "claude-sonnet-4-20250514"]].map(([k, v]) => (
            <div key={k}><label className="text-sm font-medium block mb-1.5">{k}</label><input type="text" defaultValue={v} className="w-full h-9 px-3 rounded-lg bg-accent text-sm border-0" /></div>
          ))}
        </div>
      </div>
    );
    default: {
      const section = ALL_SETTINGS_SECTIONS.find(s => s.slug === activeSlug);
      const Icon = section?.icon || Settings;
      return (
        <div className="bg-accent/50 rounded-xl p-8 text-center">
          <Icon className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold mb-1">{section?.label || "Settings"}</h3>
          <p className="text-sm text-muted-foreground">Ready for configuration.</p>
        </div>
      );
    }
  }
};

export default SettingsRenderer;
