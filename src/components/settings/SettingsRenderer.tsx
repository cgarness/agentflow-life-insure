import React from "react";
import MyProfile from "@/components/settings/MyProfile";
import CompanyBranding from "@/components/settings/CompanyBranding";
import UserManagement from "@/components/settings/UserManagement";
import CallScripts from "@/components/settings/CallScripts";
import PhoneSystem, { settingsSlugToPhoneSystemTab } from "@/components/settings/PhoneSystem";
import DispositionsManager from "@/components/settings/DispositionsManager";
import ContactManagement from "@/components/settings/ContactManagement";
import CalendarSettings from "@/components/settings/CalendarSettings";
import Permissions from "@/components/settings/Permissions";
import EmailSetup from "@/components/settings/EmailSetup";
import EmailSMSTemplates from "@/components/settings/EmailSMSTemplates";
import Carriers from "@/components/settings/Carriers";
import DNCSettings from "@/components/settings/DNCSettings";
import CustomMenuLinks from "@/components/settings/CustomMenuLinks";
import ActivityLog from "@/components/settings/ActivityLog";
import AgencyGroupSettings from "@/components/settings/AgencyGroupSettings";
import WorkflowBuilder from "@/components/settings/WorkflowBuilder";
import CommissionGridsSettings from "@/components/settings/commission-grids/CommissionGridsSettings";
import GoogleSheetsSettings from "@/components/settings/google-sheets/GoogleSheetsSettings";
import { Settings } from "lucide-react";
import { ALL_SETTINGS_SECTIONS } from "@/config/settingsConfig";

interface SettingsRendererProps {
  activeSlug: string;
  isSuperAdmin: boolean;
}

const SettingsRenderer: React.FC<SettingsRendererProps> = ({ activeSlug, isSuperAdmin }) => {
  switch (activeSlug) {
    case "my-profile": return <MyProfile />;
    case "company-branding": return <CompanyBranding />;
    case "user-management": return <UserManagement />;
    case "call-scripts": return <CallScripts />;
    case "a2p-registration":
    case "phone-system":
    case "phone-numbers":
    case "inbound-routing":
    case "state-licenses":
    case "call-recording":
    case "recordings":
    case "monitoring":
    case "number-reputation":
      return <PhoneSystem defaultTab={settingsSlugToPhoneSystemTab(activeSlug)} />;
    case "dispositions": return <DispositionsManager />;
    case "contact-management": return <ContactManagement />;
    case "calendar-settings": return <CalendarSettings />;
    case "permissions": return <Permissions />;
    case "email-settings": return <EmailSetup />;
    case "google-sheets": return <GoogleSheetsSettings />;
    case "templates": return <EmailSMSTemplates />;
    case "carriers": return <Carriers />;
    case "dnc": return <DNCSettings />;
    case "menu-links": return <CustomMenuLinks />;
    case "activity-log": return <ActivityLog />;
    case "agency-group": return <AgencyGroupSettings />;
    case "automation": return <WorkflowBuilder />;
    case "commission-grids": return <CommissionGridsSettings />;
    default: {
      const section = ALL_SETTINGS_SECTIONS.find(s => s.slug === activeSlug);
      const Icon = section?.icon || Settings;
      return (
        <div className="bg-accent/50 rounded-xl p-8 text-center">
          <Icon className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Coming soon — this section is not active yet.</p>
        </div>
      );
    }
  }
};

export default SettingsRenderer;
