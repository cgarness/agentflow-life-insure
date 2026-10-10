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

/**
 * Metric strip tile: two per row on phones, three from md, one equal row from xl. Tiles grow to fill
 * their row, so 1–6 visible metrics never leave a grey filler cell; the -1px offset hides the outer edges.
 */
const STRIP_TILE = "min-w-[50%] flex-1 border-l border-t border-border/60 md:min-w-[33.333%] xl:min-w-0";

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

      if (item.id === "stats") {
        return (
          <div key={item.id} role="group" aria-label={item.label} data-report-group={item.id}
            className="min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card">
            <div className="-ml-px -mt-px flex flex-wrap">
              {visible.map((section) => (
                <div key={section.id} data-report-section={section.id} className={STRIP_TILE}>{components[section.id]}</div>
              ))}
            </div>
          </div>
        );
      }

      return (
        <div key={item.id} role="group" aria-label={item.label} data-report-group={item.id} className="min-w-0 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">{item.label}</h2>
          {/* Performance tables are all full width so their important columns stay visible. */}
          <div className={item.id === "performance" ? "grid grid-cols-1 gap-4" : "grid grid-cols-1 gap-4 lg:grid-cols-2"}>
            {visible.map((section) => (
              <div key={section.id} data-report-section={section.id} className="min-w-0">{components[section.id]}</div>
            ))}
          </div>
        </div>
      );
    })}
  </>
);

export default SectionRenderer;
