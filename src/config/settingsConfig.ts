import {
  Building2, Users, Phone, FileText, List, Zap, Mail, Shield,
  Target, Bot, Ban,
  Webhook, Link, Clock, Database, Lock,
  CalendarDays, UserCircle, SlidersHorizontal,
} from "lucide-react";

/** `?section=` values that render the Phone System tabbed UI (legacy bookmarks + sidebar highlight). */
export const PHONE_SYSTEM_LEGACY_SECTION_SLUGS: readonly string[] = [
  "phone-system",
  "phone-numbers",
  "inbound-routing",
  "call-recording",
  "recordings",
  "monitoring",
  "number-reputation",
];

export function isPhoneSystemSettingsSection(section: string | null): boolean {
  if (!section) return false;
  return (PHONE_SYSTEM_LEGACY_SECTION_SLUGS as readonly string[]).includes(section);
}

export type SettingsSection = {
  slug: string;
  label: string;
  icon: any;
};

export type SettingsCategory = {
  label: string;
  sections: SettingsSection[];
};

export const SETTINGS_CONFIG: SettingsCategory[] = [
  {
    label: "Agency & Team",
    sections: [
      { slug: "my-profile", icon: UserCircle, label: "My Profile" },
      { slug: "user-management", icon: Users, label: "User Management" },
      { slug: "permissions", icon: Lock, label: "Permissions" },
      { slug: "company-branding", icon: Building2, label: "Company Branding" },
      { slug: "menu-links", icon: Link, label: "Custom Menu Links" },
    ],
  },
  {
    label: "Telephony Stack",
    sections: [{ slug: "phone-system", icon: Phone, label: "Phone System" }],
  },
  {
    label: "Sales Strategy",
    sections: [
      { slug: "call-scripts", icon: FileText, label: "Call Scripts" },
      { slug: "dispositions", icon: List, label: "Dispositions" },
      { slug: "contact-management", icon: SlidersHorizontal, label: "Contact Flow" },
      { slug: "dnc", icon: Ban, label: "DNC List" },
      { slug: "goals", icon: Target, label: "Goal Setting" },
      { slug: "calendar-settings", icon: CalendarDays, label: "Calendar" },
    ],
  },
  {
    label: "Automation & API",
    sections: [
      { slug: "automation", icon: Zap, label: "Workflow Builder" },
      { slug: "templates", icon: Mail, label: "Email & SMS Templates" },
      { slug: "webhooks", icon: Webhook, label: "Zapier & Webhooks" },
      { slug: "ai", icon: Bot, label: "AI Settings" },
    ],
  },
  {
    label: "System",
    sections: [
      { slug: "carriers", icon: Shield, label: "Carriers" },
      { slug: "activity-log", icon: Clock, label: "Activity Log" },
      { slug: "master-admin", icon: Database, label: "Master Admin" },
    ],
  },
];

export const ALL_SETTINGS_SECTIONS = SETTINGS_CONFIG.flatMap(c => c.sections);
