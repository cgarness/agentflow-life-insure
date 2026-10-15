import {
  Building2, Users, Phone, FileText, List, Zap, Mail, Shield,
  Ban,
  Webhook, Link, Clock, Lock,
  CalendarDays, UserCircle, SlidersHorizontal, Network, Percent,
} from "lucide-react";

/** `?section=` values that render the Phone System tabbed UI (legacy bookmarks + sidebar highlight). */
export const PHONE_SYSTEM_LEGACY_SECTION_SLUGS: readonly string[] = [
  "phone-system",
  "a2p-registration",
  "phone-numbers",
  "inbound-routing",
  "state-licenses",
  "call-recording",
  "recordings",
  "monitoring",
  "number-reputation",
];

export function isPhoneSystemSettingsSection(section: string | null): boolean {
  if (!section) return false;
  return (PHONE_SYSTEM_LEGACY_SECTION_SLUGS as readonly string[]).includes(section);
}

/** Map legacy phone sub-slugs to the Phone System permission row. */
export function resolveSettingsPermissionSlug(section: string | null): string {
  if (!section) return "my-profile";
  if (isPhoneSystemSettingsSection(section)) return "phone-system";
  return section;
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
      { slug: "agency-group", icon: Network, label: "Agency Group" },
    ],
  },
  {
    label: "Telephony Stack",
    sections: [
      { slug: "phone-system", icon: Phone, label: "Phone System" },
    ],
  },
  {
    label: "Sales Strategy",
    sections: [
      { slug: "call-scripts", icon: FileText, label: "Call Scripts" },
      { slug: "dispositions", icon: List, label: "Dispositions" },
      { slug: "contact-management", icon: SlidersHorizontal, label: "Contact Flow" },
      { slug: "dnc", icon: Ban, label: "DNC List" },
      { slug: "calendar-settings", icon: CalendarDays, label: "Calendar" },
    ],
  },
  {
    label: "Automation & API",
    sections: [
      { slug: "automation", icon: Zap, label: "Workflow Builder" },
      { slug: "email-settings", icon: Mail, label: "Email Setup" },
      { slug: "templates", icon: Mail, label: "Email & SMS Templates" },
      { slug: "webhooks", icon: Webhook, label: "Zapier & Webhooks" },
    ],
  },
  {
    label: "System",
    sections: [
      { slug: "carriers", icon: Shield, label: "Carriers" },
      { slug: "activity-log", icon: Clock, label: "Activity Log" },
    ],
  },
];

export const ALL_SETTINGS_SECTIONS = SETTINGS_CONFIG.flatMap(c => c.sections);

/**
 * Sections only an agency admin can open. Kept OUT of SETTINGS_CONFIG on purpose: every section there
 * becomes a role-permission row whose defaults grant Agents and Team Leaders access
 * (permissionDefaults.ts). With no permission row, `hasSettingsSectionAccess` is true only for the
 * full-access roles, and the server re-checks agency-admin authority on every read and write.
 */
export const ADMIN_ONLY_SETTINGS_SECTIONS: readonly (SettingsSection & { category: string })[] = [
  { slug: "commission-grids", icon: Percent, label: "Commission Grids", category: "Agency & Team" },
];

/** Settings heading for any section, admin-only ones included. */
export function findSettingsSectionLabel(slug: string): string | undefined {
  return (ALL_SETTINGS_SECTIONS.find((s) => s.slug === slug) ?? ADMIN_ONLY_SETTINGS_SECTIONS.find((s) => s.slug === slug))
    ?.label;
}

/** Append the admin-only sections the caller may open to their categories (sidebar). */
export function withAdminOnlySections(
  categories: SettingsCategory[],
  canOpen: (slug: string) => boolean,
): SettingsCategory[] {
  const extra = ADMIN_ONLY_SETTINGS_SECTIONS.filter((s) => canOpen(s.slug));
  if (extra.length === 0) return categories;
  return categories.map((cat) => ({
    ...cat,
    sections: [
      ...cat.sections,
      ...extra.filter((s) => s.category === cat.label).map(({ slug, icon, label }) => ({ slug, icon, label })),
    ],
  }));
}
