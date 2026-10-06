import React from "react";
import { REPORT_LAYOUT_GROUPS, REPORT_LAYOUT_SECTIONS, type SectionConfig } from "@/lib/report-layout-constants";

interface Props {
  sections: SectionConfig[];
  components: Record<string, React.ReactNode>;
  /** True when the server scope covers more than the viewer (team / organization). */
  showTeamSections: boolean;
  group?: "stats" | "performance" | "diagnostics";
}

const SECTION_META = new Map(REPORT_LAYOUT_SECTIONS.map((section) => [section.id, section]));

/** Preferences control only registered sections; fixed production content is rendered by Reports. */
const SectionRenderer: React.FC<Props> = ({ sections, components, showTeamSections, group }) => (
  <>
    {REPORT_LAYOUT_GROUPS.filter((item) => !group || item.id === group).map((item) => {
      const visible = sections.filter((section) => {
        const meta = SECTION_META.get(section.id);
        return section.visible && meta?.group === item.id &&
          (showTeamSections || !meta.teamOnly) && components[section.id] != null;
      });
      if (!visible.length) return null;

      return (
        <div
          key={item.id}
          role="group"
          aria-label={item.label}
          data-report-group={item.id}
          className="min-w-0"
        >
          {item.id !== "stats" && (
            <div className="mb-4">
              <h2 className="text-lg font-semibold tracking-tight">{item.label}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {item.id === "performance" ? "People, campaigns, and lead sources." : "Call patterns and dialer activity."}
              </p>
            </div>
          )}
          <div className={item.id === "stats"
            ? "grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/60 bg-border/60 md:grid-cols-3 xl:grid-cols-6"
            : "grid grid-cols-1 gap-4 lg:grid-cols-2"}>
            {visible.map((section) => (
              <div key={section.id} data-report-section={section.id}
                className={section.id === "agent_performance_cards" || section.id === "agent_efficiency" ? "min-w-0 lg:col-span-2" : "min-w-0"}>
                {components[section.id]}
              </div>
            ))}
          </div>
        </div>
      );
    })}
  </>
);

export default SectionRenderer;
