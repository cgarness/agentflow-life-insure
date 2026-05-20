import React from "react";
import { Badge } from "@/components/ui/badge";
import { SETTINGS_CONFIG } from "@/config/settingsConfig";
import { PLATFORM_ONLY_SETTINGS_SLUGS } from "@/config/permissionDefaults";
import { matchesQuery } from "./InventorySearch";

interface SettingsInventoryProps {
  search: string;
}

const SettingsInventory: React.FC<SettingsInventoryProps> = ({ search }) => (
  <div className="space-y-4">
    {SETTINGS_CONFIG.map((cat) => {
      const sections = cat.sections.filter((s) =>
        matchesQuery(`${cat.label} ${s.label} ${s.slug}`, search)
      );
      if (sections.length === 0) return null;
      return (
        <div key={cat.label}>
          <h3 className="text-sm font-semibold mb-2">{cat.label}</h3>
          <ul className="space-y-1.5">
            {sections.map((s) => {
              const platformOnly = (PLATFORM_ONLY_SETTINGS_SLUGS as readonly string[]).includes(s.slug);
              return (
                <li
                  key={s.slug}
                  className="flex items-center justify-between text-sm rounded-md border border-border/50 px-3 py-2"
                >
                  <span>{s.label}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <code className="text-[10px]">{s.slug}</code>
                    {platformOnly && (
                      <Badge variant="outline" className="text-amber-500 border-amber-500/40">
                        Super Admin
                      </Badge>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      );
    })}
  </div>
);

export default SettingsInventory;
