import React from "react";

/**
 * One labelled group inside the Preferences card (Appearance · Notifications · Call Forwarding ·
 * Timezone). Subtle dividers instead of nested cards, so the page stays light.
 */
export const ProfileSettingsSection: React.FC<{
  title: string;
  description?: string;
  children: React.ReactNode;
  "data-testid"?: string;
}> = ({ title, description, children, ...rest }) => (
  <section className="border-t border-border/50 pt-5 first:border-t-0 first:pt-0" data-testid={rest["data-testid"]}>
    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
    {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
    <div className="mt-3 space-y-4">{children}</div>
  </section>
);

export default ProfileSettingsSection;
