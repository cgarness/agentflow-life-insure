import React from "react";
import { REPORT_LAYOUT_SECTIONS, type ReportLayoutGroup, type SectionConfig } from "@/lib/report-layout-constants";

const SECTION_META = new Map(REPORT_LAYOUT_SECTIONS.map(section => [section.id, section]));

/** The ids of a layout group's visible sections, in saved order; team-only sections need team or agency scope. */
export function visibleIds(sections: SectionConfig[], group: ReportLayoutGroup, showTeamSections: boolean): string[] {
  return sections.filter(s => {
    const meta = SECTION_META.get(s.id);
    return s.visible && meta?.group === group && (showTeamSections || !meta.teamOnly);
  }).map(s => s.id);
}

/** Renders one layout group's visible, built sections in saved order (v5: sections and breakdowns). */
const SectionRenderer: React.FC<{ sections: SectionConfig[]; group: ReportLayoutGroup; showTeamSections: boolean; components: Record<string, React.ReactNode> }> =
  ({ sections, group, showTeamSections, components }) => (
    <>
      {visibleIds(sections, group, showTeamSections).filter(id => components[id] != null).map(id => (
        <section key={id} data-report-group={group === "sections" ? id : undefined} data-report-section={id} className="min-w-0">{components[id]}</section>
      ))}
    </>
  );

export default SectionRenderer;
